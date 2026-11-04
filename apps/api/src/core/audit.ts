import { asc, desc, gt, sql } from 'drizzle-orm';
import { canonicalJson } from '@jappo/domain';
import type { DbOrTx } from '../db/client';
import { auditLog } from './schema';
import type { ActorContext } from './context';
import { principalId } from './context';
import { sha256 } from './crypto';
import { newId } from '../db/columns';

export interface AuditInput {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  orgId?: string | null;
  before?: unknown;
  after?: unknown;
}

const GENESIS = '0'.repeat(64);
const AUDIT_LOCK = 724_001; // advisory lock key serialising the hash chain

/** Fields included in the hash, in canonical order. */
function hashPayload(row: {
  id: string;
  at: Date;
  actorType: string;
  actorId: string | null;
  orgId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  before: unknown;
  after: unknown;
}): string {
  return canonicalJson({ ...row, at: row.at.toISOString() });
}

/** Append an audit entry to the hash chain (SPEC §7.2). Must be called inside the business transaction. */
export async function audit(tx: DbOrTx, actor: ActorContext, input: AuditInput): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${AUDIT_LOCK})`);
  const [last] = await tx.select({ hash: auditLog.hash }).from(auditLog).orderBy(desc(auditLog.seq)).limit(1);
  const prevHash = last?.hash ?? GENESIS;
  const row = {
    id: newId(),
    at: new Date(),
    actorType: actor.principal.type,
    actorId: actor.principal.type === 'anonymous' ? null : principalId(actor),
    orgId: input.orgId ?? actor.orgId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
  };
  const hash = sha256(prevHash + hashPayload(row));
  await tx.insert(auditLog).values({
    ...row,
    before: row.before as object,
    after: row.after as object,
    ip: actor.ip,
    requestId: actor.requestId,
    prevHash,
    hash,
  });
}

/** Verify the full chain; returns the first broken sequence number, if any. */
export async function verifyAuditChain(db: DbOrTx, batch = 1000): Promise<{ ok: boolean; checked: number; brokenAtSeq: number | null }> {
  let prev = GENESIS;
  let lastSeq = 0;
  let checked = 0;
  for (;;) {
    const rows = await db.select().from(auditLog).where(gt(auditLog.seq, lastSeq)).orderBy(asc(auditLog.seq)).limit(batch);
    if (rows.length === 0) break;
    for (const r of rows) {
      const expected = sha256(
        prev +
          hashPayload({
            id: r.id,
            at: r.at,
            actorType: r.actorType,
            actorId: r.actorId,
            orgId: r.orgId,
            action: r.action,
            resourceType: r.resourceType,
            resourceId: r.resourceId,
            before: r.before,
            after: r.after,
          }),
      );
      if (r.prevHash !== prev || r.hash !== expected) return { ok: false, checked, brokenAtSeq: r.seq };
      prev = r.hash;
      lastSeq = r.seq;
      checked += 1;
    }
  }
  return { ok: true, checked, brokenAtSeq: null };
}
