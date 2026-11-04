import { and, asc, desc, eq, inArray, lt, ne, notInArray, sql } from 'drizzle-orm';
import {
  addMonthsIso, allocateFacility, blockMachine, buildSchedule, datedSchedule, daysOverdue, disbursementMachine, facilityMachine, formatXof, harvestMonthsFor, transition, upfrontFeeXof, type ModelOutput,
} from '@jappo/domain';
import type { Db, DbOrTx } from '../../db/client';
import { disbursements, escrowAccounts, facilities, facilityFarmerAllocations, repayments, scheduleLines } from './schema';
import { awards, bids, financingRequests, rfps, tranches } from '../marketplace/schema';
import { dossiers } from '../dossier/schema';
import { financingAssumptions, modelRuns } from '../finance/schema';
import { memberships, organizations } from '../identity/schema';
import { farmers } from '../farmers/schema';
import { blocks, plotAllocations } from '../land/schema';
import { budgetLines, capexItems } from '../planning/schema';
import { offtakeContracts } from '../offtake/schema';
import type { ActorContext } from '../../core/context';
import { actorUserId, isPlatformStaff, requireOrg, systemActor } from '../../core/context';
import { audit } from '../../core/audit';
import { emit } from '../../core/events';
import { nextRef } from '../../core/refs';
import { badRequest, conflict, notFound, unprocessable } from '../../core/errors';
import { hasPermission } from '../../core/authz/permissions';
import { grant, hasGrant } from '../../core/authz/visibility';
import { assertVersion } from '../../core/etag';
import { notifyOrgRoles } from '../../core/notify';
import { getSetting } from '../../core/settings';
import { encryptPii, mask } from '../../core/crypto';
import { getVisibleFile } from '../files/service';
import { signedContractTypes } from '../agreements/service';
import { env } from '../../env';

type FacilityRow = typeof facilities.$inferSelect;
type DisbursementRow = typeof disbursements.$inferSelect;
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const link = (path: string) => `${env().API_PUBLIC_URL.replace(/\/$/, '')}${path}`;
/** Calendar date in Africa/Dakar (UTC+0, no DST). */
export const todayIso = (now = new Date()) => now.toISOString().slice(0, 10);
const addDaysIso = (isoDate: string, n: number) => new Date(Date.parse(`${isoDate}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------- creation from an accepted award

async function scheduleFor(tx: DbOrTx, f: Pick<FacilityRow, 'principalXof' | 'rateBps' | 'rateMethod' | 'tenorMonths' | 'graceMonths' | 'graceType' | 'repaymentProfile' | 'seasonId'>, harvestMonths: number[]) {
  return buildSchedule({
    principalXof: f.principalXof,
    rateBps: f.rateBps,
    rateMethod: f.rateMethod,
    tenorMonths: f.tenorMonths,
    graceMonths: f.graceMonths,
    graceType: f.graceType,
    repaymentProfile: f.repaymentProfile,
    harvestMonths: f.repaymentProfile === 'seasonal' ? harvestMonthsFor(harvestMonths, f.tenorMonths) : undefined,
  });
}

async function modelOf(tx: DbOrTx, seasonId: string, financingRequestId: string) {
  const [fr] = await tx.select().from(financingRequests).where(eq(financingRequests.id, financingRequestId));
  const [d] = fr ? await tx.select().from(dossiers).where(eq(dossiers.id, fr.dossierId)) : [];
  const [run] = d ? await tx.select().from(modelRuns).where(eq(modelRuns.id, d.modelRunId)) : await tx.select().from(modelRuns).where(eq(modelRuns.seasonId, seasonId)).orderBy(desc(modelRuns.computedAt)).limit(1);
  const inputs = (run?.inputs ?? {}) as { plantings?: { harvestMonth: number }[] };
  const outputs = (run?.outputs ?? null) as ModelOutput | null;
  return { harvestMonths: (inputs.plantings ?? []).map((p) => p.harvestMonth), farmerCredit: outputs?.details?.base?.farmers ?? [] };
}

async function writeSchedule(tx: DbOrTx, f: FacilityRow, harvestMonths: number[]) {
  const lines = datedSchedule(f.startDate, await scheduleFor(tx, f, harvestMonths));
  await tx.delete(scheduleLines).where(eq(scheduleLines.facilityId, f.id));
  if (lines.length) {
    await tx.insert(scheduleLines).values(lines.map((l) => ({ facilityId: f.id, seq: l.seq, dueDate: l.dueDate, principalXof: l.principalXof, interestXof: l.interestXof, feesXof: l.feesXof, totalXof: l.totalXof })));
  }
  return lines;
}

async function writeAllocations(tx: DbOrTx, f: FacilityRow, interestXof: number, farmerCredit: { farmerId: string; seasonalPrincipalXof: number }[]) {
  await tx.delete(facilityFarmerAllocations).where(eq(facilityFarmerAllocations.facilityId, f.id));
  if (f.trancheType !== 'seasonal' || f.borrowerType === 'operator' || !farmerCredit.length) return;
  // The upfront fee is farmer-borne only when the season assumptions charge fees to farmers (as in the model, §9.1.4).
  const [fa] = await tx.select({ seasonal: financingAssumptions.seasonal }).from(financingAssumptions).where(eq(financingAssumptions.seasonId, f.seasonId));
  const feesXof = fa?.seasonal?.feesChargedTo === 'farmers' ? upfrontFeeXof(f.principalXof, f.upfrontFeeBps) : 0;
  const alloc = allocateFacility({ principalXof: f.principalXof, interestXof, feesXof, farmers: farmerCredit.map((x) => ({ farmerId: x.farmerId, weightXof: x.seasonalPrincipalXof })) });
  if (alloc.length) await tx.insert(facilityFarmerAllocations).values(alloc.map((a) => ({ facilityId: f.id, ...a })));
}

/** Award accepted by the lender → facility `pending_cp` mirroring the bid terms (SPEC §7.12). Idempotent per award. */
export async function createFacilityFromAward(tx: DbOrTx, actor: ActorContext, awardId: string): Promise<FacilityRow> {
  const [existing] = await tx.select().from(facilities).where(eq(facilities.awardId, awardId));
  if (existing) return existing;
  const [a] = await tx.select().from(awards).where(eq(awards.id, awardId));
  if (!a) throw notFound('Award');
  const [b] = await tx.select().from(bids).where(eq(bids.id, a.bidId));
  const [t] = await tx.select().from(tranches).where(eq(tranches.id, a.trancheId));
  const [r] = await tx.select().from(rfps).where(eq(rfps.id, a.rfpId));
  const [fr] = await tx.select().from(financingRequests).where(eq(financingRequests.id, r!.financingRequestId));
  const start = addDaysIso(todayIso(), b!.daysToDisbursement);
  const [f] = await tx
    .insert(facilities)
    .values({
      ref: await nextRef(tx, 'FAC'),
      awardId: a.id,
      trancheId: t!.id,
      trancheType: t!.type,
      lenderOrgId: a.lenderOrgId,
      operatorOrgId: r!.ownerOrgId,
      blockId: r!.blockId,
      seasonId: fr!.seasonId,
      borrowerType: t!.borrowerType,
      borrowerOrgId: t!.borrowerOrgId,
      principalXof: a.amountXof,
      rateBps: b!.rateBps,
      rateMethod: b!.rateMethod,
      upfrontFeeBps: b!.upfrontFeeBps,
      tenorMonths: b!.tenorMonths,
      graceMonths: b!.graceMonths,
      graceType: b!.graceType,
      repaymentProfile: b!.repaymentProfile,
      startDate: start,
      maturityDate: addMonthsIso(start, b!.tenorMonths),
      createdBy: actorUserId(actor),
    })
    .returning();
  const m = await modelOf(tx, fr!.seasonId, fr!.id);
  const lines = await writeSchedule(tx, f!, m.harvestMonths);
  await writeAllocations(tx, f!, lines.reduce((s, l) => s + l.interestXof, 0), m.farmerCredit);
  await grant(tx, { resourceType: 'facility', resourceId: f!.id, granteeOrgId: a.lenderOrgId, scope: 'act', grantedByEvent: 'facility.created', expiresAt: null });
  await audit(tx, actor, { action: 'facility.created', resourceType: 'facility', resourceId: f!.id, after: { ref: f!.ref, awardId, principalXof: f!.principalXof } });
  await emit(tx, actor, 'facility.created', { type: 'facility', id: f!.id }, { ref: f!.ref, blockId: f!.blockId, lenderOrgId: f!.lenderOrgId, principalXof: f!.principalXof }, f!.operatorOrgId);
  await notifyOrgRoles(tx, f!.operatorOrgId, ['operator_manager', 'finance_officer'], { channels: ['in_app'], templateCode: 'facility.created', data: { ref: f!.ref, amount: formatXof(f!.principalXof), link: link(`/app/facilities/${f!.id}`) }, link: `/app/facilities/${f!.id}` });
  return f!;
}

// ---------------------------------------------------------------- visibility & DTO

export async function loadFacility(db: DbOrTx, actor: ActorContext, id: string): Promise<{ f: FacilityRow; role: 'lender' | 'operator' | 'other' }> {
  const [f] = await db.select().from(facilities).where(eq(facilities.id, id));
  if (!f) throw notFound('Facility');
  if (f.lenderOrgId === actor.orgId) return { f, role: 'lender' };
  if (f.operatorOrgId === actor.orgId) return { f, role: 'operator' };
  if (isPlatformStaff(actor) || (await hasGrant(db, actor, 'facility', f.id))) return { f, role: 'other' };
  throw notFound('Facility');
}

export async function cpChecklist(db: DbOrTx, f: FacilityRow) {
  const signed = await signedContractTypes(db, f.seasonId, f.id);
  return [
    { code: 'loan_contract_signed', met: signed.loan },
    { code: 'framework_signed', met: signed.framework },
    { code: 'escrow_mandate_signed', met: signed.escrowMandate },
    { code: 'escrow_account_linked', met: Boolean(f.escrowAccountId) },
  ];
}

async function totals(db: DbOrTx, facilityId: string) {
  const [d] = await db
    .select({
      requested: sql<number>`coalesce(sum(${disbursements.amountXof}) filter (where ${disbursements.status} <> 'rejected'), 0)::bigint`,
      confirmed: sql<number>`coalesce(sum(${disbursements.amountXof}) filter (where ${disbursements.status} = 'confirmed'), 0)::bigint`,
    })
    .from(disbursements)
    .where(eq(disbursements.facilityId, facilityId));
  const [r] = await db.select({ principal: sql<number>`coalesce(sum(${repayments.principalXof}), 0)::bigint`, total: sql<number>`coalesce(sum(${repayments.amountXof}), 0)::bigint` }).from(repayments).where(eq(repayments.facilityId, facilityId));
  const [o] = await db
    .select({ overdue: sql<number>`coalesce(sum(${scheduleLines.totalXof} - ${scheduleLines.paidXof}) filter (where ${scheduleLines.status} = 'overdue'), 0)::bigint`, minDue: sql<string | null>`min(${scheduleLines.dueDate}) filter (where ${scheduleLines.status} = 'overdue')` })
    .from(scheduleLines)
    .where(eq(scheduleLines.facilityId, facilityId));
  return { requestedXof: Number(d?.requested ?? 0), disbursedXof: Number(d?.confirmed ?? 0), repaidXof: Number(r?.total ?? 0), repaidPrincipalXof: Number(r?.principal ?? 0), overdueXof: Number(o?.overdue ?? 0), oldestOverdueDate: o?.minDue ?? null };
}

export async function facilityDto(db: DbOrTx, actor: ActorContext, f: FacilityRow, role: 'lender' | 'operator' | 'other', detail = false) {
  const orgs = await db.select({ id: organizations.id, name: organizations.legalName }).from(organizations).where(inArray(organizations.id, [f.lenderOrgId, f.operatorOrgId]));
  const [b] = await db.select({ ref: blocks.ref, name: blocks.name }).from(blocks).where(eq(blocks.id, f.blockId));
  const t = await totals(db, f.id);
  const cps = await cpChecklist(db, f);
  const actions: string[] = [];
  const p = actor.permissions;
  if (role === 'lender' && hasPermission(p, 'facility:manage')) {
    if (f.status === 'pending_cp') actions.push(...(cps.every((c) => c.met) ? ['confirm_cp'] : []), 'link_escrow');
    if (f.status === 'in_arrears') actions.push('mark_default');
    if (['in_arrears', 'defaulted'].includes(f.status)) actions.push('restructure');
    actions.push('edit');
  }
  if (role === 'operator' && hasPermission(p, 'disbursement:request') && f.status === 'active' && t.requestedXof < f.principalXof) actions.push('request_disbursement');
  const base = {
    id: f.id,
    ref: f.ref,
    awardId: f.awardId,
    trancheType: f.trancheType as 'seasonal' | 'investment',
    lenderOrgId: f.lenderOrgId,
    lenderName: orgs.find((o) => o.id === f.lenderOrgId)?.name ?? '',
    operatorOrgId: f.operatorOrgId,
    operatorName: orgs.find((o) => o.id === f.operatorOrgId)?.name ?? '',
    blockId: f.blockId,
    blockRef: b?.ref ?? '',
    blockName: b?.name ?? '',
    seasonId: f.seasonId,
    borrowerType: f.borrowerType,
    borrowerOrgId: f.borrowerOrgId,
    principalXof: f.principalXof,
    rateBps: f.rateBps,
    rateMethod: f.rateMethod,
    upfrontFeeBps: f.upfrontFeeBps,
    upfrontFeeXof: upfrontFeeXof(f.principalXof, f.upfrontFeeBps),
    tenorMonths: f.tenorMonths,
    graceMonths: f.graceMonths,
    graceType: f.graceType,
    repaymentProfile: f.repaymentProfile,
    startDate: f.startDate,
    maturityDate: f.maturityDate,
    escrowAccountId: f.escrowAccountId,
    lenderLoanRef: role === 'operator' && !f.lenderLoanRef ? null : f.lenderLoanRef,
    status: f.status,
    activatedAt: iso(f.activatedAt),
    ...t,
    outstandingPrincipalXof: t.disbursedXof - t.repaidPrincipalXof,
    conditionsPrecedent: cps,
    version: f.version,
    allowedActions: actions,
  };
  if (!detail) return { ...base, schedule: [], farmerAllocations: [] };
  const lines = await db.select().from(scheduleLines).where(eq(scheduleLines.facilityId, f.id)).orderBy(asc(scheduleLines.seq));
  const alloc = await db
    .select({ farmerId: facilityFarmerAllocations.farmerId, farmerCode: farmers.code, principalXof: facilityFarmerAllocations.principalXof, interestXof: facilityFarmerAllocations.interestXof, feesXof: facilityFarmerAllocations.feesXof, dueXof: facilityFarmerAllocations.dueXof })
    .from(facilityFarmerAllocations)
    .innerJoin(farmers, eq(farmers.id, facilityFarmerAllocations.farmerId))
    .where(eq(facilityFarmerAllocations.facilityId, f.id))
    .orderBy(asc(farmers.code));
  return {
    ...base,
    schedule: lines.map((l) => ({ seq: l.seq, dueDate: l.dueDate, principalXof: l.principalXof, interestXof: l.interestXof, feesXof: l.feesXof, totalXof: l.totalXof, paidXof: l.paidXof, status: l.status })),
    farmerAllocations: alloc,
  };
}

export async function listFacilities(db: DbOrTx, actor: ActorContext, q: { blockId?: string; seasonId?: string; status?: string }) {
  const orgId = requireOrg(actor);
  const conds = [];
  if (q.blockId) conds.push(eq(facilities.blockId, q.blockId));
  if (q.seasonId) conds.push(eq(facilities.seasonId, q.seasonId));
  if (q.status) conds.push(eq(facilities.status, q.status as FacilityRow['status']));
  if (!isPlatformStaff(actor)) {
    conds.push(
      sql`(${facilities.lenderOrgId} = ${orgId} or ${facilities.operatorOrgId} = ${orgId} or exists (select 1 from access_grants g where g.resource_type = 'facility' and g.resource_id = ${facilities.id} and g.grantee_org_id = ${orgId} and (g.expires_at is null or g.expires_at > now())))`,
    );
  }
  const rows = await db.select().from(facilities).where(and(...conds)).orderBy(desc(facilities.createdAt)).limit(500);
  return Promise.all(rows.map((f) => facilityDto(db, actor, f, f.lenderOrgId === orgId ? 'lender' : f.operatorOrgId === orgId ? 'operator' : 'other')));
}

async function loadAsLender(tx: DbOrTx, actor: ActorContext, id: string) {
  const [f] = await tx.select().from(facilities).where(eq(facilities.id, id)).for('update');
  if (!f || f.lenderOrgId !== actor.orgId) throw notFound('Facility');
  return f;
}

export async function updateFacility(db: Db, actor: ActorContext, id: string, expected: number, body: { lenderLoanRef?: string | null; escrowAccountId?: string | null }) {
  await db.transaction(async (tx) => {
    const f = await loadAsLender(tx, actor, id);
    assertVersion(f.version, expected);
    const patch: Partial<FacilityRow> = { version: f.version + 1 };
    if (body.lenderLoanRef !== undefined) patch.lenderLoanRef = body.lenderLoanRef;
    if (body.escrowAccountId !== undefined) {
      if (body.escrowAccountId) {
        const [e] = await tx.select().from(escrowAccounts).where(eq(escrowAccounts.id, body.escrowAccountId));
        if (!e || e.lenderOrgId !== f.lenderOrgId || e.blockId !== f.blockId || e.status !== 'active') throw unprocessable('ESCROW_INVALID', 'The escrow account must be an active account of this lender for this block');
      } else if (f.status !== 'pending_cp') throw conflict('ESCROW_REQUIRED', 'An active facility must keep its escrow account');
      patch.escrowAccountId = body.escrowAccountId;
    }
    await tx.update(facilities).set(patch).where(eq(facilities.id, id));
    await audit(tx, actor, { action: 'facility.updated', resourceType: 'facility', resourceId: id, before: { lenderLoanRef: f.lenderLoanRef, escrowAccountId: f.escrowAccountId }, after: body });
  });
}

/** `pending_cp → active` by the lender once all conditions precedent are met. The schedule is re-dated from today. */
export async function confirmCp(db: Db, actor: ActorContext, id: string, expected: number) {
  await db.transaction(async (tx) => {
    const f = await loadAsLender(tx, actor, id);
    assertVersion(f.version, expected);
    const to = transition(facilityMachine, f.status, 'confirm_cp');
    const missing = (await cpChecklist(tx, f)).filter((c) => !c.met).map((c) => c.code);
    if (missing.length) throw unprocessable('CONDITIONS_PRECEDENT_NOT_MET', `Missing: ${missing.join(', ')}`, missing.map((m) => ({ path: 'conditionsPrecedent', message: m })));
    const start = todayIso();
    const [updated] = await tx.update(facilities).set({ status: to, startDate: start, maturityDate: addMonthsIso(start, f.tenorMonths), activatedAt: new Date(), version: f.version + 1 }).where(eq(facilities.id, id)).returning();
    const [r] = await tx.select({ frId: rfps.financingRequestId }).from(rfps).innerJoin(awards, eq(awards.rfpId, rfps.id)).where(eq(awards.id, f.awardId));
    const m = await modelOf(tx, f.seasonId, r!.frId);
    const lines = await writeSchedule(tx, updated!, m.harvestMonths);
    await writeAllocations(tx, updated!, lines.reduce((s, l) => s + l.interestXof, 0), m.farmerCredit);
    // Block in_financing → financed on the first active facility (SPEC §8.1).
    const [b] = await tx.select().from(blocks).where(eq(blocks.id, f.blockId)).for('update');
    if (b?.status === 'in_financing') await tx.update(blocks).set({ status: transition(blockMachine, b.status, 'activate_facility'), version: b.version + 1 }).where(eq(blocks.id, b.id));
    // Financing request contracted when every accepted award has an active facility.
    const accepted = await tx.select({ id: awards.id }).from(awards).innerJoin(rfps, eq(rfps.id, awards.rfpId)).where(and(eq(rfps.financingRequestId, r!.frId), eq(awards.status, 'accepted_by_lender')));
    const active = accepted.length ? await tx.select({ id: facilities.id }).from(facilities).where(and(inArray(facilities.awardId, accepted.map((x) => x.id)), ne(facilities.status, 'pending_cp'))) : [];
    if (accepted.length && active.length === accepted.length) await tx.update(financingRequests).set({ status: 'contracted' }).where(and(eq(financingRequests.id, r!.frId), eq(financingRequests.status, 'awarded')));
    await audit(tx, actor, { action: 'facility.cp_confirmed', resourceType: 'facility', resourceId: id, after: { startDate: start } });
    await emit(tx, actor, 'facility.activated', { type: 'facility', id }, { ref: f.ref, blockId: f.blockId, seasonId: f.seasonId, principalXof: f.principalXof }, f.operatorOrgId);
    await notifyOrgRoles(tx, f.operatorOrgId, ['operator_manager', 'finance_officer'], { channels: ['in_app', 'email'], templateCode: 'facility.activated', data: { ref: f.ref, amount: formatXof(f.principalXof), link: link(`/app/facilities/${f.id}`) }, link: `/app/facilities/${f.id}` });
  });
}

async function maxOverdueDays(tx: DbOrTx, facilityId: string, asOf = todayIso()) {
  const lines = await tx.select().from(scheduleLines).where(and(eq(scheduleLines.facilityId, facilityId), eq(scheduleLines.status, 'overdue')));
  return lines.reduce((m, l) => Math.max(m, daysOverdue(l.dueDate, asOf, l.totalXof - l.paidXof)), 0);
}

export async function markDefault(db: Db, actor: ActorContext, id: string, expected: number, reason: string) {
  await db.transaction(async (tx) => {
    const f = await loadAsLender(tx, actor, id);
    assertVersion(f.version, expected);
    const to = transition(facilityMachine, f.status, 'mark_default');
    const threshold = await getSetting<number>(tx, 'facility.default_days', 90);
    const days = await maxOverdueDays(tx, f.id);
    if (days <= threshold) throw unprocessable('DEFAULT_THRESHOLD_NOT_REACHED', `Overdue ${days} days; default requires more than ${threshold}`);
    await tx.update(facilities).set({ status: to, version: f.version + 1 }).where(eq(facilities.id, id));
    await audit(tx, actor, { action: 'facility.defaulted', resourceType: 'facility', resourceId: id, after: { reason, overdueDays: days } });
    await emit(tx, actor, 'facility.defaulted', { type: 'facility', id }, { ref: f.ref, overdueDays: days }, f.operatorOrgId);
  });
}

/** Restructure: unpaid lines are pushed back by `extendMonths`; maturity extended accordingly. */
export async function restructure(db: Db, actor: ActorContext, id: string, expected: number, body: { reason: string; extendMonths: number }) {
  await db.transaction(async (tx) => {
    const f = await loadAsLender(tx, actor, id);
    assertVersion(f.version, expected);
    const to = transition(facilityMachine, f.status, 'restructure');
    const lines = await tx.select().from(scheduleLines).where(eq(scheduleLines.facilityId, f.id));
    for (const l of lines) {
      if (l.status === 'paid') continue;
      await tx.update(scheduleLines).set({ dueDate: addMonthsIso(l.dueDate, body.extendMonths), status: l.paidXof > 0 ? 'partial' : 'due' }).where(eq(scheduleLines.id, l.id));
    }
    await tx.update(facilities).set({ status: to, maturityDate: addMonthsIso(f.maturityDate, body.extendMonths), tenorMonths: f.tenorMonths + body.extendMonths, version: f.version + 1 }).where(eq(facilities.id, id));
    await audit(tx, actor, { action: 'facility.restructured', resourceType: 'facility', resourceId: id, after: body });
    await emit(tx, actor, 'facility.restructured', { type: 'facility', id }, { ref: f.ref, ...body }, f.operatorOrgId);
  });
}

/** Nightly: lines past due and not fully paid become overdue; active facilities with overdue lines go `in_arrears` (SPEC §8.6). */
export async function runArrears(db: Db, asOf = todayIso()): Promise<{ overdueLines: number; facilitiesInArrears: number }> {
  const actor = systemActor('arrears');
  return db.transaction(async (tx) => {
    const marked = await tx
      .update(scheduleLines)
      .set({ status: 'overdue' })
      .where(and(lt(scheduleLines.dueDate, asOf), notInArray(scheduleLines.status, ['paid', 'overdue']), sql`${scheduleLines.paidXof} < ${scheduleLines.totalXof}`))
      .returning({ facilityId: scheduleLines.facilityId });
    const ids = [...new Set(marked.map((m) => m.facilityId))];
    let n = 0;
    if (ids.length) {
      const fs = await tx.select().from(facilities).where(and(inArray(facilities.id, ids), eq(facilities.status, 'active')));
      for (const f of fs) {
        await tx.update(facilities).set({ status: transition(facilityMachine, f.status, 'mark_overdue'), version: f.version + 1 }).where(eq(facilities.id, f.id));
        const t = await totals(tx, f.id);
        await audit(tx, actor, { action: 'facility.in_arrears', resourceType: 'facility', resourceId: f.id, after: { overdueXof: t.overdueXof } });
        await emit(tx, actor, 'facility.in_arrears', { type: 'facility', id: f.id }, { ref: f.ref, overdueXof: t.overdueXof }, f.operatorOrgId);
        for (const org of [f.operatorOrgId, f.lenderOrgId]) {
          await notifyOrgRoles(tx, org, ['operator_manager', 'finance_officer', 'credit_officer'], { channels: ['in_app', 'email'], templateCode: 'facility.in_arrears', data: { ref: f.ref, amount: formatXof(t.overdueXof), dueDate: t.oldestOverdueDate ?? asOf, link: link(`/app/facilities/${f.id}`) }, link: `/app/facilities/${f.id}` });
        }
        n++;
      }
    }
    return { overdueLines: marked.length, facilitiesInArrears: n };
  });
}

// ---------------------------------------------------------------- escrow accounts

export const escrowDto = (e: typeof escrowAccounts.$inferSelect, lenderName = '') => ({
  id: e.id,
  lenderOrgId: e.lenderOrgId,
  lenderName,
  blockId: e.blockId,
  bankName: e.bankName,
  accountLabel: e.accountLabel,
  accountNumberMasked: e.accountNumberMasked,
  hasIban: Boolean(e.ibanEnc),
  status: e.status,
  createdAt: e.createdAt.toISOString(),
});

export async function listEscrowAccounts(db: DbOrTx, actor: ActorContext, blockId?: string) {
  const orgId = requireOrg(actor);
  const conds = [];
  if (blockId) conds.push(eq(escrowAccounts.blockId, blockId));
  // Lender (own), operator (its blocks), buyer (blocks where it has an offtake contract: it must pay into escrow).
  if (!isPlatformStaff(actor)) conds.push(sql`(${escrowAccounts.lenderOrgId} = ${orgId} or exists (select 1 from blocks b where b.id = ${escrowAccounts.blockId} and b.owner_org_id = ${orgId}) or exists (select 1 from offtake_contracts o where o.block_id = ${escrowAccounts.blockId} and o.buyer_org_id = ${orgId}))`);
  const rows = await db.select({ e: escrowAccounts, lenderName: organizations.legalName }).from(escrowAccounts).innerJoin(organizations, eq(organizations.id, escrowAccounts.lenderOrgId)).where(and(...conds)).orderBy(desc(escrowAccounts.createdAt));
  return rows.map((r) => escrowDto(r.e, r.lenderName));
}

/** Lender opens the block escrow account; it is linked to the lender's pending facilities and to offtake contracts paying into escrow. */
export async function createEscrowAccount(db: Db, actor: ActorContext, body: { blockId: string; bankName: string; accountLabel: string; accountNumber: string; iban?: string | null }) {
  const orgId = requireOrg(actor);
  return db.transaction(async (tx) => {
    const fs = await tx.select().from(facilities).where(and(eq(facilities.blockId, body.blockId), eq(facilities.lenderOrgId, orgId)));
    if (!fs.length) throw notFound('Block');
    const [e] = await tx
      .insert(escrowAccounts)
      .values({ lenderOrgId: orgId, blockId: body.blockId, bankName: body.bankName, accountLabel: body.accountLabel, accountNumberMasked: mask(body.accountNumber.replace(/\s+/g, ''))!, ibanEnc: body.iban ? encryptPii(body.iban.replace(/\s+/g, '')) : null, createdBy: actorUserId(actor) })
      .returning();
    for (const f of fs) if (!f.escrowAccountId) await tx.update(facilities).set({ escrowAccountId: e!.id, version: f.version + 1 }).where(eq(facilities.id, f.id));
    await tx.update(offtakeContracts).set({ escrowAccountId: e!.id }).where(and(eq(offtakeContracts.blockId, body.blockId), eq(offtakeContracts.paysIntoEscrow, true), sql`${offtakeContracts.escrowAccountId} is null`));
    const [b] = await tx.select({ ownerOrgId: blocks.ownerOrgId }).from(blocks).where(eq(blocks.id, body.blockId));
    await audit(tx, actor, { action: 'escrow_account.created', resourceType: 'escrow_account', resourceId: e!.id, after: { blockId: body.blockId, bankName: body.bankName, accountNumberMasked: e!.accountNumberMasked } });
    await emit(tx, actor, 'escrow_account.created', { type: 'escrow_account', id: e!.id }, { blockId: body.blockId, lenderOrgId: orgId }, b?.ownerOrgId ?? null);
    const [o] = await tx.select({ name: organizations.legalName }).from(organizations).where(eq(organizations.id, orgId));
    return escrowDto(e!, o?.name ?? '');
  });
}

// ---------------------------------------------------------------- disbursements (SPEC §8.7)

export async function disbursementDto(db: DbOrTx, actor: ActorContext, d: DisbursementRow, f: FacilityRow) {
  const p = actor.permissions;
  const lender = f.lenderOrgId === actor.orgId;
  const uid = actorUserId(actor);
  const fourEyes = lender ? await requiresFourEyes(db, f.lenderOrgId) : false;
  const actions: string[] = [];
  if (lender) {
    if (d.status === 'requested' && hasPermission(p, 'disbursement:approve')) actions.push('approve');
    if (['requested', 'approved'].includes(d.status) && hasPermission(p, 'disbursement:approve')) actions.push('reject');
    if (d.status === 'approved' && hasPermission(p, 'disbursement:execute') && !(fourEyes && d.approvedBy === uid)) actions.push('execute');
    if (d.status === 'executed' && hasPermission(p, 'disbursement:approve')) actions.push('confirm');
  }
  return {
    id: d.id,
    ref: d.ref,
    facilityId: d.facilityId,
    facilityRef: f.ref,
    amountXof: d.amountXof,
    purpose: d.purpose,
    beneficiaryType: d.beneficiaryType,
    beneficiaryOrgId: d.beneficiaryOrgId,
    beneficiaryFarmerId: d.beneficiaryFarmerId,
    beneficiaryName: d.beneficiaryName,
    budgetLineIds: d.budgetLineIds,
    capexItemIds: d.capexItemIds,
    status: d.status,
    requestedBy: d.requestedBy,
    approvedBy: d.approvedBy,
    approvedAt: iso(d.approvedAt),
    executedBy: d.executedBy,
    executedAt: iso(d.executedAt),
    confirmedBy: d.confirmedBy,
    confirmedAt: iso(d.confirmedAt),
    bankReference: d.bankReference,
    proofFileId: d.proofFileId,
    rejectReason: d.rejectReason,
    createdAt: d.createdAt.toISOString(),
    version: d.version,
    allowedActions: actions,
  };
}

/** Four-eyes applies when the lender org has ≥ 2 active users with the credit_officer role (SPEC §8.7). */
async function requiresFourEyes(db: DbOrTx, lenderOrgId: string) {
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(memberships).where(and(eq(memberships.orgId, lenderOrgId), eq(memberships.status, 'active'), sql`'credit_officer' = any(${memberships.roles})`));
  return n >= 2;
}

export async function listDisbursements(db: DbOrTx, actor: ActorContext, facilityId: string) {
  const { f } = await loadFacility(db, actor, facilityId);
  const rows = await db.select().from(disbursements).where(eq(disbursements.facilityId, f.id)).orderBy(asc(disbursements.createdAt));
  return Promise.all(rows.map((d) => disbursementDto(db, actor, d, f)));
}

export async function listPendingDisbursements(db: DbOrTx, actor: ActorContext) {
  const orgId = requireOrg(actor);
  const rows = await db
    .select({ d: disbursements, f: facilities })
    .from(disbursements)
    .innerJoin(facilities, eq(facilities.id, disbursements.facilityId))
    .where(and(inArray(disbursements.status, ['requested', 'approved', 'executed']), sql`(${facilities.lenderOrgId} = ${orgId} or ${facilities.operatorOrgId} = ${orgId})`))
    .orderBy(asc(disbursements.createdAt));
  return Promise.all(rows.map((r) => disbursementDto(db, actor, r.d, r.f)));
}

export interface DisbursementRequestBody {
  amountXof: number;
  purpose: string;
  beneficiaryType: 'supplier' | 'operator' | 'farmer';
  beneficiaryOrgId?: string | null;
  beneficiaryFarmerId?: string | null;
  beneficiaryName?: string | null;
  budgetLineIds?: string[];
  capexItemIds?: string[];
}

export async function requestDisbursement(db: Db, actor: ActorContext, facilityId: string, body: DisbursementRequestBody) {
  return db.transaction(async (tx) => {
    const [f] = await tx.select().from(facilities).where(eq(facilities.id, facilityId)).for('update');
    if (!f || f.operatorOrgId !== actor.orgId) throw notFound('Facility');
    if (f.status !== 'active') throw conflict('FACILITY_NOT_ACTIVE', 'Disbursements can be requested on active facilities only');
    const t = await totals(tx, f.id);
    if (t.requestedXof + body.amountXof > f.principalXof) throw unprocessable('DISBURSEMENT_EXCEEDS_FACILITY', `Remaining undisbursed: ${formatXof(f.principalXof - t.requestedXof)}`, [{ path: 'body.amountXof', message: 'exceeds facility' }]);
    let name = body.beneficiaryName?.trim() ?? '';
    let beneficiaryOrgId: string | null = null;
    let beneficiaryFarmerId: string | null = null;
    if (body.beneficiaryType === 'operator') {
      beneficiaryOrgId = f.operatorOrgId;
      const [o] = await tx.select({ name: organizations.legalName }).from(organizations).where(eq(organizations.id, f.operatorOrgId));
      name = o?.name ?? name;
    } else if (body.beneficiaryType === 'farmer') {
      if (!body.beneficiaryFarmerId) throw badRequest('VALIDATION_FAILED', 'beneficiaryFarmerId is required', [{ path: 'body.beneficiaryFarmerId', message: 'required' }]);
      const [fa] = await tx
        .select({ id: farmers.id, firstName: farmers.firstName, lastName: farmers.lastName })
        .from(farmers)
        .innerJoin(plotAllocations, eq(plotAllocations.farmerId, farmers.id))
        .where(and(eq(farmers.id, body.beneficiaryFarmerId), eq(plotAllocations.blockId, f.blockId), eq(plotAllocations.status, 'active')))
        .limit(1);
      if (!fa) throw unprocessable('FARMER_NOT_IN_BLOCK', 'The farmer has no active allocation on this block');
      beneficiaryFarmerId = fa.id;
      name = `${fa.firstName} ${fa.lastName}`;
    } else {
      if (body.beneficiaryOrgId) {
        const [o] = await tx.select({ id: organizations.id, name: organizations.legalName }).from(organizations).where(eq(organizations.id, body.beneficiaryOrgId));
        if (!o) throw unprocessable('SUPPLIER_UNKNOWN', 'Unknown supplier organisation');
        beneficiaryOrgId = o.id;
        name = name || o.name;
      }
      if (!name) throw badRequest('VALIDATION_FAILED', 'beneficiaryName is required for a supplier', [{ path: 'body.beneficiaryName', message: 'required' }]);
    }
    const bl = body.budgetLineIds ?? [];
    if (bl.length) {
      const ok = await tx.select({ id: budgetLines.id }).from(budgetLines).where(and(inArray(budgetLines.id, bl), eq(budgetLines.seasonId, f.seasonId)));
      if (ok.length !== new Set(bl).size) throw unprocessable('BUDGET_LINE_INVALID', 'Budget lines must belong to the facility season', [{ path: 'body.budgetLineIds', message: 'invalid' }]);
    }
    const cx = body.capexItemIds ?? [];
    if (cx.length) {
      const ok = await tx.select({ id: capexItems.id }).from(capexItems).where(and(inArray(capexItems.id, cx), eq(capexItems.blockId, f.blockId)));
      if (ok.length !== new Set(cx).size) throw unprocessable('CAPEX_ITEM_INVALID', 'Capex items must belong to the facility block', [{ path: 'body.capexItemIds', message: 'invalid' }]);
    }
    const [d] = await tx
      .insert(disbursements)
      .values({ facilityId: f.id, ref: await nextRef(tx, 'DSB'), amountXof: body.amountXof, purpose: body.purpose, beneficiaryType: body.beneficiaryType, beneficiaryOrgId, beneficiaryFarmerId, beneficiaryName: name, budgetLineIds: bl, capexItemIds: cx, requestedBy: actorUserId(actor), createdBy: actorUserId(actor) })
      .returning();
    await audit(tx, actor, { action: 'disbursement.requested', resourceType: 'disbursement', resourceId: d!.id, after: { amountXof: d!.amountXof, beneficiaryType: d!.beneficiaryType } });
    await emit(tx, actor, 'disbursement.requested', { type: 'disbursement', id: d!.id }, { facilityId: f.id, amountXof: d!.amountXof }, f.operatorOrgId);
    const [o] = await tx.select({ name: organizations.legalName }).from(organizations).where(eq(organizations.id, f.operatorOrgId));
    await notifyOrgRoles(tx, f.lenderOrgId, ['credit_officer'], { channels: ['in_app', 'email'], templateCode: 'disbursement.requested', data: { ref: d!.ref, amount: formatXof(d!.amountXof), purpose: d!.purpose, facilityRef: f.ref, operatorName: o?.name ?? '', link: link(`/app/facilities/${f.id}`) }, link: `/app/facilities/${f.id}` });
    return disbursementDto(tx, actor, d!, f);
  });
}

export type DisbursementAction = 'approve' | 'reject' | 'execute' | 'confirm';

export async function actOnDisbursement(db: Db, actor: ActorContext, id: string, expected: number, action: DisbursementAction, body: { reason?: string; bankReference?: string; proofFileId?: string | null }) {
  return db.transaction(async (tx) => {
    const [d] = await tx.select().from(disbursements).where(eq(disbursements.id, id)).for('update');
    if (!d) throw notFound('Disbursement');
    const [f] = await tx.select().from(facilities).where(eq(facilities.id, d.facilityId));
    if (!f || f.lenderOrgId !== actor.orgId) throw notFound('Disbursement');
    assertVersion(d.version, expected);
    const to = transition(disbursementMachine, d.status, action);
    const uid = actorUserId(actor);
    const now = new Date();
    const patch: Partial<DisbursementRow> = { status: to, version: d.version + 1 };
    if (action === 'approve') Object.assign(patch, { approvedBy: uid, approvedAt: now });
    if (action === 'reject') {
      if (!body.reason?.trim()) throw badRequest('VALIDATION_FAILED', 'A reason is required', [{ path: 'body.reason', message: 'required' }]);
      patch.rejectReason = body.reason.trim();
    }
    if (action === 'execute') {
      if (!hasPermission(actor.permissions, 'disbursement:execute')) throw notFound('Disbursement');
      if ((await requiresFourEyes(tx, f.lenderOrgId)) && d.approvedBy === uid) throw unprocessable('FOUR_EYES_REQUIRED', 'Execution must be confirmed by a different credit officer than the approver');
      if (!body.bankReference?.trim()) throw badRequest('VALIDATION_FAILED', 'bankReference is required', [{ path: 'body.bankReference', message: 'required' }]);
      if (body.proofFileId) await getVisibleFile(tx, actor, body.proofFileId);
      Object.assign(patch, { executedBy: uid, executedAt: now, bankReference: body.bankReference.trim(), proofFileId: body.proofFileId ?? null });
    }
    if (action === 'confirm') Object.assign(patch, { confirmedBy: uid, confirmedAt: now });
    const [u] = await tx.update(disbursements).set(patch).where(eq(disbursements.id, id)).returning();
    const event = { approve: 'disbursement.approved', reject: 'disbursement.rejected', execute: 'disbursement.executed', confirm: 'disbursement.confirmed' }[action];
    await audit(tx, actor, { action: event, resourceType: 'disbursement', resourceId: id, after: { reason: body.reason, bankReference: body.bankReference } });
    await emit(tx, actor, event, { type: 'disbursement', id }, { facilityId: f.id, seasonId: f.seasonId, blockId: f.blockId, amountXof: d.amountXof }, f.operatorOrgId);
    await notifyOrgRoles(tx, f.operatorOrgId, ['operator_manager', 'finance_officer'], { channels: action === 'approve' ? ['in_app'] : ['in_app', 'email'], templateCode: event, data: { ref: d.ref, amount: formatXof(d.amountXof), reason: body.reason ?? '', bankReference: body.bankReference ?? '', link: link(`/app/facilities/${f.id}`) }, link: `/app/facilities/${f.id}` });
    return disbursementDto(tx, actor, u!, f);
  });
}

/** Season start guard (SPEC §8.2): a confirmed disbursement on a facility of the season. */
export async function hasConfirmedDisbursement(tx: DbOrTx, seasonId: string): Promise<boolean> {
  const [r] = await tx.select({ id: disbursements.id }).from(disbursements).innerJoin(facilities, eq(facilities.id, disbursements.facilityId)).where(and(eq(facilities.seasonId, seasonId), eq(disbursements.status, 'confirmed'))).limit(1);
  return Boolean(r);
}

export async function listRepayments(db: DbOrTx, actor: ActorContext, facilityId: string) {
  const { f } = await loadFacility(db, actor, facilityId);
  const rows = await db.select().from(repayments).where(eq(repayments.facilityId, f.id)).orderBy(asc(repayments.valueDate));
  return rows.map((r) => ({ id: r.id, facilityId: r.facilityId, settlementRunId: r.settlementRunId, amountXof: r.amountXof, principalXof: r.principalXof, interestXof: r.interestXof, feesXof: r.feesXof, valueDate: r.valueDate, source: r.source, reference: r.reference, createdAt: r.createdAt.toISOString() }));
}
