import { and, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import type { Db, DbOrTx } from '../../db/client';
import { offtakeContracts, type QualityGrade } from './schema';
import { organizations } from '../identity/schema';
import { blocks } from '../land/schema';
import { crops } from '../catalogue/schema';
import type { ActorContext } from '../../core/context';
import { actorUserId, isPlatformStaff } from '../../core/context';
import { audit } from '../../core/audit';
import { emit } from '../../core/events';
import { nextRef } from '../../core/refs';
import { badRequest, conflict, notFound, unprocessable } from '../../core/errors';
import { hasPermission } from '../../core/authz/permissions';
import { grant } from '../../core/authz/visibility';
import { accessGrants } from '../../core/schema';
import { assertVersion } from '../../core/etag';
import { qcol } from '../../core/geo';
import { loadBlock } from '../land/service';
import { linkFile } from '../files/service';

type Row = typeof offtakeContracts.$inferSelect;

/** Visible to the operator owner, the buyer, platform staff, and orgs with a grant on the contract or its block. */
export function offtakeVisible(actor: ActorContext): SQL {
  if (isPlatformStaff(actor)) return sql`true`;
  if (!actor.orgId) return sql`false`;
  return or(
    sql`${qcol(offtakeContracts.ownerOrgId)} = ${actor.orgId}`,
    sql`${qcol(offtakeContracts.buyerOrgId)} = ${actor.orgId}`,
    sql`exists (select 1 from ${accessGrants} g where g.grantee_org_id = ${actor.orgId} and (g.expires_at is null or g.expires_at > now())
      and ((g.resource_type = 'offtake_contract' and g.resource_id = ${qcol(offtakeContracts.id)}) or (g.resource_type = 'block' and g.resource_id = ${qcol(offtakeContracts.blockId)})))`,
  )!;
}

const select = { o: offtakeContracts, blockName: blocks.name, buyerName: organizations.legalName, cropCode: crops.code };

function dto(r: { o: Row; blockName: string; buyerName: string; cropCode: string }, actor: ActorContext) {
  const o = r.o;
  const own = o.ownerOrgId === actor.orgId && hasPermission(actor.permissions, 'offtake:manage');
  const actions: string[] = [];
  if (own) {
    if (o.status === 'draft') actions.push('update', 'mark_loi', 'mark_signed');
    if (o.status === 'loi') actions.push('update', 'mark_signed', 'terminate');
    if (o.status === 'signed') actions.push('terminate');
  }
  return {
    id: o.id,
    ref: o.ref,
    blockId: o.blockId,
    blockName: r.blockName,
    ownerOrgId: o.ownerOrgId,
    seasonId: o.seasonId,
    buyerOrgId: o.buyerOrgId,
    buyerName: r.buyerName,
    cropId: o.cropId,
    cropCode: r.cropCode,
    minVolumeKg: Number(o.minVolumeKg),
    maxVolumeKg: Number(o.maxVolumeKg),
    priceType: o.priceType,
    priceXofPerKg: o.priceXofPerKg,
    floorXofPerKg: o.floorXofPerKg,
    formulaText: o.formulaText,
    qualitySpec: o.qualitySpec,
    paymentTermsDays: o.paymentTermsDays,
    paysIntoEscrow: o.paysIntoEscrow,
    status: o.status,
    fileId: o.fileId,
    signedAt: o.signedAt?.toISOString() ?? null,
    version: o.version,
    createdAt: o.createdAt.toISOString(),
    allowedActions: actions,
  };
}

const base = (db: DbOrTx) =>
  db.select(select).from(offtakeContracts).innerJoin(blocks, eq(blocks.id, offtakeContracts.blockId)).innerJoin(organizations, eq(organizations.id, offtakeContracts.buyerOrgId)).innerJoin(crops, eq(crops.id, offtakeContracts.cropId));

export async function getContract(db: DbOrTx, actor: ActorContext, id: string) {
  const [r] = await base(db).where(and(eq(offtakeContracts.id, id), offtakeVisible(actor)));
  if (!r) throw notFound('Offtake contract');
  return dto(r, actor);
}

export async function listContracts(db: DbOrTx, actor: ActorContext, f: { blockId?: string; buyerOnly?: boolean; status?: string }) {
  const conds: SQL[] = [offtakeVisible(actor)];
  if (f.blockId) conds.push(eq(offtakeContracts.blockId, f.blockId));
  if (f.buyerOnly) conds.push(eq(offtakeContracts.buyerOrgId, actor.orgId ?? ''));
  if (f.status) conds.push(eq(offtakeContracts.status, f.status as Row['status']));
  return (await base(db).where(and(...conds)).orderBy(desc(offtakeContracts.id))).map((r) => dto(r, actor));
}

function validateTerms(b: { minVolumeKg?: number; maxVolumeKg?: number; priceType?: Row['priceType']; floorXofPerKg?: number | null; formulaText?: string | null; qualitySpec?: QualityGrade[] }) {
  if (b.minVolumeKg !== undefined && b.maxVolumeKg !== undefined && b.maxVolumeKg < b.minVolumeKg) throw unprocessable('VOLUME_RANGE_INVALID', 'Maximum volume is below minimum volume');
  if (b.priceType === 'floor_plus_market' && !b.floorXofPerKg) throw badRequest('VALIDATION_FAILED', 'floorXofPerKg is required for floor_plus_market', [{ path: 'body.floorXofPerKg', message: 'required' }]);
  if (b.priceType === 'formula' && !b.formulaText) throw badRequest('VALIDATION_FAILED', 'formulaText is required for formula pricing', [{ path: 'body.formulaText', message: 'required' }]);
  const grades = (b.qualitySpec ?? []).map((g) => g.grade);
  if (new Set(grades).size !== grades.length) throw unprocessable('DUPLICATE_GRADE', 'Quality grades must be unique');
}

type CreateBody = { blockId: string; buyerOrgId: string; cropId: string; minVolumeKg: number; maxVolumeKg: number; priceType: Row['priceType']; priceXofPerKg: number; paymentTermsDays: number; seasonId?: string | null; floorXofPerKg?: number | null; formulaText?: string | null; qualitySpec?: QualityGrade[]; paysIntoEscrow?: boolean; fileId?: string | null };

export async function createContract(db: Db, actor: ActorContext, body: CreateBody) {
  validateTerms(body);
  return db.transaction(async (tx) => {
    const b = await loadBlock(tx, actor, body.blockId, true);
    const [buyer] = await tx.select().from(organizations).where(eq(organizations.id, body.buyerOrgId));
    if (!buyer || buyer.type !== 'buyer') throw badRequest('BUYER_NOT_FOUND', 'Buyer organisation not found', [{ path: 'body.buyerOrgId', message: 'not a buyer organisation' }]);
    const [crop] = await tx.select({ id: crops.id }).from(crops).where(eq(crops.id, body.cropId));
    if (!crop) throw badRequest('CROP_NOT_FOUND', 'Unknown crop', [{ path: 'body.cropId', message: 'unknown crop' }]);
    const ref = await nextRef(tx, 'OFT');
    const [o] = await tx
      .insert(offtakeContracts)
      .values({ ...body, ref, ownerOrgId: b.ownerOrgId, minVolumeKg: String(body.minVolumeKg), maxVolumeKg: String(body.maxVolumeKg), qualitySpec: body.qualitySpec ?? [], paysIntoEscrow: body.paysIntoEscrow ?? true, createdBy: actorUserId(actor) })
      .returning();
    if (body.fileId) await linkFile(tx, actor, body.fileId, 'offtake_contract', o!.id);
    // Buyer attached → read on its contract, act on acceptance/receipts (SPEC §6.3).
    await grant(tx, { resourceType: 'offtake_contract', resourceId: o!.id, granteeOrgId: buyer.id, scope: 'act', grantedByEvent: 'offtake.created' });
    await audit(tx, actor, { action: 'offtake.created', resourceType: 'offtake_contract', resourceId: o!.id, after: { ref, buyerOrgId: buyer.id, cropId: body.cropId } });
    await emit(tx, actor, 'offtake.created', { type: 'offtake_contract', id: o!.id }, { blockId: b.id, buyerOrgId: buyer.id });
    return o!.id;
  });
}

async function loadOwn(tx: DbOrTx, actor: ActorContext, id: string) {
  const [o] = await tx.select().from(offtakeContracts).where(eq(offtakeContracts.id, id));
  if (!o || o.ownerOrgId !== actor.orgId) throw notFound('Offtake contract');
  return o;
}

export async function updateContract(db: Db, actor: ActorContext, id: string, expected: number, body: Partial<CreateBody>) {
  return db.transaction(async (tx) => {
    const o = await loadOwn(tx, actor, id);
    assertVersion(expected, o.version);
    if (!['draft', 'loi'].includes(o.status)) throw conflict('OFFTAKE_LOCKED', `A ${o.status} contract cannot be edited`);
    validateTerms({ minVolumeKg: body.minVolumeKg ?? Number(o.minVolumeKg), maxVolumeKg: body.maxVolumeKg ?? Number(o.maxVolumeKg), priceType: body.priceType ?? o.priceType, floorXofPerKg: body.floorXofPerKg !== undefined ? body.floorXofPerKg : o.floorXofPerKg, formulaText: body.formulaText !== undefined ? body.formulaText : o.formulaText, qualitySpec: body.qualitySpec });
    const set: Partial<typeof offtakeContracts.$inferInsert> = { ...body, version: o.version + 1 } as never;
    if (body.minVolumeKg !== undefined) set.minVolumeKg = String(body.minVolumeKg);
    if (body.maxVolumeKg !== undefined) set.maxVolumeKg = String(body.maxVolumeKg);
    await tx.update(offtakeContracts).set(set).where(eq(offtakeContracts.id, id));
    if (body.fileId) await linkFile(tx, actor, body.fileId, 'offtake_contract', id);
    await audit(tx, actor, { action: 'offtake.updated', resourceType: 'offtake_contract', resourceId: id, after: body });
  });
}

const TRANSITIONS: Record<'mark-loi' | 'mark-signed' | 'terminate', { from: Row['status'][]; to: Row['status']; event: string }> = {
  'mark-loi': { from: ['draft'], to: 'loi', event: 'offtake.loi' },
  'mark-signed': { from: ['draft', 'loi'], to: 'signed', event: 'offtake.signed' },
  terminate: { from: ['loi', 'signed'], to: 'terminated', event: 'offtake.terminated' },
};

export async function transitionContract(db: Db, actor: ActorContext, id: string, expected: number, action: keyof typeof TRANSITIONS, body: { fileId?: string; reason?: string }) {
  const t = TRANSITIONS[action];
  return db.transaction(async (tx) => {
    const o = await loadOwn(tx, actor, id);
    assertVersion(expected, o.version);
    if (!t.from.includes(o.status)) throw conflict('INVALID_STATE_TRANSITION', `Cannot ${action} a ${o.status} contract`, { state: o.status, action });
    if (action === 'terminate' && !body.reason) throw badRequest('VALIDATION_FAILED', 'A reason is required', [{ path: 'body.reason', message: 'required' }]);
    if (body.fileId) await linkFile(tx, actor, body.fileId, 'offtake_contract', id);
    await tx
      .update(offtakeContracts)
      .set({ status: t.to, version: o.version + 1, ...(t.to === 'signed' ? { signedAt: new Date() } : {}), ...(t.to === 'terminated' ? { terminatedAt: new Date() } : {}), ...(body.fileId ? { fileId: body.fileId } : {}) })
      .where(eq(offtakeContracts.id, id));
    await audit(tx, actor, { action: t.event, resourceType: 'offtake_contract', resourceId: id, before: { status: o.status }, after: { status: t.to, reason: body.reason } });
    await emit(tx, actor, t.event, { type: 'offtake_contract', id }, { blockId: o.blockId, buyerOrgId: o.buyerOrgId });
  });
}
