import { and, desc, eq, inArray, notInArray } from 'drizzle-orm';
import { blockMachine, matchLenders, seasonMachine, transition, type LenderProfileInput, type MatchSummary, type ModelOutput } from '@jappo/domain';
import type { Db, DbOrTx } from '../../db/client';
import { awards, financingRequests, lenderProfiles, rfps, tranches } from './schema';
import { organizations } from '../identity/schema';
import { dossiers, riskCovers } from '../dossier/schema';
import { blocks } from '../land/schema';
import { seasons } from '../planning/schema';
import { modelRuns } from '../finance/schema';
import type { ActorContext } from '../../core/context';
import { actorUserId, isPlatformStaff, requireOrg } from '../../core/context';
import { audit } from '../../core/audit';
import { emit } from '../../core/events';
import { nextRef } from '../../core/refs';
import { conflict, forbidden, notFound, unprocessable } from '../../core/errors';
import { hasPermission } from '../../core/authz/permissions';
import { assertVersion } from '../../core/etag';
import { getAssumptions } from '../finance/service';

// ---------------------------------------------------------------- guards

/** Lenders must be KYC-verified before seeing any dossier or opportunity (SPEC §18.5). */
export async function assertVerifiedLender(db: DbOrTx, actor: ActorContext) {
  if (actor.orgType !== 'lender') throw forbidden('LENDER_ONLY', 'Only lender organisations can do this');
  const [o] = await db.select({ kyc: organizations.kycStatus }).from(organizations).where(eq(organizations.id, requireOrg(actor)));
  if (o?.kyc !== 'verified') throw forbidden('LENDER_NOT_VERIFIED', 'Your organisation must be KYC-verified by Jappo first');
}

// ---------------------------------------------------------------- lender profiles

type ProfileRow = typeof lenderProfiles.$inferSelect;
export const profileDto = (p: ProfileRow) => ({
  id: p.id,
  lenderOrgId: p.lenderOrgId,
  name: p.name,
  active: p.active,
  cropIds: p.cropIds,
  regions: p.regions,
  trancheTypes: p.trancheTypes as ('seasonal' | 'investment')[],
  minTicketXof: p.minTicketXof,
  maxTicketXof: p.maxTicketXof,
  minReadinessScore: p.minReadinessScore,
  maxTenorMonths: p.maxTenorMonths,
  requiresGuarantee: p.requiresGuarantee,
  minGuaranteePct: Number(p.minGuaranteePct),
  requiresInsurance: p.requiresInsurance,
  maxRateBps: p.maxRateBps,
  notes: p.notes,
  version: p.version,
  createdAt: p.createdAt.toISOString(),
});

export async function listProfiles(db: DbOrTx, actor: ActorContext) {
  if (actor.orgType !== 'lender') throw forbidden('LENDER_ONLY');
  return (await db.select().from(lenderProfiles).where(eq(lenderProfiles.lenderOrgId, requireOrg(actor))).orderBy(desc(lenderProfiles.id))).map(profileDto);
}

type ProfileBody = Partial<Omit<ReturnType<typeof profileDto>, 'id' | 'lenderOrgId' | 'version' | 'createdAt'>>;
const profileCols = (b: ProfileBody) => ({ ...b, ...(b.minGuaranteePct !== undefined ? { minGuaranteePct: String(b.minGuaranteePct) } : {}) }) as Partial<typeof lenderProfiles.$inferInsert>;

export async function createProfile(db: Db, actor: ActorContext, body: ProfileBody & { name: string; trancheTypes: string[]; minTicketXof: number; maxTicketXof: number; maxTenorMonths: number }) {
  if (actor.orgType !== 'lender') throw forbidden('LENDER_ONLY');
  if (body.maxTicketXof < body.minTicketXof) throw unprocessable('TICKET_RANGE_INVALID', 'Maximum ticket is below minimum ticket');
  return db.transaction(async (tx) => {
    const [p] = await tx.insert(lenderProfiles).values({ ...(profileCols(body) as typeof lenderProfiles.$inferInsert), lenderOrgId: requireOrg(actor), createdBy: actorUserId(actor) }).returning();
    await audit(tx, actor, { action: 'lender_profile.created', resourceType: 'lender_profile', resourceId: p!.id, after: body });
    return profileDto(p!);
  });
}

export async function updateProfile(db: Db, actor: ActorContext, id: string, expected: number, body: ProfileBody) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(lenderProfiles).where(and(eq(lenderProfiles.id, id), eq(lenderProfiles.lenderOrgId, requireOrg(actor))));
    if (!p) throw notFound('Lender profile');
    assertVersion(expected, p.version);
    if ((body.maxTicketXof ?? p.maxTicketXof) < (body.minTicketXof ?? p.minTicketXof)) throw unprocessable('TICKET_RANGE_INVALID', 'Maximum ticket is below minimum ticket');
    const [after] = await tx.update(lenderProfiles).set({ ...profileCols(body), version: p.version + 1 }).where(eq(lenderProfiles.id, id)).returning();
    await audit(tx, actor, { action: 'lender_profile.updated', resourceType: 'lender_profile', resourceId: id, after: body });
    return profileDto(after!);
  });
}

const toProfileInput = (p: ProfileRow): LenderProfileInput => ({
  profileId: p.id,
  lenderOrgId: p.lenderOrgId,
  active: p.active,
  cropIds: p.cropIds,
  regions: p.regions,
  trancheTypes: p.trancheTypes,
  minTicketXof: p.minTicketXof,
  maxTicketXof: p.maxTicketXof,
  minReadinessScore: p.minReadinessScore,
  maxTenorMonths: p.maxTenorMonths,
  requiresGuarantee: p.requiresGuarantee,
  minGuaranteePct: Number(p.minGuaranteePct),
  requiresInsurance: p.requiresInsurance,
});

/** "How many current dossiers would match" (SPEC §12.4). */
export async function profilePreview(db: Db, actor: ActorContext, id: string) {
  const [p] = await db.select().from(lenderProfiles).where(and(eq(lenderProfiles.id, id), eq(lenderProfiles.lenderOrgId, requireOrg(actor))));
  if (!p) throw notFound('Lender profile');
  const frs = await db.select().from(financingRequests).where(inArray(financingRequests.status, ['submitted', 'in_tender']));
  let count = 0;
  for (const fr of frs) if (matchLenders(await matchSummary(db, fr), [toProfileInput(p)])[0]!.matched) count++;
  return { matchingRequests: count, openRequests: frs.length };
}

// ---------------------------------------------------------------- financing requests

type FrRow = typeof financingRequests.$inferSelect;

export async function loadRequest(db: DbOrTx, actor: ActorContext, id: string, write = false): Promise<FrRow> {
  const [fr] = await db.select().from(financingRequests).where(eq(financingRequests.id, id));
  if (!fr || (fr.ownerOrgId !== actor.orgId && !(isPlatformStaff(actor) && !write))) throw notFound('Financing request');
  return fr;
}

export async function tranchesOf(db: DbOrTx, frId: string) {
  const ts = await db.select().from(tranches).where(eq(tranches.financingRequestId, frId)).orderBy(tranches.type);
  const aw = ts.length ? await db.select().from(awards).where(and(inArray(awards.trancheId, ts.map((t) => t.id)), notInArray(awards.status, ['declined_by_lender', 'cancelled']))) : [];
  return ts.map((t) => ({
    id: t.id,
    type: t.type,
    amountXof: t.amountXof,
    requestedTenorMonths: t.requestedTenorMonths,
    requestedGraceMonths: t.requestedGraceMonths,
    repaymentProfile: t.repaymentProfile,
    borrowerType: t.borrowerType,
    borrowerOrgId: t.borrowerOrgId,
    purpose: t.purpose,
    status: t.status,
    awardedXof: aw.filter((a) => a.trancheId === t.id).reduce((s, a) => s + a.amountXof, 0),
  }));
}

export async function requestDto(db: DbOrTx, actor: ActorContext, fr: FrRow) {
  const [b] = await db.select({ name: blocks.name }).from(blocks).where(eq(blocks.id, fr.blockId));
  const [rfp] = await db.select({ id: rfps.id }).from(rfps).where(and(eq(rfps.financingRequestId, fr.id), notInArray(rfps.status, ['cancelled']))).orderBy(desc(rfps.id)).limit(1);
  const own = fr.ownerOrgId === actor.orgId;
  const actions: string[] = [];
  if (own && hasPermission(actor.permissions, 'financing_request:manage')) {
    if (fr.status === 'draft') actions.push('update');
    if (['draft', 'submitted', 'in_tender'].includes(fr.status)) actions.push('cancel');
    if (fr.status === 'submitted' && !rfp) actions.push('create_rfp');
  }
  if (own && hasPermission(actor.permissions, 'financing_request:submit') && fr.status === 'draft') actions.push('submit');
  return { id: fr.id, ref: fr.ref, blockId: fr.blockId, blockName: b?.name ?? '', seasonId: fr.seasonId, dossierId: fr.dossierId, status: fr.status, submittedAt: fr.submittedAt?.toISOString() ?? null, tranches: await tranchesOf(db, fr.id), rfpId: rfp?.id ?? null, version: fr.version, createdAt: fr.createdAt.toISOString(), allowedActions: actions };
}

export async function listRequests(db: DbOrTx, actor: ActorContext, seasonId?: string) {
  const conds = [eq(financingRequests.ownerOrgId, requireOrg(actor))];
  if (seasonId) conds.push(eq(financingRequests.seasonId, seasonId));
  const rows = await db.select().from(financingRequests).where(and(...conds)).orderBy(desc(financingRequests.id));
  return Promise.all(rows.map((r) => requestDto(db, actor, r)));
}

type TrancheInput = { type: 'seasonal' | 'investment'; amountXof: number; requestedTenorMonths: number; requestedGraceMonths: number; repaymentProfile: typeof tranches.$inferInsert.repaymentProfile; borrowerType: typeof tranches.$inferInsert.borrowerType; borrowerOrgId?: string | null; purpose: string };

function validateTranches(ts: TrancheInput[]) {
  if (new Set(ts.map((t) => t.type)).size !== ts.length) throw unprocessable('DUPLICATE_TRANCHE_TYPE', 'At most one tranche per type');
}

/** Create a financing request from a frozen dossier; tranches default from the model assumptions (D-038). */
export async function createRequest(db: Db, actor: ActorContext, body: { dossierId: string; tranches?: TrancheInput[] }) {
  const orgId = requireOrg(actor);
  return db.transaction(async (tx) => {
    const [d] = await tx.select().from(dossiers).where(and(eq(dossiers.id, body.dossierId), eq(dossiers.ownerOrgId, orgId)));
    if (!d) throw notFound('Dossier');
    if (d.status !== 'frozen') throw unprocessable('DOSSIER_NOT_FROZEN', 'Use the latest frozen dossier');
    const [active] = await tx.select({ id: financingRequests.id }).from(financingRequests).where(and(eq(financingRequests.seasonId, d.seasonId), inArray(financingRequests.status, ['draft', 'submitted', 'in_tender', 'awarded', 'contracted'])));
    if (active) throw conflict('FINANCING_REQUEST_EXISTS', 'A financing request already exists for this season');
    let ts = body.tranches;
    if (!ts) {
      const a = await getAssumptions(tx, d.seasonId);
      const [run] = await tx.select().from(modelRuns).where(eq(modelRuns.id, d.modelRunId));
      const out = run?.outputs as ModelOutput | undefined;
      ts = [];
      if (a?.seasonal) ts.push({ type: 'seasonal', amountXof: out?.tranches.seasonalAmountXof ?? 0, requestedTenorMonths: a.seasonal.tenorMonths, requestedGraceMonths: 0, repaymentProfile: a.seasonal.repaymentProfile, borrowerType: a.seasonal.borrowerType, purpose: 'Intrants et services de campagne' });
      if (a?.investment) ts.push({ type: 'investment', amountXof: out?.tranches.investmentAmountXof ?? 0, requestedTenorMonths: a.investment.tenorMonths, requestedGraceMonths: a.investment.graceMonths, repaymentProfile: a.investment.repaymentProfile, borrowerType: 'operator', purpose: 'Investissements du bloc' });
      ts = ts.filter((t) => t.amountXof > 0);
      if (!ts.length) throw unprocessable('NO_TRANCHES', 'Define tranche assumptions (model) or pass tranches');
    }
    validateTranches(ts);
    const ref = await nextRef(tx, 'FRQ');
    const [fr] = await tx.insert(financingRequests).values({ ref, blockId: d.blockId, seasonId: d.seasonId, dossierId: d.id, ownerOrgId: orgId, createdBy: actorUserId(actor) }).returning();
    for (const t of ts) await tx.insert(tranches).values({ ...t, borrowerOrgId: t.borrowerOrgId ?? (t.borrowerType === 'operator' ? orgId : null), financingRequestId: fr!.id, createdBy: actorUserId(actor) });
    await audit(tx, actor, { action: 'financing_request.created', resourceType: 'financing_request', resourceId: fr!.id, after: { ref, tranches: ts } });
    return fr!;
  });
}

export async function updateRequest(db: Db, actor: ActorContext, id: string, expected: number, ts: TrancheInput[]) {
  validateTranches(ts);
  return db.transaction(async (tx) => {
    const fr = await loadRequest(tx, actor, id, true);
    assertVersion(expected, fr.version);
    if (fr.status !== 'draft') throw conflict('FINANCING_REQUEST_LOCKED', 'Only draft requests can be edited');
    await tx.delete(tranches).where(eq(tranches.financingRequestId, id));
    for (const t of ts) await tx.insert(tranches).values({ ...t, borrowerOrgId: t.borrowerOrgId ?? (t.borrowerType === 'operator' ? fr.ownerOrgId : null), financingRequestId: id, createdBy: actorUserId(actor) });
    const [after] = await tx.update(financingRequests).set({ version: fr.version + 1 }).where(eq(financingRequests.id, id)).returning();
    await audit(tx, actor, { action: 'financing_request.updated', resourceType: 'financing_request', resourceId: id, after: { tranches: ts } });
    return after!;
  });
}

export async function submitRequest(db: Db, actor: ActorContext, id: string, expected: number) {
  return db.transaction(async (tx) => {
    const fr = await loadRequest(tx, actor, id, true);
    assertVersion(expected, fr.version);
    if (fr.status !== 'draft') throw conflict('INVALID_STATE_TRANSITION', `Request is ${fr.status}`);
    const [d] = await tx.select().from(dossiers).where(eq(dossiers.id, fr.dossierId));
    if (d?.status !== 'frozen') throw unprocessable('DOSSIER_NOT_FROZEN', 'The dossier was superseded; create a new request from the latest dossier');
    const [b] = await tx.select().from(blocks).where(eq(blocks.id, fr.blockId));
    const [s] = await tx.select().from(seasons).where(eq(seasons.id, fr.seasonId));
    if (b!.status !== 'ready') throw unprocessable('BLOCK_NOT_READY', 'The block must be ready (all gates passing)');
    await tx.update(blocks).set({ status: transition(blockMachine, b!.status, 'submit_financing'), version: b!.version + 1 }).where(eq(blocks.id, b!.id));
    if (s!.status === 'planning') await tx.update(seasons).set({ status: transition(seasonMachine, 'planning', 'enter_financing'), version: s!.version + 1 }).where(eq(seasons.id, s!.id));
    const [after] = await tx.update(financingRequests).set({ status: 'submitted', submittedAt: new Date(), version: fr.version + 1 }).where(eq(financingRequests.id, id)).returning();
    await audit(tx, actor, { action: 'financing_request.submitted', resourceType: 'financing_request', resourceId: id, before: { status: 'draft' }, after: { status: 'submitted' } });
    await emit(tx, actor, 'financing_request.submitted', { type: 'financing_request', id }, { blockId: fr.blockId, seasonId: fr.seasonId });
    return after!;
  });
}

/** Build the §9.3 match summary from the frozen dossier snapshot and current risk covers. */
export async function matchSummary(db: DbOrTx, fr: FrRow): Promise<MatchSummary> {
  const [d] = await db.select().from(dossiers).where(eq(dossiers.id, fr.dossierId));
  const [b] = await db.select({ region: blocks.region }).from(blocks).where(eq(blocks.id, fr.blockId));
  const [run] = d ? await db.select({ inputs: modelRuns.inputs }).from(modelRuns).where(eq(modelRuns.id, d.modelRunId)) : [];
  const cropIds = [...new Set(((run?.inputs as { plantings?: { cropId: string }[] } | undefined)?.plantings ?? []).map((p) => p.cropId))];
  const ts = await db.select().from(tranches).where(eq(tranches.financingRequestId, fr.id));
  const covers = await db.select().from(riskCovers).where(eq(riskCovers.blockId, fr.blockId));
  return {
    cropIds,
    region: b?.region ?? '',
    readinessScore: d?.readinessScore ?? 0,
    minBidSharePct: 20,
    tranches: ts.map((t) => ({ trancheId: t.id, type: t.type, amountXof: t.amountXof, requestedTenorMonths: t.requestedTenorMonths })),
    riskCovers: covers.map((c) => ({ type: c.type, status: c.status, coveragePct: Number(c.coveragePct) })),
  };
}

/** Matching lenders (only KYC-verified lender orgs; non-matches are never shown to operators). */
export async function matches(db: DbOrTx, actor: ActorContext, frId: string) {
  const fr = await loadRequest(db, actor, frId);
  const profiles = await db
    .select({ p: lenderProfiles, name: organizations.legalName, kind: organizations.lenderKind })
    .from(lenderProfiles)
    .innerJoin(organizations, eq(organizations.id, lenderProfiles.lenderOrgId))
    .where(and(eq(lenderProfiles.active, true), eq(organizations.kycStatus, 'verified'), eq(organizations.status, 'active'), eq(organizations.type, 'lender')));
  const summary = await matchSummary(db, fr);
  const results = matchLenders(summary, profiles.map((r) => toProfileInput(r.p)));
  const byOrg = new Map<string, { lenderOrgId: string; lenderName: string; lenderKind: string | null; profileId: string; profileName: string; trancheIds: string[]; reasons: string[] }>();
  results.forEach((m, i) => {
    if (!m.matched || byOrg.has(m.lenderOrgId)) return;
    const r = profiles[i]!;
    byOrg.set(m.lenderOrgId, { lenderOrgId: m.lenderOrgId, lenderName: r.name, lenderKind: r.kind, profileId: m.profileId, profileName: r.p.name, trancheIds: m.trancheIds, reasons: m.reasons });
  });
  return [...byOrg.values()].sort((a, b) => a.lenderName.localeCompare(b.lenderName));
}

export async function cancelRequest(db: Db, actor: ActorContext, id: string, expected: number, reason?: string) {
  return db.transaction(async (tx) => {
    const fr = await loadRequest(tx, actor, id, true);
    assertVersion(expected, fr.version);
    if (!['draft', 'submitted', 'in_tender'].includes(fr.status)) throw conflict('INVALID_STATE_TRANSITION', `Request is ${fr.status}`);
    const [open] = await tx.select({ id: rfps.id }).from(rfps).where(and(eq(rfps.financingRequestId, id), inArray(rfps.status, ['draft', 'open', 'closed', 'evaluation'])));
    if (open) throw conflict('RFP_ACTIVE', 'Cancel the RFP first');
    const [after] = await tx.update(financingRequests).set({ status: 'cancelled', cancelReason: reason ?? null, version: fr.version + 1 }).where(eq(financingRequests.id, id)).returning();
    const [b] = await tx.select().from(blocks).where(eq(blocks.id, fr.blockId));
    if (b?.status === 'in_financing') await tx.update(blocks).set({ status: transition(blockMachine, 'in_financing', 'financing_failed'), version: b.version + 1 }).where(eq(blocks.id, b.id));
    await audit(tx, actor, { action: 'financing_request.cancelled', resourceType: 'financing_request', resourceId: id, after: { reason } });
    await emit(tx, actor, 'financing_request.cancelled', { type: 'financing_request', id }, {});
    return after!;
  });
}
