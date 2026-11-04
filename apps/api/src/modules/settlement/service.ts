import { and, asc, eq, inArray, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import { blockMachine, computeSettlement, dec, formatXof, roundXof, seasonMachine, settlementMachine, transition, type SettlementInput, type SettlementOutput } from '@jappo/domain';
import { renderFarmerStatementHtml, renderNotification } from '@jappo/templates';
import type { Db, DbOrTx } from '../../db/client';
import { farmerArrears, farmerStatements, payoutInstructions, settlementLenderApprovals, settlementLines, settlementRuns } from './schema';
import { dispatches, escrowReceipts, harvestDeliveries } from '../harvest/schema';
import { escrowAccounts, facilities, facilityFarmerAllocations, repayments, scheduleLines } from '../facilities/schema';
import { offtakeContracts } from '../offtake/schema';
import { tranches } from '../marketplace/schema';
import { blocks, plotAllocations, plots } from '../land/schema';
import { feePolicies, seasons } from '../planning/schema';
import { farmers } from '../farmers/schema';
import { organizations } from '../identity/schema';
import type { ActorContext } from '../../core/context';
import { actorUserId, isPlatformStaff, requireOrg } from '../../core/context';
import { audit } from '../../core/audit';
import { emit } from '../../core/events';
import { nextRef } from '../../core/refs';
import { badRequest, conflict, notFound, unprocessable } from '../../core/errors';
import { hasPermission } from '../../core/authz/permissions';
import { assertVersion } from '../../core/etag';
import { notify, notifyOrgRoles } from '../../core/notify';
import { decryptPii } from '../../core/crypto';
import { csvToObjects } from '../../core/csv';
import { pdfRenderer } from '../../core/adapters/pdf';
import { storeFile } from '../files/service';
import { loadBlock } from '../land/service';
import type { ModuleContext } from '../../core/module';
import { env } from '../../env';

type RunRow = typeof settlementRuns.$inferSelect;
type InstructionRow = typeof payoutInstructions.$inferSelect;
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const link = (path: string) => `${env().API_PUBLIC_URL.replace(/\/$/, '')}${path}`;
const todayIso = () => new Date().toISOString().slice(0, 10);
const addDaysIso = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------- input assembly (SPEC §9.6.1)

export async function assembleInputs(tx: DbOrTx, seasonId: string): Promise<{ input: SettlementInput; meta: { receiptIds: string[]; farmerNames: Record<string, string> } }> {
  const [s] = await tx.select().from(seasons).where(eq(seasons.id, seasonId));
  const [b] = await tx.select().from(blocks).where(eq(blocks.id, s!.blockId));
  // R: lender-confirmed escrow receipts of the block for this season (or not tied to a season).
  const receipts = await tx.select().from(escrowReceipts).where(and(eq(escrowReceipts.blockId, b!.id), eq(escrowReceipts.status, 'confirmed'), or(eq(escrowReceipts.seasonId, seasonId), isNull(escrowReceipts.seasonId))));
  const R = receipts.reduce((x, r) => x + r.amountXof, 0);

  // Accepted kg per ticket (pro rata within its dispatch) with the dispatch's offtake price and grade adjustment.
  const rows = await tx
    .select({ t: harvestDeliveries, d: dispatches, oc: offtakeContracts })
    .from(harvestDeliveries)
    .innerJoin(dispatches, eq(dispatches.id, harvestDeliveries.dispatchId))
    .innerJoin(offtakeContracts, eq(offtakeContracts.id, dispatches.offtakeContractId))
    .where(and(eq(harvestDeliveries.seasonId, seasonId), eq(harvestDeliveries.status, 'dispatched'), inArray(dispatches.status, ['accepted', 'partially_accepted'])));
  const deliveries = new Map<string, SettlementInput['farmers'][number]['deliveries']>();
  for (const r of rows) {
    const total = Number(r.d.netKgTotal);
    const kg = total > 0 ? dec(Number(r.t.netKg)).times(Number(r.d.buyerAcceptedKg ?? 0)).div(total).toNumber() : 0;
    const adj = r.oc.qualitySpec.find((g) => g.grade === r.t.grade)?.adjustmentPct ?? 0;
    deliveries.set(r.t.farmerId, [...(deliveries.get(r.t.farmerId) ?? []), { netKg: kg, priceXofPerKg: r.oc.priceXofPerKg, adjustmentPct: adj }]);
  }

  // Seasonal debts from facility farmer allocations (+ open seasonal arrears carried over with the same lender).
  const facs = await tx.select().from(facilities).where(and(eq(facilities.blockId, b!.id), notInArray(facilities.status, ['pending_cp'])));
  const seasonal = facs.filter((f) => f.seasonId === seasonId && f.trancheType === 'seasonal');
  const allocs = seasonal.length ? await tx.select().from(facilityFarmerAllocations).where(inArray(facilityFarmerAllocations.facilityId, seasonal.map((f) => f.id))) : [];
  const carry = await tx.select({ a: farmerArrears, lender: facilities.lenderOrgId }).from(farmerArrears).innerJoin(facilities, eq(facilities.id, farmerArrears.facilityId)).where(and(eq(farmerArrears.blockId, b!.id), eq(farmerArrears.bucket, 'seasonal_debt'), eq(farmerArrears.status, 'open')));
  const due = new Map<string, Map<string, number>>();
  const addDue = (farmerId: string, facilityId: string, amount: number) => {
    const m = due.get(farmerId) ?? new Map<string, number>();
    m.set(facilityId, (m.get(facilityId) ?? 0) + amount);
    due.set(farmerId, m);
  };
  for (const a of allocs) addDue(a.farmerId, a.facilityId, a.dueXof);
  for (const c of carry) {
    const target = seasonal.find((f) => f.lenderOrgId === c.lender);
    if (target && c.a.originRunId) addDue(c.a.farmerId, target.id, c.a.remainingXof);
  }

  // Fees per farmer from the block fee policy (per-ha fees × the farmer's allocated area).
  const [fp] = await tx.select().from(feePolicies).where(and(eq(feePolicies.blockId, b!.id), isNull(feePolicies.supersededAt))).orderBy(sql`${feePolicies.createdAt} desc`).limit(1);
  const pa = await tx.select({ farmerId: plotAllocations.farmerId, areaHa: plots.areaHa, sharePct: plotAllocations.sharePct }).from(plotAllocations).innerJoin(plots, eq(plots.id, plotAllocations.plotId)).where(and(eq(plotAllocations.blockId, b!.id), eq(plotAllocations.status, 'active')));
  const area = new Map<string, ReturnType<typeof dec>>();
  for (const x of pa) area.set(x.farmerId, (area.get(x.farmerId) ?? dec(0)).plus(dec(Number(x.areaHa)).times(Number(x.sharePct)).div(100)));
  const farmerIds = [...new Set([...area.keys(), ...deliveries.keys(), ...due.keys()])];
  const fs = farmerIds.length ? await tx.select({ id: farmers.id, code: farmers.code, firstName: farmers.firstName, lastName: farmers.lastName }).from(farmers).where(inArray(farmers.id, farmerIds)) : [];
  const ha = (id: string) => area.get(id) ?? dec(0);
  const perHa = (xofPerHa: number | null | undefined, id: string) => roundXof(ha(id).times(xofPerHa ?? 0));

  // Operator investment instalments due this season (operator borrower), unpaid, due by season end + 30 days.
  const inv = facs.filter((f) => f.trancheType === 'investment' && f.borrowerType === 'operator');
  const invLines = inv.length ? await tx.select().from(scheduleLines).where(and(inArray(scheduleLines.facilityId, inv.map((f) => f.id)), ne(scheduleLines.status, 'paid'), sql`${scheduleLines.dueDate} <= ${addDaysIso(s!.endDate, 30)}`)) : [];
  const [tr] = seasonal.length ? await tx.select().from(tranches).where(eq(tranches.id, seasonal[0]!.trancheId)) : [];

  const input: SettlementInput = {
    receiptsTotalXof: R,
    farmers: fs.map((f) => ({
      farmerId: f.id,
      farmerCode: f.code,
      deliveries: deliveries.get(f.id) ?? [],
      seasonalDue: [...(due.get(f.id) ?? new Map()).entries()].map(([facilityId, amountXof]) => ({ facilityId, amountXof })),
      investmentFeeXof: perHa(fp?.investmentRecoveryFeeXofPerHaSeason, f.id),
      landFeeXof: perHa(fp?.landFeeXofPerHaSeason, f.id),
      operatorServiceFeeXof: area.has(f.id) ? (fp?.operatorServiceFeeXofPerFarmerSeason ?? 0) : 0,
      otherDeductionsXof: 0,
    })),
    seasonalFacilities: seasonal.map((f) => ({ facilityId: f.id, dueXof: [...due.values()].reduce((x, m) => x + (m.get(f.id) ?? 0), 0) })),
    operatorInvestmentDueXof: invLines.reduce((x, l) => x + (l.totalXof - l.paidXof), 0),
    solidarity: { mode: b!.solidarityMode, capPct: Number(b!.solidarityCapPct), applies: b!.solidarityMode === 'group' && (tr ? tr.borrowerType !== 'operator' : false) },
  };
  return { input, meta: { receiptIds: receipts.map((r) => r.id), farmerNames: Object.fromEntries(fs.map((f) => [f.id, `${f.firstName} ${f.lastName}`])) } };
}

// ---------------------------------------------------------------- visibility & DTO

/** Run visible to the block owner, lenders with a facility on the block, platform staff. */
export async function loadRun(db: DbOrTx, actor: ActorContext, id: string): Promise<{ run: RunRow; role: 'operator' | 'lender' | 'staff' }> {
  const [run] = await db.select().from(settlementRuns).where(eq(settlementRuns.id, id));
  if (!run) throw notFound('Settlement run');
  if (run.ownerOrgId === actor.orgId) return { run, role: 'operator' };
  if (isPlatformStaff(actor)) return { run, role: 'staff' };
  if (actor.orgId) {
    const [f] = await db.select({ id: facilities.id }).from(facilities).where(and(eq(facilities.blockId, run.blockId), eq(facilities.lenderOrgId, actor.orgId))).limit(1);
    if (f) return { run, role: 'lender' };
  }
  throw notFound('Settlement run');
}

async function blockLenders(db: DbOrTx, blockId: string) {
  return (await db.selectDistinct({ id: facilities.lenderOrgId }).from(facilities).where(and(eq(facilities.blockId, blockId), inArray(facilities.status, ['active', 'in_arrears', 'restructured', 'repaid'])))).map((r) => r.id);
}

export async function runDto(db: DbOrTx, actor: ActorContext, run: RunRow, role: 'operator' | 'lender' | 'staff') {
  const out = run.outputs as SettlementOutput;
  const lenders = await blockLenders(db, run.blockId);
  const approvals = await db.select({ a: settlementLenderApprovals, name: organizations.legalName }).from(settlementLenderApprovals).innerJoin(organizations, eq(organizations.id, settlementLenderApprovals.lenderOrgId)).where(and(eq(settlementLenderApprovals.runId, run.id), isNull(settlementLenderApprovals.voidedAt)));
  const lenderNames = lenders.length ? await db.select({ id: organizations.id, name: organizations.legalName }).from(organizations).where(inArray(organizations.id, lenders)) : [];
  const fs = out.lines?.length ? await db.select({ id: farmers.id, code: farmers.code, firstName: farmers.firstName, lastName: farmers.lastName }).from(farmers).where(inArray(farmers.id, out.lines.map((l) => l.farmerId))) : [];
  const [b] = await db.select({ ref: blocks.ref, name: blocks.name }).from(blocks).where(eq(blocks.id, run.blockId));
  const p = actor.permissions;
  const actions: string[] = [];
  if (role === 'operator') {
    if (['draft', 'computed', 'approved_operator', 'approved_lenders'].includes(run.status) && hasPermission(p, 'settlement:compute')) actions.push('recompute');
    if (run.status === 'computed' && hasPermission(p, 'settlement:approve_operator')) actions.push('approve_operator');
    if (run.status === 'approved_lenders' && hasPermission(p, 'settlement:instruct')) actions.push('instruct');
    if (run.status === 'instructed' && hasPermission(p, 'settlement:reconcile')) actions.push('mark_executed');
    if (run.status === 'executed' && hasPermission(p, 'settlement:reconcile')) actions.push('reconcile');
  }
  if (role === 'lender' && run.status === 'approved_operator' && hasPermission(p, 'settlement:approve_lender') && !approvals.some((a) => a.a.lenderOrgId === actor.orgId)) actions.push('approve_lender');
  return {
    id: run.id,
    ref: run.ref,
    blockId: run.blockId,
    blockRef: b?.ref ?? '',
    blockName: b?.name ?? '',
    seasonId: run.seasonId,
    status: run.status,
    receiptsTotalXof: run.receiptsTotalXof,
    grossCreditTotalXof: out.grossCreditTotalXof ?? 0,
    engineVersion: run.engineVersion,
    computedAt: iso(run.computedAt),
    approvedOperatorAt: iso(run.approvedOperatorAt),
    instructedAt: iso(run.instructedAt),
    executedAt: iso(run.executedAt),
    reconciledAt: iso(run.reconciledAt),
    lines: (out.lines ?? []).map((l) => {
      const f = fs.find((x) => x.id === l.farmerId);
      return {
        farmerId: l.farmerId,
        farmerCode: l.farmerCode,
        farmerName: role === 'operator' || role === 'staff' ? (f ? `${f.firstName} ${f.lastName}` : '') : '',
        grossCreditXof: l.grossCreditXof,
        seasonalPaidXof: l.seasonalPaidXof,
        investmentFeePaidXof: l.investmentFeePaidXof,
        operatorFeesPaidXof: l.operatorFeesPaidXof,
        otherDeductionsXof: l.otherDeductionsXof,
        solidarityContributionXof: l.solidarityContributionXof,
        solidarityReceivedXof: l.solidarityReceivedXof,
        payoutXof: l.payoutXof,
        arrears: l.arrears,
      };
    }),
    distribution: out.distribution ?? { seasonalByFacility: [], investmentToLenderXof: 0, investmentExcessToOperatorXof: 0, operatorXof: 0, farmersTotalXof: 0, roundingToOperatorXof: 0 },
    invariantOk: out.invariants?.sumEqualsReceipts ?? false,
    lenderApprovals: lenderNames.map((l) => {
      const a = approvals.find((x) => x.a.lenderOrgId === l.id);
      return { lenderOrgId: l.id, lenderName: l.name, approvedAt: iso(a?.a.approvedAt ?? null) };
    }),
    version: run.version,
    allowedActions: actions,
  };
}

export async function listRuns(db: DbOrTx, actor: ActorContext, seasonId: string) {
  const rows = await db.select().from(settlementRuns).where(eq(settlementRuns.seasonId, seasonId));
  const out = [];
  for (const r of rows) {
    try {
      const v = await loadRun(db, actor, r.id);
      out.push(await runDto(db, actor, v.run, v.role));
    } catch {
      /* not visible */
    }
  }
  return out;
}

/** All runs visible to the organisation (operator: own blocks; lender: blocks where it has a facility). */
export async function listVisibleRuns(db: DbOrTx, actor: ActorContext) {
  const orgId = requireOrg(actor);
  const rows = await db
    .select()
    .from(settlementRuns)
    .where(isPlatformStaff(actor) ? undefined : sql`(${settlementRuns.ownerOrgId} = ${orgId} or exists (select 1 from facilities f where f.block_id = ${settlementRuns.blockId} and f.lender_org_id = ${orgId}))`)
    .orderBy(sql`${settlementRuns.createdAt} desc`)
    .limit(200);
  return Promise.all(rows.map((r) => runDto(db, actor, r, r.ownerOrgId === orgId ? 'operator' : isPlatformStaff(actor) ? 'staff' : 'lender')));
}

// ---------------------------------------------------------------- compute / recompute

async function compute(tx: DbOrTx, seasonId: string) {
  const { input, meta } = await assembleInputs(tx, seasonId);
  const output = computeSettlement(input);
  if (!output.invariants.sumEqualsReceipts) throw unprocessable('SETTLEMENT_INVARIANT', 'Distribution does not equal receipts');
  return { input, output, meta };
}

/** `POST /seasons/{id}/settlement-runs`: compute (season `harvest|in_progress → settlement`). One run per season. */
export async function createRun(db: Db, actor: ActorContext, seasonId: string) {
  return db.transaction(async (tx) => {
    const [s] = await tx.select().from(seasons).where(eq(seasons.id, seasonId)).for('update');
    if (!s) throw notFound('Season');
    await loadBlock(tx, actor, s.blockId, true);
    const [existing] = await tx.select({ id: settlementRuns.id }).from(settlementRuns).where(eq(settlementRuns.seasonId, seasonId));
    if (existing) throw conflict('SETTLEMENT_EXISTS', 'A settlement run already exists for this season: recompute it');
    if (!['in_progress', 'harvest', 'settlement'].includes(s.status)) throw conflict('SEASON_NOT_SETTLEABLE', `Season is ${s.status}`);
    const { input, output, meta } = await compute(tx, seasonId);
    if (output.receiptsTotalXof <= 0) throw unprocessable('NO_RECEIPTS', 'No lender-confirmed escrow receipt for this season');
    const [run] = await tx
      .insert(settlementRuns)
      .values({ ref: await nextRef(tx, 'STL'), ownerOrgId: s.ownerOrgId, blockId: s.blockId, seasonId, status: transition(settlementMachine, 'draft', 'compute'), receiptsTotalXof: output.receiptsTotalXof, inputs: { ...input, receiptIds: meta.receiptIds }, outputs: output, engineVersion: output.engineVersion, computedAt: new Date(), createdBy: actorUserId(actor) })
      .returning();
    if (s.status !== 'settlement') await tx.update(seasons).set({ status: transition(seasonMachine, s.status, 'start_settlement'), version: s.version + 1 }).where(eq(seasons.id, s.id));
    await audit(tx, actor, { action: 'settlement.computed', resourceType: 'settlement_run', resourceId: run!.id, after: { receiptsTotalXof: output.receiptsTotalXof, distribution: output.distribution } });
    await emit(tx, actor, 'settlement.computed', { type: 'settlement_run', id: run!.id }, { seasonId, receiptsTotalXof: output.receiptsTotalXof }, s.ownerOrgId);
    return run!;
  });
}

export async function recompute(db: Db, actor: ActorContext, id: string, expected: number) {
  await db.transaction(async (tx) => {
    const [run] = await tx.select().from(settlementRuns).where(eq(settlementRuns.id, id)).for('update');
    if (!run || run.ownerOrgId !== actor.orgId) throw notFound('Settlement run');
    assertVersion(run.version, expected);
    const toDraft = run.status === 'draft' ? 'draft' : transition(settlementMachine, run.status, 'recompute');
    const { input, output, meta } = await compute(tx, run.seasonId);
    await tx.update(settlementLenderApprovals).set({ voidedAt: new Date() }).where(and(eq(settlementLenderApprovals.runId, id), isNull(settlementLenderApprovals.voidedAt)));
    await tx
      .update(settlementRuns)
      .set({ status: transition(settlementMachine, toDraft, 'compute'), receiptsTotalXof: output.receiptsTotalXof, inputs: { ...input, receiptIds: meta.receiptIds }, outputs: output, engineVersion: output.engineVersion, computedAt: new Date(), approvedOperatorAt: null, approvedOperatorBy: null, version: run.version + 1 })
      .where(eq(settlementRuns.id, id));
    await audit(tx, actor, { action: 'settlement.recomputed', resourceType: 'settlement_run', resourceId: id, before: { status: run.status, receiptsTotalXof: run.receiptsTotalXof }, after: { receiptsTotalXof: output.receiptsTotalXof } });
  });
}

// ---------------------------------------------------------------- approvals (SPEC §8.8)

export async function approveOperator(db: Db, actor: ActorContext, id: string, expected: number) {
  await db.transaction(async (tx) => {
    const [run] = await tx.select().from(settlementRuns).where(eq(settlementRuns.id, id)).for('update');
    if (!run || run.ownerOrgId !== actor.orgId) throw notFound('Settlement run');
    assertVersion(run.version, expected);
    const to = transition(settlementMachine, run.status, 'approve_operator');
    await tx.update(settlementRuns).set({ status: to, approvedOperatorBy: actorUserId(actor), approvedOperatorAt: new Date(), version: run.version + 1 }).where(eq(settlementRuns.id, id));
    await audit(tx, actor, { action: 'settlement.approved_operator', resourceType: 'settlement_run', resourceId: id });
    for (const l of await blockLenders(tx, run.blockId)) await notifyOrgRoles(tx, l, ['credit_officer'], { channels: ['in_app', 'email'], templateCode: 'settlement.to_approve', data: { ref: run.ref, amount: formatXof(run.receiptsTotalXof), link: link(`/app/settlements/${run.id}`) }, link: `/app/settlements/${run.id}` });
  });
}

export async function approveLender(db: Db, actor: ActorContext, id: string) {
  const orgId = requireOrg(actor);
  await db.transaction(async (tx) => {
    const [run] = await tx.select().from(settlementRuns).where(eq(settlementRuns.id, id)).for('update');
    if (!run) throw notFound('Settlement run');
    const lenders = await blockLenders(tx, run.blockId);
    if (!lenders.includes(orgId)) throw notFound('Settlement run');
    if (run.status !== 'approved_operator') throw conflict('INVALID_STATE_TRANSITION', `Settlement is ${run.status}`);
    const [dup] = await tx.select({ id: settlementLenderApprovals.id }).from(settlementLenderApprovals).where(and(eq(settlementLenderApprovals.runId, id), eq(settlementLenderApprovals.lenderOrgId, orgId), isNull(settlementLenderApprovals.voidedAt)));
    if (dup) throw conflict('ALREADY_APPROVED', 'Your organisation already approved this settlement');
    await tx.insert(settlementLenderApprovals).values({ runId: id, lenderOrgId: orgId, approvedBy: actorUserId(actor)!, createdBy: actorUserId(actor) });
    const approved = await tx.select({ l: settlementLenderApprovals.lenderOrgId }).from(settlementLenderApprovals).where(and(eq(settlementLenderApprovals.runId, id), isNull(settlementLenderApprovals.voidedAt)));
    const all = lenders.every((l) => approved.some((a) => a.l === l));
    if (all) await tx.update(settlementRuns).set({ status: transition(settlementMachine, run.status, 'approve_lenders'), version: run.version + 1 }).where(eq(settlementRuns.id, id));
    else await tx.update(settlementRuns).set({ version: run.version + 1 }).where(eq(settlementRuns.id, id));
    await audit(tx, actor, { action: 'settlement.approved_lender', resourceType: 'settlement_run', resourceId: id, after: { lenderOrgId: orgId, allApproved: all } });
    if (all) await notifyOrgRoles(tx, run.ownerOrgId, ['operator_manager', 'finance_officer'], { channels: ['in_app', 'email'], templateCode: 'settlement.approved', data: { ref: run.ref, link: link(`/app/settlements/${run.id}`) }, link: `/app/settlements/${run.id}` });
  });
}

// ---------------------------------------------------------------- instruct: instructions, arrears, statements

export async function instruct(ctx: ModuleContext, actor: ActorContext, id: string, expected: number) {
  await ctx.db.transaction(async (tx) => {
    const [run] = await tx.select().from(settlementRuns).where(eq(settlementRuns.id, id)).for('update');
    if (!run || run.ownerOrgId !== actor.orgId) throw notFound('Settlement run');
    assertVersion(run.version, expected);
    const to = transition(settlementMachine, run.status, 'instruct');
    const out = run.outputs as SettlementOutput;
    const facs = await tx.select().from(facilities).where(eq(facilities.blockId, run.blockId));
    const orgIds = [...new Set([run.ownerOrgId, ...facs.map((f) => f.lenderOrgId)])];
    const orgs = await tx.select({ id: organizations.id, name: organizations.legalName }).from(organizations).where(inArray(organizations.id, orgIds));
    const orgName = (oid: string) => orgs.find((o) => o.id === oid)?.name ?? '';
    const escrow = async (lenderOrgId: string) => {
      const [e] = await tx.select().from(escrowAccounts).where(and(eq(escrowAccounts.blockId, run.blockId), eq(escrowAccounts.lenderOrgId, lenderOrgId))).limit(1);
      return e?.accountNumberMasked ?? '—';
    };
    let seq = 0;
    const ins: (typeof payoutInstructions.$inferInsert)[] = [];
    const push = (x: Omit<typeof payoutInstructions.$inferInsert, 'runId' | 'ref'>) => {
      if (x.amountXof <= 0) return;
      seq++;
      ins.push({ ...x, runId: id, ref: `${run.ref}-${String(seq).padStart(3, '0')}` });
    };
    for (const s of out.distribution.seasonalByFacility) {
      const f = facs.find((x) => x.id === s.facilityId)!;
      push({ beneficiaryType: 'lender', beneficiaryId: f.lenderOrgId, beneficiaryName: orgName(f.lenderOrgId), facilityId: f.id, channel: 'bank_transfer', destinationMasked: await escrow(f.lenderOrgId), amountXof: s.amountXof, provider: 'manual' });
    }
    const invFac = facs.find((f) => f.trancheType === 'investment' && f.borrowerType === 'operator');
    if (invFac) push({ beneficiaryType: 'lender', beneficiaryId: invFac.lenderOrgId, beneficiaryName: orgName(invFac.lenderOrgId), facilityId: invFac.id, channel: 'bank_transfer', destinationMasked: await escrow(invFac.lenderOrgId), amountXof: out.distribution.investmentToLenderXof, provider: 'manual' });
    push({ beneficiaryType: 'operator', beneficiaryId: run.ownerOrgId, beneficiaryName: orgName(run.ownerOrgId), channel: 'bank_transfer', destinationMasked: 'operator account', amountXof: out.distribution.operatorXof, provider: 'manual' });
    const fs = out.lines.length ? await tx.select().from(farmers).where(inArray(farmers.id, out.lines.map((l) => l.farmerId))) : [];
    for (const l of out.lines) {
      const f = fs.find((x) => x.id === l.farmerId)!;
      const wallet = f.walletVerifiedAt && f.mobileWalletNumberEnc && f.mobileWalletProvider !== 'none';
      if (wallet) push({ beneficiaryType: 'farmer', beneficiaryId: f.id, beneficiaryName: `${f.firstName} ${f.lastName}`, channel: 'mobile_money', destinationMasked: `**** ${f.mobileWalletLast4 ?? decryptPii(f.mobileWalletNumberEnc!).slice(-4)}`, amountXof: l.payoutXof, provider: f.mobileWalletProvider === 'orange_money' ? 'orange_money' : f.mobileWalletProvider === 'wave' ? 'wave' : 'manual' });
      else push({ beneficiaryType: 'farmer', beneficiaryId: f.id, beneficiaryName: `${f.firstName} ${f.lastName}`, channel: 'bank_transfer', destinationMasked: `${orgName(run.ownerOrgId)} (in trust)`, heldForFarmer: true, amountXof: l.payoutXof, provider: 'manual' });
    }
    if (ins.length) await tx.insert(payoutInstructions).values(ins);
    // Lines, arrears and statements become final at instruction time.
    const seasonalFac = facs.filter((f) => f.seasonId === run.seasonId && f.trancheType === 'seasonal');
    for (const l of out.lines) {
      await tx.insert(settlementLines).values({ runId: id, farmerId: l.farmerId, grossCreditXof: l.grossCreditXof, seasonalDebtPaidXof: l.seasonalPaidXof, investmentFeePaidXof: l.investmentFeePaidXof, operatorFeesPaidXof: l.operatorFeesPaidXof, otherDeductionsXof: l.otherDeductionsXof, solidarityContributionXof: l.solidarityContributionXof, solidarityReceivedXof: l.solidarityReceivedXof, payoutXof: l.payoutXof, arrearsCreatedXof: l.arrears });
      const mk = async (bucket: 'seasonal_debt' | 'investment_fee' | 'operator_fees', amount: number, facilityId: string | null) => {
        if (amount > 0) await tx.insert(farmerArrears).values({ farmerId: l.farmerId, blockId: run.blockId, ownerOrgId: run.ownerOrgId, originRunId: id, bucket, amountXof: amount, remainingXof: amount, facilityId });
      };
      await mk('seasonal_debt', l.arrears.seasonalDebtXof, seasonalFac[0]?.id ?? null);
      await mk('investment_fee', l.arrears.investmentFeeXof, null);
      await mk('operator_fees', l.arrears.operatorFeesXof, null);
    }
    // Carried-over arrears consumed by this run are settled.
    await tx.update(farmerArrears).set({ status: 'settled', remainingXof: 0 }).where(and(eq(farmerArrears.blockId, run.blockId), eq(farmerArrears.status, 'open'), eq(farmerArrears.bucket, 'seasonal_debt'), ne(farmerArrears.originRunId, id)));
    await tx.update(settlementRuns).set({ status: to, instructedAt: new Date(), version: run.version + 1 }).where(eq(settlementRuns.id, id));
    await createStatements(ctx, tx, actor, { ...run, status: to });
    await audit(tx, actor, { action: 'settlement.instructed', resourceType: 'settlement_run', resourceId: id, after: { instructions: ins.length } });
    await emit(tx, actor, 'settlement.instructed', { type: 'settlement_run', id }, { instructions: ins.length }, run.ownerOrgId);
  });
}

async function createStatements(ctx: ModuleContext, tx: DbOrTx, actor: ActorContext, run: RunRow) {
  const out = run.outputs as SettlementOutput;
  const [b] = await tx.select().from(blocks).where(eq(blocks.id, run.blockId));
  const [s] = await tx.select().from(seasons).where(eq(seasons.id, run.seasonId));
  const [org] = await tx.select().from(organizations).where(eq(organizations.id, run.ownerOrgId));
  for (const l of out.lines) {
    const [f] = await tx.select().from(farmers).where(eq(farmers.id, l.farmerId));
    const tickets = await tx.select().from(harvestDeliveries).where(and(eq(harvestDeliveries.seasonId, run.seasonId), eq(harvestDeliveries.farmerId, l.farmerId), ne(harvestDeliveries.status, 'void'))).orderBy(asc(harvestDeliveries.deliveredAt));
    const ps = await tx.select({ code: plots.code, areaHa: plots.areaHa, sharePct: plotAllocations.sharePct }).from(plotAllocations).innerJoin(plots, eq(plots.id, plotAllocations.plotId)).where(and(eq(plotAllocations.farmerId, l.farmerId), eq(plotAllocations.blockId, run.blockId)));
    const [ins] = await tx.select().from(payoutInstructions).where(and(eq(payoutInstructions.runId, run.id), eq(payoutInstructions.beneficiaryId, l.farmerId)));
    const locale = f!.locale === 'en' ? 'en' : 'fr';
    const sms = renderNotification('settlement.statement', locale, { name: f!.firstName, gross: formatXof(l.grossCreditXof), debt: formatXof(l.seasonalPaidXof), fees: formatXof(l.investmentFeePaidXof + l.operatorFeesPaidXof + l.otherDeductionsXof), payout: formatXof(l.payoutXof), arrears: formatXof(l.arrears.seasonalDebtXof + l.arrears.investmentFeeXof + l.arrears.operatorFeesXof), ref: ins?.ref ?? run.ref }).sms;
    const html = renderFarmerStatementHtml(
      {
        runRef: run.ref,
        date: todayIso(),
        operator: org?.legalName ?? '',
        block: `${b!.ref} · ${b!.name}`,
        season: s!.name,
        farmer: { name: `${f!.firstName} ${f!.lastName}`, code: f!.code, village: f!.village ?? '' },
        plots: ps.map((p) => ({ code: p.code, areaHa: Number(p.areaHa), sharePct: Number(p.sharePct) })),
        tickets: tickets.map((t) => ({ ticketNo: t.ticketNo, date: t.deliveredAt.toISOString().slice(0, 10), netKg: Number(t.netKg), grade: t.grade, status: t.status })),
        line: l,
        paymentRef: ins?.ref ?? null,
        paymentChannel: ins ? `${ins.channel === 'mobile_money' ? ins.provider : 'bank'} · ${ins.destinationMasked}` : null,
      },
      locale,
    );
    const file = await storeFile(ctx, tx, { ...actor, orgId: run.ownerOrgId }, { filename: `${run.ref}-${f!.code}.pdf`, declaredMime: 'application/pdf', buffer: await pdfRenderer().render(html) }, { linkedType: 'farmer_statement', linkedId: f!.id, ownerOrgId: run.ownerOrgId });
    await tx.insert(farmerStatements).values({ runId: run.id, farmerId: f!.id, pdfFileId: file.id, smsText: sms });
  }
}

// ---------------------------------------------------------------- instructions: list, export, confirm

export const instructionDto = (i: InstructionRow) => ({
  id: i.id,
  ref: i.ref,
  beneficiaryType: i.beneficiaryType,
  beneficiaryId: i.beneficiaryId,
  beneficiaryName: i.beneficiaryName,
  facilityId: i.facilityId,
  channel: i.channel,
  destinationMasked: i.destinationMasked,
  heldForFarmer: i.heldForFarmer,
  amountXof: i.amountXof,
  status: i.status,
  provider: i.provider,
  providerRef: i.providerRef,
  confirmedAt: iso(i.confirmedAt),
  failureReason: i.failureReason,
  version: i.version,
});

export async function listInstructions(db: DbOrTx, actor: ActorContext, runId: string) {
  const { run, role } = await loadRun(db, actor, runId);
  const rows = await db.select().from(payoutInstructions).where(eq(payoutInstructions.runId, run.id)).orderBy(asc(payoutInstructions.ref));
  // Lenders see their own lines and the aggregate of others (not farmer destinations).
  return role === 'lender' ? rows.filter((r) => r.beneficiaryType !== 'farmer' || true).map((r) => ({ ...instructionDto(r), destinationMasked: r.beneficiaryId === actor.orgId ? r.destinationMasked : '—' })) : rows.map(instructionDto);
}

export const EXPORT_FORMATS = ['generic', 'wave', 'orange_money'] as const;

/** CSV exports (SPEC §10.14): generic bank file, Wave bulk payout, Orange Money bulk payout. Marks rows exported. */
export async function exportInstructions(db: Db, actor: ActorContext, runId: string, format: (typeof EXPORT_FORMATS)[number]) {
  const { run, role } = await loadRun(db, actor, runId);
  if (role !== 'operator') throw notFound('Settlement run');
  if (!['instructed', 'executed', 'reconciled'].includes(run.status)) throw conflict('NOT_INSTRUCTED', 'Instructions are produced when the settlement is instructed');
  const rows = await db.select().from(payoutInstructions).where(eq(payoutInstructions.runId, run.id)).orderBy(asc(payoutInstructions.ref));
  const fs = await db.select().from(farmers).where(inArray(farmers.id, rows.filter((r) => r.beneficiaryType === 'farmer').map((r) => r.beneficiaryId).concat(['00000000-0000-0000-0000-000000000000'])));
  const wallet = (id: string) => {
    const f = fs.find((x) => x.id === id);
    return f?.mobileWalletNumberEnc ? decryptPii(f.mobileWalletNumberEnc) : '';
  };
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  let header: string[];
  let pick: InstructionRow[];
  let toRow: (r: InstructionRow) => unknown[];
  if (format === 'wave') {
    pick = rows.filter((r) => r.channel === 'mobile_money' && r.provider === 'wave');
    header = ['phone_number', 'amount', 'currency', 'name', 'client_reference'];
    toRow = (r) => [wallet(r.beneficiaryId), r.amountXof, 'XOF', r.beneficiaryName, r.ref];
  } else if (format === 'orange_money') {
    pick = rows.filter((r) => r.channel === 'mobile_money' && r.provider === 'orange_money');
    header = ['MSISDN', 'MONTANT', 'NOM', 'REFERENCE'];
    toRow = (r) => [wallet(r.beneficiaryId).replace(/^\+/, ''), r.amountXof, r.beneficiaryName, r.ref];
  } else {
    pick = rows;
    header = ['reference', 'beneficiary_type', 'beneficiary', 'channel', 'provider', 'destination', 'held_for_farmer', 'amount_xof'];
    toRow = (r) => [r.ref, r.beneficiaryType, r.beneficiaryName, r.channel, r.provider, r.destinationMasked, r.heldForFarmer ? 'yes' : 'no', r.amountXof];
  }
  await db.transaction(async (tx) => {
    const ids = pick.filter((r) => r.status === 'pending').map((r) => r.id);
    if (ids.length) await tx.update(payoutInstructions).set({ status: 'exported' }).where(inArray(payoutInstructions.id, ids));
    await audit(tx, actor, { action: 'settlement.instructions_exported', resourceType: 'settlement_run', resourceId: run.id, after: { format, rows: pick.length } });
  });
  const sep = format === 'orange_money' ? ';' : ',';
  return [header.join(sep), ...pick.map((r) => toRow(r).map(q).join(sep))].join('\n') + '\n';
}

async function postRepayment(tx: DbOrTx, i: InstructionRow, run: RunRow) {
  if (i.beneficiaryType !== 'lender' || !i.facilityId) return;
  const [f] = await tx.select().from(facilities).where(eq(facilities.id, i.facilityId)).for('update');
  const lines = await tx.select().from(scheduleLines).where(and(eq(scheduleLines.facilityId, f!.id), ne(scheduleLines.status, 'paid'))).orderBy(asc(scheduleLines.seq));
  let left = i.amountXof;
  let interest = 0;
  let principal = 0;
  for (const l of lines) {
    if (left <= 0) break;
    const open = l.totalXof - l.paidXof;
    const pay = Math.min(open, left);
    // Within a line: interest first, then principal (SPEC §9.6 seasonal debt = interest + principal).
    const paidInterestBefore = Math.min(l.paidXof, l.interestXof);
    const iPart = Math.min(pay, l.interestXof - paidInterestBefore);
    interest += iPart;
    principal += pay - iPart;
    const paid = l.paidXof + pay;
    await tx.update(scheduleLines).set({ paidXof: paid, status: paid >= l.totalXof ? 'paid' : 'partial' }).where(eq(scheduleLines.id, l.id));
    left -= pay;
  }
  await tx.insert(repayments).values({ facilityId: f!.id, settlementRunId: run.id, amountXof: i.amountXof, principalXof: principal, interestXof: interest, feesXof: Math.max(left, 0), valueDate: todayIso(), source: 'settlement', reference: i.providerRef ?? i.ref });
  const remaining = await tx.select({ id: scheduleLines.id }).from(scheduleLines).where(and(eq(scheduleLines.facilityId, f!.id), ne(scheduleLines.status, 'paid')));
  if (!remaining.length && ['active', 'in_arrears'].includes(f!.status)) await tx.update(facilities).set({ status: 'repaid', version: f!.version + 1 }).where(eq(facilities.id, f!.id));
  else if (f!.status === 'in_arrears') {
    const overdue = await tx.select({ id: scheduleLines.id }).from(scheduleLines).where(and(eq(scheduleLines.facilityId, f!.id), eq(scheduleLines.status, 'overdue')));
    if (!overdue.length) await tx.update(facilities).set({ status: 'active', version: f!.version + 1 }).where(eq(facilities.id, f!.id));
  }
}

export async function actOnInstruction(db: Db, actor: ActorContext, id: string, action: 'confirm' | 'fail', body: { providerRef?: string | null; reason?: string | null }) {
  return db.transaction(async (tx) => {
    const [i] = await tx.select().from(payoutInstructions).where(eq(payoutInstructions.id, id)).for('update');
    if (!i) throw notFound('Payout instruction');
    const [run] = await tx.select().from(settlementRuns).where(eq(settlementRuns.id, i.runId));
    // Operator confirms farmer/operator payouts; the receiving lender confirms its own lines.
    const lenderOwn = i.beneficiaryType === 'lender' && i.beneficiaryId === actor.orgId;
    if (run!.ownerOrgId !== actor.orgId && !lenderOwn) throw notFound('Payout instruction');
    if (!['instructed', 'executed'].includes(run!.status)) throw conflict('INVALID_STATE_TRANSITION', `Settlement is ${run!.status}`);
    if (i.status === 'confirmed') throw conflict('ALREADY_CONFIRMED', 'Instruction already confirmed');
    if (action === 'fail' && !body.reason?.trim()) throw badRequest('VALIDATION_FAILED', 'A failure reason is required', [{ path: 'body.reason', message: 'required' }]);
    const [u] = await tx
      .update(payoutInstructions)
      .set(action === 'confirm' ? { status: 'confirmed', confirmedAt: new Date(), providerRef: body.providerRef ?? i.providerRef, failureReason: null, version: i.version + 1 } : { status: 'failed', failureReason: body.reason!.trim(), version: i.version + 1 })
      .where(eq(payoutInstructions.id, id))
      .returning();
    if (action === 'confirm') await postRepayment(tx, u!, run!);
    await audit(tx, actor, { action: `payout.${action === 'confirm' ? 'confirmed' : 'failed'}`, resourceType: 'payout_instruction', resourceId: id, after: body });
    return instructionDto(u!);
  });
}

/** CSV with columns `reference,status,provider_ref,reason` (status: confirmed|failed). */
export async function importConfirmations(db: Db, actor: ActorContext, runId: string, csvText: string) {
  const { run, role } = await loadRun(db, actor, runId);
  if (role !== 'operator') throw notFound('Settlement run');
  const { rows } = csvToObjects(csvText);
  const results: { reference: string; status: 'confirmed' | 'failed' | 'skipped'; error: string | null }[] = [];
  for (const r of rows) {
    const reference = (r.reference ?? r.client_reference ?? r.REFERENCE ?? '').trim();
    const st = (r.status ?? r.STATUT ?? '').trim().toLowerCase();
    const [i] = await db.select().from(payoutInstructions).where(and(eq(payoutInstructions.runId, run.id), eq(payoutInstructions.ref, reference)));
    if (!i) {
      results.push({ reference, status: 'skipped', error: 'unknown reference' });
      continue;
    }
    if (i.status === 'confirmed') {
      results.push({ reference, status: 'skipped', error: 'already confirmed' });
      continue;
    }
    const ok = ['confirmed', 'success', 'succeeded', 'ok', 'paid'].includes(st);
    try {
      await actOnInstruction(db, actor, i.id, ok ? 'confirm' : 'fail', { providerRef: r.provider_ref ?? r.transaction_id ?? null, reason: ok ? null : r.reason || `status ${st || 'missing'}` });
      results.push({ reference, status: ok ? 'confirmed' : 'failed', error: null });
    } catch (e) {
      results.push({ reference, status: 'skipped', error: (e as Error).message });
    }
  }
  return { results };
}

// ---------------------------------------------------------------- executed / reconciled

export async function markExecuted(db: Db, actor: ActorContext, id: string, expected: number) {
  await db.transaction(async (tx) => {
    const [run] = await tx.select().from(settlementRuns).where(eq(settlementRuns.id, id)).for('update');
    if (!run || run.ownerOrgId !== actor.orgId) throw notFound('Settlement run');
    assertVersion(run.version, expected);
    const to = transition(settlementMachine, run.status, 'mark_executed');
    const open = await tx.select({ ref: payoutInstructions.ref }).from(payoutInstructions).where(and(eq(payoutInstructions.runId, id), notInArray(payoutInstructions.status, ['confirmed', 'failed'])));
    if (open.length) throw unprocessable('INSTRUCTIONS_PENDING', `Unconfirmed instructions: ${open.map((o) => o.ref).join(', ')}`);
    await tx.update(settlementRuns).set({ status: to, executedAt: new Date(), version: run.version + 1 }).where(eq(settlementRuns.id, id));
    await audit(tx, actor, { action: 'settlement.executed', resourceType: 'settlement_run', resourceId: id });
  });
}

/** Reconciled when Σ confirmed payouts = receipts total (± 0 XOF): season closed, block back to financed. */
export async function reconcile(db: Db, actor: ActorContext, id: string, expected: number) {
  await db.transaction(async (tx) => {
    const [run] = await tx.select().from(settlementRuns).where(eq(settlementRuns.id, id)).for('update');
    if (!run || run.ownerOrgId !== actor.orgId) throw notFound('Settlement run');
    assertVersion(run.version, expected);
    const to = transition(settlementMachine, run.status, 'reconcile');
    const [{ total } = { total: 0 }] = await tx.select({ total: sql<number>`coalesce(sum(${payoutInstructions.amountXof}) filter (where ${payoutInstructions.status} = 'confirmed'), 0)::bigint` }).from(payoutInstructions).where(eq(payoutInstructions.runId, id));
    if (Number(total) !== run.receiptsTotalXof) throw unprocessable('RECONCILIATION_MISMATCH', `Confirmed payouts ${formatXof(Number(total))} ≠ receipts ${formatXof(run.receiptsTotalXof)}`);
    await tx.update(settlementRuns).set({ status: to, reconciledAt: new Date(), version: run.version + 1 }).where(eq(settlementRuns.id, id));
    const [s] = await tx.select().from(seasons).where(eq(seasons.id, run.seasonId)).for('update');
    if (s?.status === 'settlement') await tx.update(seasons).set({ status: transition(seasonMachine, s.status, 'close'), version: s.version + 1 }).where(eq(seasons.id, s.id));
    const [b] = await tx.select().from(blocks).where(eq(blocks.id, run.blockId)).for('update');
    if (b?.status === 'active') await tx.update(blocks).set({ status: transition(blockMachine, b.status, 'season_settled'), version: b.version + 1 }).where(eq(blocks.id, b.id));
    await audit(tx, actor, { action: 'settlement.reconciled', resourceType: 'settlement_run', resourceId: id, after: { confirmedXof: Number(total) } });
    await emit(tx, actor, 'settlement.reconciled', { type: 'settlement_run', id }, { seasonId: run.seasonId, receiptsTotalXof: run.receiptsTotalXof }, run.ownerOrgId);
  });
}

// ---------------------------------------------------------------- statements & arrears

export async function listStatements(db: DbOrTx, actor: ActorContext, runId: string) {
  const { run, role } = await loadRun(db, actor, runId);
  if (role === 'lender') throw notFound('Settlement run'); // farmer statements are personal data of the operator's farmers
  const rows = await db.select({ s: farmerStatements, code: farmers.code, firstName: farmers.firstName, lastName: farmers.lastName }).from(farmerStatements).innerJoin(farmers, eq(farmers.id, farmerStatements.farmerId)).where(eq(farmerStatements.runId, run.id)).orderBy(asc(farmers.code));
  return rows.map((r) => ({ id: r.s.id, farmerId: r.s.farmerId, farmerCode: r.code, farmerName: `${r.firstName} ${r.lastName}`, smsText: r.s.smsText, hasPdf: Boolean(r.s.pdfFileId), sentAt: iso(r.s.sentAt) }));
}

export async function sendStatements(db: Db, actor: ActorContext, runId: string) {
  return db.transaction(async (tx) => {
    const { run, role } = await loadRun(tx, actor, runId);
    if (role !== 'operator') throw notFound('Settlement run');
    const rows = await tx.select({ s: farmerStatements, f: farmers }).from(farmerStatements).innerJoin(farmers, eq(farmers.id, farmerStatements.farmerId)).where(and(eq(farmerStatements.runId, run.id), isNull(farmerStatements.sentAt)));
    for (const r of rows) {
      if (r.f.phone) await notify(tx, { recipientType: 'farmer', recipientId: r.f.id, orgId: r.f.ownerOrgId, channels: ['sms'], templateCode: 'settlement.statement_sms', locale: r.f.locale, phone: r.f.phone, data: { text: r.s.smsText } });
      await tx.update(farmerStatements).set({ sentAt: new Date() }).where(eq(farmerStatements.id, r.s.id));
    }
    await audit(tx, actor, { action: 'statement.sent', resourceType: 'settlement_run', resourceId: run.id, after: { count: rows.length } });
    return { sent: rows.length };
  });
}

export async function farmerArrearsList(db: DbOrTx, actor: ActorContext, farmerId: string) {
  const [f] = await db.select().from(farmers).where(eq(farmers.id, farmerId));
  if (!f || (f.ownerOrgId !== actor.orgId && !isPlatformStaff(actor) && !(actor.principal.type === 'farmer' && actor.principal.farmerId === farmerId))) throw notFound('Farmer');
  const rows = await db.select().from(farmerArrears).where(eq(farmerArrears.farmerId, farmerId)).orderBy(asc(farmerArrears.createdAt));
  return rows.map((a) => ({ id: a.id, blockId: a.blockId, originRunId: a.originRunId, bucket: a.bucket, amountXof: a.amountXof, remainingXof: a.remainingXof, facilityId: a.facilityId, status: a.status, createdAt: a.createdAt.toISOString() }));
}
