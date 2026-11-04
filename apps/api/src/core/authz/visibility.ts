import { and, eq, gt, isNull, or, sql, type SQL, type AnyColumn } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client';
import { accessGrants } from '../schema';
import type { ActorContext } from '../context';
import { isPlatformStaff } from '../context';
import { notFound } from '../errors';

export type Scope = 'read' | 'comment' | 'act';
const SCOPE_RANK: Record<Scope, number> = { read: 1, comment: 2, act: 3 };
const scopesAtLeast = (s: Scope): Scope[] => (Object.keys(SCOPE_RANK) as Scope[]).filter((k) => SCOPE_RANK[k] >= SCOPE_RANK[s]);

const grantActive = () => or(isNull(accessGrants.expiresAt), gt(accessGrants.expiresAt, sql`now()`));

/**
 * SQL predicate: row is visible to the actor's org (SPEC §6.3). `ownerCol` is the row's owner_org_id;
 * `grantTargets` lists (resourceType, idColumn) pairs whose grants imply visibility (e.g. the block for a plot).
 */
export function visibleTo(
  actor: ActorContext,
  ownerCol: AnyColumn,
  grantTargets: { type: string; idCol: AnyColumn }[] = [],
  minScope: Scope = 'read',
): SQL {
  if (isPlatformStaff(actor) && minScope === 'read') return sql`true`;
  if (!actor.orgId) return sql`false`;
  const parts: SQL[] = [eq(ownerCol, actor.orgId)];
  for (const g of grantTargets) {
    parts.push(sql`exists (select 1 from ${accessGrants} where ${accessGrants.resourceType} = ${g.type}
      and ${accessGrants.resourceId} = ${g.idCol} and ${accessGrants.granteeOrgId} = ${actor.orgId}
      and ${accessGrants.scope} in (${sql.join(scopesAtLeast(minScope).map((s) => sql`${s}`), sql`, `)})
      and (${accessGrants.expiresAt} is null or ${accessGrants.expiresAt} > now()))`);
  }
  return or(...parts) as SQL;
}

/** Does the actor's org hold a grant (≥ scope) on the resource? */
export async function hasGrant(db: DbOrTx, actor: ActorContext, resourceType: string, resourceId: string, scope: Scope = 'read'): Promise<boolean> {
  if (!actor.orgId) return false;
  const rows = await db
    .select({ id: accessGrants.id, scope: accessGrants.scope })
    .from(accessGrants)
    .where(and(eq(accessGrants.resourceType, resourceType), eq(accessGrants.resourceId, resourceId), eq(accessGrants.granteeOrgId, actor.orgId), grantActive()));
  return rows.some((r) => SCOPE_RANK[r.scope] >= SCOPE_RANK[scope]);
}

/** Throw 404 (never 403) when a resource is not visible (SPEC §6.4). */
export function assertFound<T>(row: T | undefined | null, what = 'Resource'): T {
  if (row === undefined || row === null) throw notFound(what);
  return row;
}

export interface GrantInput {
  resourceType: string;
  resourceId: string;
  granteeOrgId: string;
  scope: Scope;
  grantedByEvent: string;
  expiresAt?: Date | null;
}

/** Create or extend a grant (idempotent on resource/grantee/scope). */
export async function grant(tx: DbOrTx, g: GrantInput): Promise<void> {
  await tx
    .insert(accessGrants)
    .values({ ...g, expiresAt: g.expiresAt ?? null })
    .onConflictDoUpdate({
      target: [accessGrants.resourceType, accessGrants.resourceId, accessGrants.granteeOrgId, accessGrants.scope],
      set: { expiresAt: g.expiresAt ?? null, grantedByEvent: g.grantedByEvent, updatedAt: new Date() },
    });
}
