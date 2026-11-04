import { and, asc, desc, eq, inArray, lte, notInArray, sql } from 'drizzle-orm';
import { addWorkingDays, bidEar, buildSchedule, bidMachine, dec, DEFAULT_BID_WEIGHTS, evaluateBids, formatXof, rfpMachine, roundXof, transition, weightedEar, type BidInput } from '@jappo/domain';
import type { Db, DbOrTx } from '../../db/client';
import { awards, bidEvaluations, bids, financingRequests, rfpInvitations, rfpQuestions, rfps, tranches } from './schema';
import { organizations } from '../identity/schema';
import { dossiers } from '../dossier/schema';
import { blocks } from '../land/schema';
import { accessGrants } from '../../core/schema';
import type { ActorContext } from '../../core/context';
import { actorUserId, isPlatformStaff, requireOrg, systemActor } from '../../core/context';
import { audit } from '../../core/audit';
import { emit } from '../../core/events';
import { nextRef } from '../../core/refs';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../core/errors';
import { hasPermission } from '../../core/authz/permissions';
import { grant } from '../../core/authz/visibility';
import { assertVersion } from '../../core/etag';
import { notifyOrgRoles } from '../../core/notify';
import { getSetting, holidayDates } from '../../core/settings';
import { env } from '../../env';
import { assertVerifiedLender, loadRequest, matches, tranchesOf } from './requests';

type RfpRow = typeof rfps.$inferSelect;
type BidRow = typeof bids.$inferSelect;
const DAY = 86400_000;
const link = (path: string) => `${env().API_PUBLIC_URL}${path}`;
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

// ---------------------------------------------------------------- visibility

/** RFP visible to its operator, platform staff and invited KYC-verified lenders (404 otherwise). */
export async function loadRfp(db: DbOrTx, actor: ActorContext, id: string): Promise<{ rfp: RfpRow; role: 'operator' | 'lender' | 'staff'; invitation: typeof rfpInvitations.$inferSelect | null }> {
  const [rfp] = await db.select().from(rfps).where(eq(rfps.id, id));
  if (!rfp) throw notFound('RFP');
  if (rfp.ownerOrgId === actor.orgId) return { rfp, role: 'operator', invitation: null };
  if (isPlatformStaff(actor)) return { rfp, role: 'staff', invitation: null };
  if (actor.orgType === 'lender' && actor.orgId) {
    const [inv] = await db.select().from(rfpInvitations).where(and(eq(rfpInvitations.rfpId, id), eq(rfpInvitations.lenderOrgId, actor.orgId)));
    if (inv && rfp.status !== 'draft') {
      await assertVerifiedLender(db, actor);
      return { rfp, role: 'lender', invitation: inv };
    }
  }
  throw notFound('RFP');
}

const invitationDto = (i: typeof rfpInvitations.$inferSelect, lenderName: string) => ({ id: i.id, lenderOrgId: i.lenderOrgId, lenderName, status: i.status, matchReasons: i.matchReasons, declinedReason: i.declinedReason, invitedAt: iso(i.invitedAt), viewedAt: iso(i.viewedAt) });

export async function rfpDto(db: DbOrTx, actor: ActorContext, r: RfpRow, role: 'operator' | 'lender' | 'staff') {
  const [fr] = await db.select().from(financingRequests).where(eq(financingRequests.id, r.financingRequestId));
  const [b] = await db.select({ name: blocks.name, region: blocks.region }).from(blocks).where(eq(blocks.id, r.blockId));
  const [d] = await db.select({ ref: dossiers.ref, score: dossiers.readinessScore, grade: dossiers.grade }).from(dossiers).where(eq(dossiers.id, fr!.dossierId));
  const [op] = await db.select({ name: organizations.legalName }).from(organizations).where(eq(organizations.id, r.ownerOrgId));
  const invs = await db.select({ i: rfpInvitations, name: organizations.legalName }).from(rfpInvitations).innerJoin(organizations, eq(organizations.id, rfpInvitations.lenderOrgId)).where(eq(rfpInvitations.rfpId, r.id)).orderBy(asc(organizations.legalName));
  const mine = invs.find((x) => x.i.lenderOrgId === actor.orgId);
  const actions: string[] = [];
  if (role === 'operator' && hasPermission(actor.permissions, 'rfp:manage')) {
    const m = (a: Parameters<typeof transition<typeof r.status, string>>[2]) => rfpMachine.transitions.some((tr) => tr.action === a && (tr.from === '*' || (Array.isArray(tr.from) ? (tr.from as string[]).includes(r.status) : tr.from === r.status)));
    if (m('open')) actions.push('open');
    if (m('extend') && r.extensions < (await getSetting(db, 'rfp.max_extensions', 2))) actions.push('extend');
    if (m('close_early') && invs.length > 0 && invs.every((x) => ['bid_submitted', 'declined'].includes(x.i.status))) actions.push('close_early');
    if (m('cancel')) actions.push('cancel');
  }
  if (role === 'operator' && hasPermission(actor.permissions, 'award:decide') && ['evaluation', 'awarded'].includes(r.status)) actions.push('award');
  if (role === 'lender' && r.status === 'open' && mine && mine.i.status !== 'declined') {
    if (hasPermission(actor.permissions, 'rfp:respond')) actions.push('decline');
    if (hasPermission(actor.permissions, 'bid:draft')) actions.push('bid');
    if (hasPermission(actor.permissions, 'rfp_question:ask')) actions.push('ask');
  }
  return {
    id: r.id,
    ref: r.ref,
    financingRequestId: r.financingRequestId,
    financingRequestRef: fr!.ref,
    blockId: r.blockId,
    blockName: b?.name ?? '',
    region: b?.region ?? '',
    seasonId: fr!.seasonId,
    dossierId: fr!.dossierId,
    dossierRef: d?.ref ?? '',
    readinessScore: d?.score ?? 0,
    grade: d?.grade ?? '',
    operatorName: op?.name ?? '',
    status: r.status,
    openedAt: iso(r.openedAt),
    deadlineAt: iso(r.deadlineAt),
    closedAt: iso(r.closedAt),
    instructions: r.instructions,
    minBidSharePct: Number(r.minBidSharePct),
    extensions: r.extensions,
    tranches: await tranchesOf(db, r.financingRequestId),
    invitations: role === 'lender' ? [] : invs.map((x) => invitationDto(x.i, x.name)),
    myInvitation: mine ? invitationDto(mine.i, mine.name) : null,
    version: r.version,
    allowedActions: actions,
  };
}

// ---------------------------------------------------------------- lifecycle

export async function createRfp(db: Db, actor: ActorContext, body: { financingRequestId: string; lenderOrgIds?: string[]; instructions?: string | null; minBidSharePct?: number }) {
  const fr = await loadRequest(db, actor, body.financingRequestId, true);
  if (fr.status !== 'submitted') throw unprocessable('FINANCING_REQUEST_NOT_SUBMITTED', 'Submit the financing request first');
  const ms = await matches(db, actor, fr.id);
  // The operator can deselect matched lenders, never add non-matching ones (SPEC §10.9).
  const chosen = body.lenderOrgIds ? ms.filter((m) => body.lenderOrgIds!.includes(m.lenderOrgId)) : ms;
  if (body.lenderOrgIds && chosen.length !== new Set(body.lenderOrgIds).size) throw unprocessable('LENDER_NOT_MATCHED', 'Only matching lenders can be invited');
  if (!chosen.length) throw unprocessable('NO_MATCHING_LENDERS', 'No matching lender to invite');
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: rfps.id }).from(rfps).where(and(eq(rfps.financingRequestId, fr.id), notInArray(rfps.status, ['cancelled'])));
    if (existing) throw conflict('RFP_EXISTS', 'An RFP already exists for this request');
    const ref = await nextRef(tx, 'RFP');
    const minShare = body.minBidSharePct ?? (await getSetting(tx, 'rfp.min_bid_share_pct', 20));
    const [r] = await tx.insert(rfps).values({ ref, financingRequestId: fr.id, ownerOrgId: fr.ownerOrgId, blockId: fr.blockId, instructions: body.instructions ?? null, minBidSharePct: String(minShare), createdBy: actorUserId(actor) }).returning();
    for (const m of chosen) await tx.insert(rfpInvitations).values({ rfpId: r!.id, lenderOrgId: m.lenderOrgId, lenderProfileId: m.profileId, matchReasons: m.reasons, createdBy: actorUserId(actor) });
    await audit(tx, actor, { action: 'rfp.created', resourceType: 'rfp', resourceId: r!.id, after: { ref, lenders: chosen.map((c) => c.lenderOrgId) } });
    return r!;
  });
}

async function grantInvitees(tx: DbOrTx, r: RfpRow, dossierId: string, expiresAt: Date, event: string) {
  const invs = await tx.select().from(rfpInvitations).where(eq(rfpInvitations.rfpId, r.id));
  for (const i of invs) {
    // Invited lender → read on dossier version, block (read-only views) and data room files (linked to the block) until close + 30 days.
    await grant(tx, { resourceType: 'dossier', resourceId: dossierId, granteeOrgId: i.lenderOrgId, scope: 'read', grantedByEvent: event, expiresAt });
    await grant(tx, { resourceType: 'block', resourceId: r.blockId, granteeOrgId: i.lenderOrgId, scope: 'read', grantedByEvent: event, expiresAt });
  }
  return invs;
}

export async function openRfp(db: Db, actor: ActorContext, id: string, expected: number) {
  return db.transaction(async (tx) => {
    const { rfp: r, role } = await loadRfp(tx, actor, id);
    if (role !== 'operator') throw notFound('RFP');
    assertVersion(expected, r.version);
    const next = transition(rfpMachine, r.status, 'open');
    const [fr] = await tx.select().from(financingRequests).where(eq(financingRequests.id, r.financingRequestId));
    const [d] = await tx.select().from(dossiers).where(eq(dossiers.id, fr!.dossierId));
    if (d?.status !== 'frozen') throw unprocessable('DOSSIER_NOT_FROZEN', 'The dossier must be frozen');
    const now = new Date();
    const deadline = addWorkingDays(now, await getSetting(tx, 'rfp.default_deadline_working_days', 15), await holidayDates(tx));
    const [after] = await tx.update(rfps).set({ status: next, openedAt: now, deadlineAt: deadline, version: r.version + 1 }).where(eq(rfps.id, id)).returning();
    await tx.update(financingRequests).set({ status: 'in_tender', version: fr!.version + 1 }).where(eq(financingRequests.id, fr!.id));
    const invs = await grantInvitees(tx, after!, d.id, new Date(deadline.getTime() + 30 * DAY), 'rfp.opened');
    await tx.update(rfpInvitations).set({ invitedAt: now }).where(eq(rfpInvitations.rfpId, id));
    const [b] = await tx.select({ name: blocks.name }).from(blocks).where(eq(blocks.id, r.blockId));
    const amount = (await tranchesOf(tx, fr!.id)).reduce((s, t) => s + t.amountXof, 0);
    for (const i of invs) {
      await notifyOrgRoles(tx, i.lenderOrgId, ['credit_officer', 'credit_committee'], { channels: ['in_app', 'email'], templateCode: 'rfp.invited', data: { blockName: b?.name, rfpRef: r.ref, dossierRef: d.ref, score: d.readinessScore, amount: formatXof(amount), deadline: deadline.toISOString().slice(0, 10), link: link(`/app/lender/rfps/${id}`) }, link: `/app/lender/rfps/${id}` });
    }
    await audit(tx, actor, { action: 'rfp.opened', resourceType: 'rfp', resourceId: id, before: { status: r.status }, after: { status: next, deadlineAt: deadline } });
    await emit(tx, actor, 'rfp.opened', { type: 'rfp', id }, { deadlineAt: deadline.toISOString(), lenders: invs.map((i) => i.lenderOrgId) });
    return after!;
  });
}

export async function extendRfp(db: Db, actor: ActorContext, id: string, expected: number, workingDays = 5) {
  return db.transaction(async (tx) => {
    const { rfp: r, role } = await loadRfp(tx, actor, id);
    if (role !== 'operator') throw notFound('RFP');
    assertVersion(expected, r.version);
    transition(rfpMachine, r.status, 'extend');
    if (r.extensions >= (await getSetting(tx, 'rfp.max_extensions', 2))) throw unprocessable('MAX_EXTENSIONS', 'The deadline was already extended the maximum number of times');
    const deadline = addWorkingDays(r.deadlineAt!, workingDays, await holidayDates(tx));
    const [after] = await tx.update(rfps).set({ deadlineAt: deadline, extensions: r.extensions + 1, version: r.version + 1 }).where(eq(rfps.id, id)).returning();
    const [fr] = await tx.select().from(financingRequests).where(eq(financingRequests.id, r.financingRequestId));
    const invs = await grantInvitees(tx, after!, fr!.dossierId, new Date(deadline.getTime() + 30 * DAY), 'rfp.extended');
    for (const i of invs) await notifyOrgRoles(tx, i.lenderOrgId, ['credit_officer', 'credit_committee'], { channels: ['in_app', 'email'], templateCode: 'rfp.extended', data: { rfpRef: r.ref, deadline: deadline.toISOString().slice(0, 10), link: link(`/app/lender/rfps/${id}`) }, link: `/app/lender/rfps/${id}` });
    await audit(tx, actor, { action: 'rfp.extended', resourceType: 'rfp', resourceId: id, after: { deadlineAt: deadline } });
    await emit(tx, actor, 'rfp.extended', { type: 'rfp', id }, { deadlineAt: deadline.toISOString() });
    return after!;
  });
}

/** Close an RFP (deadline job or early close): open bids, compute evaluations, move to `evaluation`. */
export async function closeRfp(db: Db, actor: ActorContext, id: string, action: 'close' | 'close_early') {
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(rfps).where(eq(rfps.id, id)).for('update');
    if (!r) throw notFound('RFP');
    if (action === 'close_early') {
      const invs = await tx.select().from(rfpInvitations).where(eq(rfpInvitations.rfpId, id));
      if (!invs.every((i) => ['bid_submitted', 'declined'].includes(i.status))) throw unprocessable('INVITEES_PENDING', 'Every invited lender must have bid or declined');
    }
    const closed = transition(rfpMachine, r.status, action);
    const now = new Date();
    await tx.update(rfps).set({ status: closed, closedAt: now, version: r.version + 1 }).where(eq(rfps.id, id));
    await tx.update(bids).set({ status: transition(bidMachine, 'submitted', 'open') }).where(and(eq(bids.rfpId, id), eq(bids.status, 'submitted')));
    await tx.update(bids).set({ status: 'withdrawn' }).where(and(eq(bids.rfpId, id), eq(bids.status, 'draft')));
    const count = await computeEvaluations(tx, r);
    await tx.update(rfps).set({ status: transition(rfpMachine, closed, 'evaluate'), version: r.version + 2 }).where(eq(rfps.id, id));
    await notifyOrgRoles(tx, r.ownerOrgId, ['operator_manager', 'finance_officer'], { channels: ['in_app', 'email'], templateCode: 'rfp.closed', data: { rfpRef: r.ref, bids: count, link: link(`/app/rfps/${id}`) }, link: `/app/rfps/${id}` });
    await audit(tx, actor, { action: 'rfp.closed', resourceType: 'rfp', resourceId: id, before: { status: r.status }, after: { status: 'evaluation', bids: count, action } });
    await emit(tx, actor, 'rfp.closed', { type: 'rfp', id }, { bids: count }, r.ownerOrgId);
  });
}

const toBidInput = (b: BidRow, harvestMonths?: number[]): BidInput => ({
  bidId: b.id,
  amountXof: b.amountXof,
  rateBps: b.rateBps,
  rateMethod: b.rateMethod,
  upfrontFeeBps: b.upfrontFeeBps,
  tenorMonths: b.tenorMonths,
  graceMonths: b.graceMonths,
  graceType: b.graceType,
  repaymentProfile: b.repaymentProfile,
  harvestMonths,
  daysToDisbursement: b.daysToDisbursement,
  securityRequirements: b.securityRequirements,
  conditionsPrecedent: b.conditionsPrecedent,
  cashCollateralPct: Number(b.cashCollateralPct),
  submittedAt: b.submittedAt?.toISOString() ?? b.createdAt.toISOString(),
  acceptsPartial: b.acceptsPartial,
});

async function computeEvaluations(tx: DbOrTx, r: RfpRow): Promise<number> {
  const weights = await getSetting(tx, 'bid_evaluation.weights', DEFAULT_BID_WEIGHTS);
  const ts = await tx.select().from(tranches).where(eq(tranches.financingRequestId, r.financingRequestId));
  let n = 0;
  for (const t of ts) {
    const bs = await tx.select().from(bids).where(and(eq(bids.rfpId, r.id), eq(bids.trancheId, t.id), eq(bids.status, 'opened')));
    n += bs.length;
    const res = evaluateBids({ trancheId: t.id, amountXof: t.amountXof, minBidSharePct: Number(r.minBidSharePct) }, bs.map((b) => toBidInput(b)), weights);
    for (const e of res.evaluations) {
      const vals = { effectiveAnnualRateBps: e.effectiveAnnualRateBps, scoreCost: String(e.scoreCost), scoreShare: String(e.scoreShare), scoreSpeed: String(e.scoreSpeed), scoreConditions: String(e.scoreConditions), totalScore: String(e.totalScore), rank: e.rank, computedAt: new Date() };
      await tx.insert(bidEvaluations).values({ bidId: e.bidId, ...vals }).onConflictDoUpdate({ target: bidEvaluations.bidId, set: vals });
    }
  }
  return n;
}

export async function cancelRfp(db: Db, actor: ActorContext, id: string, expected: number, reason?: string) {
  if (!reason) throw badRequest('VALIDATION_FAILED', 'A reason is required', [{ path: 'body.reason', message: 'required' }]);
  return db.transaction(async (tx) => {
    const { rfp: r, role } = await loadRfp(tx, actor, id);
    if (role !== 'operator') throw notFound('RFP');
    assertVersion(expected, r.version);
    const next = transition(rfpMachine, r.status, 'cancel');
    const now = new Date();
    await tx.update(rfps).set({ status: next, cancelReason: reason, closedAt: r.closedAt ?? now, version: r.version + 1 }).where(eq(rfps.id, id));
    const [fr] = await tx.select().from(financingRequests).where(eq(financingRequests.id, r.financingRequestId));
    await tx.update(financingRequests).set({ status: 'submitted', version: fr!.version + 1 }).where(eq(financingRequests.id, fr!.id));
    const invs = await tx.select().from(rfpInvitations).where(eq(rfpInvitations.rfpId, id));
    await tx.update(accessGrants).set({ expiresAt: new Date(now.getTime() + 30 * DAY) }).where(and(inArray(accessGrants.granteeOrgId, invs.map((i) => i.lenderOrgId).concat(['00000000-0000-0000-0000-000000000000'])), inArray(accessGrants.resourceId, [fr!.dossierId, r.blockId]), eq(accessGrants.grantedByEvent, 'rfp.opened')));
    if (r.status !== 'draft') for (const i of invs) await notifyOrgRoles(tx, i.lenderOrgId, ['credit_officer', 'credit_committee'], { channels: ['in_app'], templateCode: 'rfp.cancelled', data: { rfpRef: r.ref, reason } });
    await audit(tx, actor, { action: 'rfp.cancelled', resourceType: 'rfp', resourceId: id, before: { status: r.status }, after: { status: next, reason } });
    await emit(tx, actor, 'rfp.cancelled', { type: 'rfp', id }, { reason });
  });
}

/** Scheduled job: close RFPs past their deadline and expire bids past validity (SPEC §8.3, §8.4). */
export async function runDeadlines(db: Db): Promise<{ closed: number; expired: number }> {
  const actor = systemActor('rfp-deadlines');
  const due = await db.select({ id: rfps.id }).from(rfps).where(and(eq(rfps.status, 'open'), lte(rfps.deadlineAt, new Date())));
  for (const r of due) await closeRfp(db, actor, r.id, 'close');
  const today = new Date().toISOString().slice(0, 10);
  const expired = await db.update(bids).set({ status: 'expired' }).where(and(inArray(bids.status, ['submitted', 'opened']), sql`${bids.validUntil} < ${today}`)).returning({ id: bids.id });
  return { closed: due.length, expired: expired.length };
}

// ---------------------------------------------------------------- invitations (lender)

export async function opportunities(db: DbOrTx, actor: ActorContext) {
  await assertVerifiedLender(db, actor);
  const invs = await db.select({ rfpId: rfpInvitations.rfpId }).from(rfpInvitations).innerJoin(rfps, eq(rfps.id, rfpInvitations.rfpId)).where(and(eq(rfpInvitations.lenderOrgId, requireOrg(actor)), notInArray(rfps.status, ['draft']))).orderBy(desc(rfps.openedAt));
  const out = [];
  for (const i of invs) {
    const { rfp, role } = await loadRfp(db, actor, i.rfpId);
    const dto = await rfpDto(db, actor, rfp, role);
    const { invitations: _x, ...rest } = dto;
    out.push({ invitation: dto.myInvitation!, rfp: rest });
  }
  return out;
}

export async function respondInvitation(db: Db, actor: ActorContext, id: string, action: 'view' | 'decline', reason?: string) {
  return db.transaction(async (tx) => {
    const { rfp, role, invitation } = await loadRfp(tx, actor, id);
    if (role !== 'lender' || !invitation) throw notFound('RFP');
    if (action === 'view') {
      if (invitation.status === 'invited') await tx.update(rfpInvitations).set({ status: 'viewed', viewedAt: new Date() }).where(eq(rfpInvitations.id, invitation.id));
      return;
    }
    if (rfp.status !== 'open') throw conflict('RFP_NOT_OPEN', 'The RFP is not open');
    if (!reason) throw badRequest('VALIDATION_FAILED', 'A reason is required', [{ path: 'body.reason', message: 'required' }]);
    const active = await tx.select({ id: bids.id }).from(bids).where(and(eq(bids.rfpId, id), eq(bids.lenderOrgId, requireOrg(actor)), eq(bids.status, 'submitted')));
    if (active.length) throw conflict('BID_SUBMITTED', 'Withdraw your bid before declining');
    await tx.update(rfpInvitations).set({ status: 'declined', declinedReason: reason }).where(eq(rfpInvitations.id, invitation.id));
    await audit(tx, actor, { action: 'rfp.declined', resourceType: 'rfp', resourceId: id, after: { reason } });
    await emit(tx, actor, 'rfp.invitation_declined', { type: 'rfp', id }, {});
  });
}

// ---------------------------------------------------------------- Q&A

export async function listQuestions(db: DbOrTx, actor: ActorContext, rfpId: string) {
  const { role } = await loadRfp(db, actor, rfpId);
  const rows = await db.select({ q: rfpQuestions, name: organizations.legalName }).from(rfpQuestions).innerJoin(organizations, eq(organizations.id, rfpQuestions.askedByOrgId)).where(eq(rfpQuestions.rfpId, rfpId)).orderBy(asc(rfpQuestions.id));
  return rows
    .filter(({ q }) => role !== 'lender' || q.askedByOrgId === actor.orgId || q.published)
    .map(({ q, name }) => ({ id: q.id, rfpId: q.rfpId, askedByMe: q.askedByOrgId === actor.orgId, askedByOrgName: role === 'lender' ? null : name, question: q.question, answer: role === 'lender' && !q.published && q.askedByOrgId !== actor.orgId ? null : q.answer, answeredAt: iso(q.answeredAt), published: q.published, createdAt: q.createdAt.toISOString() }));
}

export async function askQuestion(db: Db, actor: ActorContext, rfpId: string, question: string) {
  return db.transaction(async (tx) => {
    const { rfp, role } = await loadRfp(tx, actor, rfpId);
    if (role !== 'lender') throw forbidden('LENDER_ONLY');
    if (rfp.status !== 'open') throw conflict('RFP_NOT_OPEN', 'Questions can only be asked while the RFP is open');
    const [q] = await tx.insert(rfpQuestions).values({ rfpId, askedByOrgId: requireOrg(actor), question, createdBy: actorUserId(actor) }).returning();
    await audit(tx, actor, { action: 'rfp.question_asked', resourceType: 'rfp_question', resourceId: q!.id });
    return q!.id;
  });
}

export async function answerQuestion(db: Db, actor: ActorContext, rfpId: string, qid: string, answer: string, publish: boolean) {
  return db.transaction(async (tx) => {
    const { rfp, role } = await loadRfp(tx, actor, rfpId);
    if (role !== 'operator') throw notFound('RFP');
    const [q] = await tx.update(rfpQuestions).set({ answer, answeredAt: new Date(), published: publish }).where(and(eq(rfpQuestions.id, qid), eq(rfpQuestions.rfpId, rfpId))).returning();
    if (!q) throw notFound('Question');
    if (publish) {
      const invs = await tx.select().from(rfpInvitations).where(eq(rfpInvitations.rfpId, rfpId));
      for (const i of invs) await notifyOrgRoles(tx, i.lenderOrgId, ['credit_officer', 'credit_committee'], { channels: ['in_app'], templateCode: 'rfp.question_published', data: { rfpRef: rfp.ref, link: link(`/app/lender/rfps/${rfpId}`) }, link: `/app/lender/rfps/${rfpId}` });
      await emit(tx, actor, 'rfp.question_published', { type: 'rfp', id: rfpId }, { questionId: qid });
    }
    await audit(tx, actor, { action: 'rfp.question_answered', resourceType: 'rfp_question', resourceId: qid, after: { publish } });
  });
}

// ---------------------------------------------------------------- bids (sealed)

export function bidDto(b: BidRow, lenderName: string, actor: ActorContext, rfpStatus: string) {
  const own = b.lenderOrgId === actor.orgId;
  const actions: string[] = [];
  if (own && rfpStatus === 'open') {
    if (b.status === 'draft' && hasPermission(actor.permissions, 'bid:draft')) actions.push('update');
    if (b.status === 'draft' && hasPermission(actor.permissions, 'bid:submit')) actions.push('submit');
    if (b.status === 'submitted' && hasPermission(actor.permissions, 'bid:submit')) actions.push('withdraw');
  }
  return {
    id: b.id,
    rfpId: b.rfpId,
    trancheId: b.trancheId,
    lenderOrgId: b.lenderOrgId,
    lenderName,
    status: b.status,
    amountXof: b.amountXof,
    sharePct: Number(b.sharePct),
    rateBps: b.rateBps,
    rateMethod: b.rateMethod,
    upfrontFeeBps: b.upfrontFeeBps,
    tenorMonths: b.tenorMonths,
    graceMonths: b.graceMonths,
    graceType: b.graceType,
    repaymentProfile: b.repaymentProfile,
    securityRequirements: b.securityRequirements as never,
    cashCollateralPct: Number(b.cashCollateralPct),
    conditionsPrecedent: b.conditionsPrecedent,
    daysToDisbursement: b.daysToDisbursement,
    validUntil: b.validUntil,
    acceptsPartial: b.acceptsPartial,
    comments: b.comments,
    earBps: bidEar(toBidInput(b)).earBps,
    submittedAt: iso(b.submittedAt),
    version: b.version,
    allowedActions: actions,
  };
}

/** Sealed bids (SPEC §6.3): own bids always; the operator only after close; never other lenders. */
export async function listBids(db: DbOrTx, actor: ActorContext, rfpId: string) {
  const { rfp, role } = await loadRfp(db, actor, rfpId);
  const conds = [eq(bids.rfpId, rfpId)];
  if (role === 'lender') conds.push(eq(bids.lenderOrgId, requireOrg(actor)));
  else if (!['closed', 'evaluation', 'awarded'].includes(rfp.status)) throw forbidden('BIDS_SEALED', 'Bids are sealed until the RFP closes');
  else conds.push(notInArray(bids.status, ['draft', 'withdrawn']));
  const rows = await db.select({ b: bids, name: organizations.legalName }).from(bids).innerJoin(organizations, eq(organizations.id, bids.lenderOrgId)).where(and(...conds)).orderBy(asc(bids.createdAt));
  return rows.map(({ b, name }) => bidDto(b, name, actor, rfp.status));
}

async function loadOwnBid(tx: DbOrTx, actor: ActorContext, id: string) {
  const [b] = await tx.select().from(bids).where(eq(bids.id, id));
  if (!b || b.lenderOrgId !== actor.orgId) throw notFound('Bid');
  const { rfp } = await loadRfp(tx, actor, b.rfpId);
  return { b, rfp };
}

export async function bidOut(db: DbOrTx, actor: ActorContext, id: string) {
  const { b, rfp } = await loadOwnBid(db, actor, id);
  const [o] = await db.select({ name: organizations.legalName }).from(organizations).where(eq(organizations.id, b.lenderOrgId));
  return bidDto(b, o!.name, actor, rfp.status);
}

type BidBody = Partial<Omit<typeof bids.$inferInsert, 'cashCollateralPct' | 'sharePct'>> & { cashCollateralPct?: number };

async function trancheFor(tx: DbOrTx, rfp: RfpRow, trancheId: string) {
  const [t] = await tx.select().from(tranches).where(and(eq(tranches.id, trancheId), eq(tranches.financingRequestId, rfp.financingRequestId)));
  if (!t) throw badRequest('TRANCHE_NOT_FOUND', 'Unknown tranche', [{ path: 'body.trancheId', message: 'unknown tranche' }]);
  return t;
}

export async function createBid(db: Db, actor: ActorContext, rfpId: string, body: BidBody & { trancheId: string; amountXof: number }) {
  return db.transaction(async (tx) => {
    const { rfp, role, invitation } = await loadRfp(tx, actor, rfpId);
    if (role !== 'lender' || !invitation) throw forbidden('LENDER_ONLY');
    if (rfp.status !== 'open') throw conflict('RFP_NOT_OPEN', 'The RFP is not open');
    if (invitation.status === 'declined') throw conflict('INVITATION_DECLINED', 'You declined this RFP');
    const t = await trancheFor(tx, rfp, body.trancheId);
    if (body.amountXof > t.amountXof) throw unprocessable('BID_EXCEEDS_TRANCHE', 'The bid exceeds the tranche amount');
    const [dup] = await tx.select({ id: bids.id }).from(bids).where(and(eq(bids.rfpId, rfpId), eq(bids.trancheId, t.id), eq(bids.lenderOrgId, requireOrg(actor)), notInArray(bids.status, ['withdrawn'])));
    if (dup) throw conflict('BID_EXISTS', 'You already have a bid on this tranche');
    const [b] = await tx
      .insert(bids)
      .values({ ...(body as typeof bids.$inferInsert), cashCollateralPct: String(body.cashCollateralPct ?? 0), sharePct: dec(body.amountXof).times(100).div(t.amountXof).toDecimalPlaces(4).toString(), rfpId, lenderOrgId: requireOrg(actor), status: 'draft', createdBy: actorUserId(actor) })
      .returning();
    if (invitation.status === 'invited') await tx.update(rfpInvitations).set({ status: 'viewed', viewedAt: new Date() }).where(eq(rfpInvitations.id, invitation.id));
    await audit(tx, actor, { action: 'bid.drafted', resourceType: 'bid', resourceId: b!.id });
    return b!.id;
  });
}

export async function updateBid(db: Db, actor: ActorContext, id: string, expected: number, body: BidBody) {
  return db.transaction(async (tx) => {
    const { b, rfp } = await loadOwnBid(tx, actor, id);
    assertVersion(expected, b.version);
    if (b.status !== 'draft' || rfp.status !== 'open') throw conflict('BID_LOCKED', 'Only draft bids on open RFPs can be edited');
    const t = await trancheFor(tx, rfp, b.trancheId);
    const amount = body.amountXof ?? b.amountXof;
    if (amount > t.amountXof) throw unprocessable('BID_EXCEEDS_TRANCHE', 'The bid exceeds the tranche amount');
    await tx.update(bids).set({ ...(body as Partial<typeof bids.$inferInsert>), ...(body.cashCollateralPct !== undefined ? { cashCollateralPct: String(body.cashCollateralPct) } : {}), sharePct: dec(amount).times(100).div(t.amountXof).toDecimalPlaces(4).toString(), version: b.version + 1 }).where(eq(bids.id, id));
    await audit(tx, actor, { action: 'bid.updated', resourceType: 'bid', resourceId: id });
  });
}

export async function submitBid(db: Db, actor: ActorContext, id: string, expected: number) {
  return db.transaction(async (tx) => {
    const { b, rfp } = await loadOwnBid(tx, actor, id);
    assertVersion(expected, b.version);
    const next = transition(bidMachine, b.status, 'submit');
    if (rfp.status !== 'open') throw conflict('RFP_NOT_OPEN', 'The RFP is not open');
    if (rfp.deadlineAt && rfp.deadlineAt <= new Date()) throw conflict('DEADLINE_PASSED', 'The deadline has passed');
    const t = await trancheFor(tx, rfp, b.trancheId);
    const minAmount = dec(t.amountXof).times(rfp.minBidSharePct).div(100);
    if (b.amountXof !== t.amountXof && dec(b.amountXof).lt(minAmount)) throw unprocessable('BID_SHARE_TOO_LOW', `Minimum bid is ${rfp.minBidSharePct} % of the tranche`);
    if (b.validUntil < new Date().toISOString().slice(0, 10)) throw unprocessable('BID_VALIDITY_PAST', 'The validity date is in the past');
    await tx.update(bids).set({ status: next, submittedAt: new Date(), submittedBy: actorUserId(actor), version: b.version + 1 }).where(eq(bids.id, id));
    await tx.update(rfpInvitations).set({ status: 'bid_submitted' }).where(and(eq(rfpInvitations.rfpId, rfp.id), eq(rfpInvitations.lenderOrgId, b.lenderOrgId)));
    await audit(tx, actor, { action: 'bid.submitted', resourceType: 'bid', resourceId: id, after: { trancheId: b.trancheId } });
    await emit(tx, actor, 'bid.submitted', { type: 'bid', id }, { rfpId: rfp.id, trancheId: b.trancheId });
  });
}

export async function withdrawBid(db: Db, actor: ActorContext, id: string, expected: number) {
  return db.transaction(async (tx) => {
    const { b, rfp } = await loadOwnBid(tx, actor, id);
    assertVersion(expected, b.version);
    if (rfp.status !== 'open') throw conflict('RFP_NOT_OPEN', 'Bids can only be withdrawn while the RFP is open');
    await tx.update(bids).set({ status: transition(bidMachine, b.status, 'withdraw'), version: b.version + 1 }).where(eq(bids.id, id));
    const [still] = await tx.select({ id: bids.id }).from(bids).where(and(eq(bids.rfpId, rfp.id), eq(bids.lenderOrgId, b.lenderOrgId), eq(bids.status, 'submitted')));
    if (!still) await tx.update(rfpInvitations).set({ status: 'viewed' }).where(and(eq(rfpInvitations.rfpId, rfp.id), eq(rfpInvitations.lenderOrgId, b.lenderOrgId)));
    await audit(tx, actor, { action: 'bid.withdrawn', resourceType: 'bid', resourceId: id });
    await emit(tx, actor, 'bid.withdrawn', { type: 'bid', id }, { rfpId: rfp.id });
  });
}

export function previewBid(body: { amountXof: number; rateBps: number; rateMethod: 'flat' | 'declining'; upfrontFeeBps: number; tenorMonths: number; graceMonths: number; graceType: 'interest_only' | 'capitalised'; repaymentProfile: 'bullet' | 'seasonal' | 'annuity' | 'equal_principal' }) {
  const schedule = buildSchedule({ principalXof: body.amountXof, rateBps: body.rateBps, rateMethod: body.rateMethod, tenorMonths: body.tenorMonths, graceMonths: body.graceMonths, graceType: body.graceType, repaymentProfile: body.repaymentProfile });
  return { earBps: bidEar(body).earBps, schedule, totalInterestXof: schedule.reduce((s, l) => s + l.interestXof, 0), upfrontFeeXof: roundXof(dec(body.amountXof).times(body.upfrontFeeBps).div(10000)) };
}

// ---------------------------------------------------------------- evaluation & award

export async function evaluation(db: DbOrTx, actor: ActorContext, rfpId: string) {
  const { rfp, role } = await loadRfp(db, actor, rfpId);
  if (role === 'lender') throw notFound('RFP');
  if (!['evaluation', 'awarded'].includes(rfp.status)) throw forbidden('BIDS_SEALED', 'The evaluation is available after the RFP closes');
  const weights = await getSetting(db, 'bid_evaluation.weights', DEFAULT_BID_WEIGHTS);
  const ts = await db.select().from(tranches).where(eq(tranches.financingRequestId, rfp.financingRequestId)).orderBy(tranches.type);
  const out = [];
  for (const t of ts) {
    const rows = await db.select({ b: bids, name: organizations.legalName }).from(bids).innerJoin(organizations, eq(organizations.id, bids.lenderOrgId)).where(and(eq(bids.rfpId, rfpId), eq(bids.trancheId, t.id), inArray(bids.status, ['opened', 'awarded', 'not_awarded'])));
    const res = evaluateBids({ trancheId: t.id, amountXof: t.amountXof, minBidSharePct: Number(rfp.minBidSharePct) }, rows.map((r) => toBidInput(r.b)), weights);
    out.push({
      trancheId: t.id,
      amountXof: t.amountXof,
      evaluations: res.evaluations.map((e) => {
        const r = rows.find((x) => x.b.id === e.bidId)!;
        return { ...e, lenderName: r.name, amountXof: r.b.amountXof };
      }),
      suggestedAllocation: res.suggestedAllocation,
      weightedEarBps: res.weightedEarBps,
    });
  }
  return { tranches: out };
}

export async function award(db: Db, actor: ActorContext, rfpId: string, expected: number, selection: { bidId: string; amountXof: number }[]) {
  return db.transaction(async (tx) => {
    const { rfp: r, role } = await loadRfp(tx, actor, rfpId);
    if (role !== 'operator') throw notFound('RFP');
    assertVersion(expected, r.version);
    if (!['evaluation', 'awarded'].includes(r.status)) throw conflict('INVALID_STATE_TRANSITION', `Cannot award an RFP in status ${r.status}`);
    const ts = await tx.select().from(tranches).where(eq(tranches.financingRequestId, r.financingRequestId));
    const existing = await tx.select().from(awards).where(and(eq(awards.rfpId, rfpId), notInArray(awards.status, ['declined_by_lender', 'cancelled'])));
    const ears = new Map<string, number>();
    for (const s of selection) {
      const [b] = await tx.select().from(bids).where(and(eq(bids.id, s.bidId), eq(bids.rfpId, rfpId)));
      if (!b || b.status !== 'opened') throw unprocessable('BID_NOT_AWARDABLE', `Bid ${s.bidId} cannot be awarded`);
      if (s.amountXof > b.amountXof) throw unprocessable('AWARD_EXCEEDS_BID', 'An award cannot exceed the bid amount');
      const t = ts.find((x) => x.id === b.trancheId)!;
      if (s.amountXof < b.amountXof && (!b.acceptsPartial || dec(s.amountXof).lt(dec(t.amountXof).times(r.minBidSharePct).div(100)))) throw unprocessable('PARTIAL_NOT_ALLOWED', 'Partial award not accepted by the lender or below the minimum share');
      ears.set(b.id, bidEar(toBidInput(b)).earBps);
    }
    // Σ awarded per tranche ≤ tranche amount (SPEC §8.3 guard)
    const bidRows = selection.length ? await tx.select().from(bids).where(inArray(bids.id, selection.map((s) => s.bidId))) : [];
    for (const t of ts) {
      const add = selection.filter((s) => bidRows.find((b) => b.id === s.bidId)?.trancheId === t.id).reduce((s, a) => s + a.amountXof, 0);
      const already = existing.filter((a) => a.trancheId === t.id).reduce((s, a) => s + a.amountXof, 0);
      if (add + already > t.amountXof) throw unprocessable('AWARD_EXCEEDS_TRANCHE', `Awards exceed the ${t.type} tranche amount`);
    }
    const now = new Date();
    const [b0] = await tx.select({ name: blocks.name }).from(blocks).where(eq(blocks.id, r.blockId));
    for (const s of selection) {
      const b = bidRows.find((x) => x.id === s.bidId)!;
      const [a] = await tx.insert(awards).values({ rfpId, bidId: b.id, trancheId: b.trancheId, lenderOrgId: b.lenderOrgId, amountXof: s.amountXof, decidedBy: actorUserId(actor), decidedAt: now, createdBy: actorUserId(actor) }).returning();
      await tx.update(bids).set({ status: transition(bidMachine, 'opened', 'award') }).where(eq(bids.id, b.id));
      await notifyOrgRoles(tx, b.lenderOrgId, ['credit_officer', 'credit_committee'], { channels: ['in_app', 'email'], templateCode: 'award.proposed', data: { rfpRef: r.ref, amount: formatXof(s.amountXof), blockName: b0?.name, link: link('/app/lender/awards') }, link: '/app/lender/awards' });
      await emit(tx, actor, 'award.proposed', { type: 'award', id: a!.id }, { rfpId, lenderOrgId: b.lenderOrgId, amountXof: s.amountXof });
    }
    if (r.status === 'evaluation') {
      const losers = await tx.update(bids).set({ status: transition(bidMachine, 'opened', 'not_award') }).where(and(eq(bids.rfpId, rfpId), eq(bids.status, 'opened'))).returning();
      for (const l of losers) await notifyOrgRoles(tx, l.lenderOrgId, ['credit_officer', 'credit_committee'], { channels: ['in_app'], templateCode: 'award.not_awarded', data: { rfpRef: r.ref } });
      await tx.update(rfps).set({ status: transition(rfpMachine, r.status, 'award'), version: r.version + 1 }).where(eq(rfps.id, rfpId));
      await tx.update(financingRequests).set({ status: 'awarded' }).where(eq(financingRequests.id, r.financingRequestId));
    } else {
      await tx.update(rfps).set({ version: r.version + 1 }).where(eq(rfps.id, rfpId));
    }
    await refreshTrancheStatus(tx, r.financingRequestId);
    await audit(tx, actor, { action: 'rfp.awarded', resourceType: 'rfp', resourceId: rfpId, after: { selection, weightedEarBps: weightedEar(selection, ears) } });
    await emit(tx, actor, 'rfp.awarded', { type: 'rfp', id: rfpId }, { selection });
  });
}

async function refreshTrancheStatus(tx: DbOrTx, frId: string) {
  for (const t of await tranchesOf(tx, frId)) {
    const status = t.awardedXof >= t.amountXof ? 'fully_awarded' : t.awardedXof > 0 ? 'partially_awarded' : 'unawarded';
    await tx.update(tranches).set({ status }).where(eq(tranches.id, t.id));
  }
}

type AwardRow = typeof awards.$inferSelect;
export async function awardDto(db: DbOrTx, actor: ActorContext, a: AwardRow) {
  const [o] = await db.select({ name: organizations.legalName }).from(organizations).where(eq(organizations.id, a.lenderOrgId));
  const [r] = await db.select({ ref: rfps.ref, blockId: rfps.blockId }).from(rfps).where(eq(rfps.id, a.rfpId));
  const [b] = await db.select({ name: blocks.name }).from(blocks).where(eq(blocks.id, r!.blockId));
  const actions = a.lenderOrgId === actor.orgId && a.status === 'proposed' && hasPermission(actor.permissions, 'award:respond') ? ['accept', 'decline'] : [];
  return { id: a.id, rfpId: a.rfpId, bidId: a.bidId, trancheId: a.trancheId, lenderOrgId: a.lenderOrgId, lenderName: o?.name ?? '', amountXof: a.amountXof, status: a.status, decidedAt: iso(a.decidedAt), lenderResponseAt: iso(a.lenderResponseAt), declineReason: a.declineReason, blockName: b?.name ?? '', rfpRef: r?.ref ?? '', allowedActions: actions };
}

export async function listAwards(db: DbOrTx, actor: ActorContext, rfpId?: string) {
  if (rfpId) {
    const { role } = await loadRfp(db, actor, rfpId);
    const rows = await db.select().from(awards).where(and(eq(awards.rfpId, rfpId), ...(role === 'lender' ? [eq(awards.lenderOrgId, requireOrg(actor))] : []))).orderBy(asc(awards.id));
    return Promise.all(rows.map((a) => awardDto(db, actor, a)));
  }
  await assertVerifiedLender(db, actor);
  const rows = await db.select().from(awards).where(eq(awards.lenderOrgId, requireOrg(actor))).orderBy(desc(awards.id));
  return Promise.all(rows.map((a) => awardDto(db, actor, a)));
}

export async function respondAward(db: Db, actor: ActorContext, id: string, decision: 'accept' | 'decline', reason?: string) {
  if (decision === 'decline' && !reason) throw badRequest('VALIDATION_FAILED', 'A reason is required', [{ path: 'body.reason', message: 'required' }]);
  return db.transaction(async (tx) => {
    const [a] = await tx.select().from(awards).where(eq(awards.id, id)).for('update');
    if (!a || a.lenderOrgId !== actor.orgId) throw notFound('Award');
    await assertVerifiedLender(tx, actor);
    if (a.status !== 'proposed') throw conflict('INVALID_STATE_TRANSITION', `Award is ${a.status}`);
    const [r] = await tx.select().from(rfps).where(eq(rfps.id, a.rfpId));
    const [fr] = await tx.select().from(financingRequests).where(eq(financingRequests.id, r!.financingRequestId));
    const [o] = await tx.select({ name: organizations.legalName }).from(organizations).where(eq(organizations.id, a.lenderOrgId));
    const status = decision === 'accept' ? ('accepted_by_lender' as const) : ('declined_by_lender' as const);
    await tx.update(awards).set({ status, lenderResponseAt: new Date(), declineReason: reason ?? null, version: a.version + 1 }).where(eq(awards.id, id));
    if (decision === 'accept') {
      // Award accepted → lender reads block, seasons, operations, harvest, settlement for the facility life (SPEC §6.3).
      await grant(tx, { resourceType: 'block', resourceId: r!.blockId, granteeOrgId: a.lenderOrgId, scope: 'act', grantedByEvent: 'award.accepted', expiresAt: null });
      await grant(tx, { resourceType: 'dossier', resourceId: fr!.dossierId, granteeOrgId: a.lenderOrgId, scope: 'read', grantedByEvent: 'award.accepted', expiresAt: null });
    } else {
      await tx.update(bids).set({ status: 'not_awarded' }).where(eq(bids.id, a.bidId));
      await refreshTrancheStatus(tx, fr!.id);
      const [b] = await tx.select().from(blocks).where(eq(blocks.id, r!.blockId));
      const remaining = await tx.select().from(awards).where(and(eq(awards.rfpId, r!.id), notInArray(awards.status, ['declined_by_lender', 'cancelled'])));
      if (!remaining.length && b?.status === 'in_financing') {
        await tx.update(financingRequests).set({ status: 'in_tender' }).where(eq(financingRequests.id, fr!.id));
      }
    }
    await notifyOrgRoles(tx, r!.ownerOrgId, ['operator_manager', 'finance_officer'], { channels: ['in_app', 'email'], templateCode: decision === 'accept' ? 'award.accepted' : 'award.declined', data: { lenderName: o?.name, amount: formatXof(a.amountXof), rfpRef: r!.ref, reason: reason ?? '', link: link(`/app/rfps/${r!.id}`) }, link: `/app/rfps/${r!.id}` });
    await audit(tx, actor, { action: `award.${decision === 'accept' ? 'accepted' : 'declined'}`, resourceType: 'award', resourceId: id, after: { reason } });
    await emit(tx, actor, decision === 'accept' ? 'award.accepted' : 'award.declined', { type: 'award', id }, { rfpId: r!.id, financingRequestId: fr!.id, amountXof: a.amountXof, operatorOrgId: r!.ownerOrgId }, r!.ownerOrgId);
  });
}
