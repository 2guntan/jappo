import { and, desc, eq, gte, inArray, isNull, lte, ne, notInArray, sql } from 'drizzle-orm';
import { computeKpis, daysOverdue, expectedKgByFarmer, type KpiInput, type Kpis } from '@jappo/domain';
import { renderReportHtml } from '@jappo/templates';
import type { Db, DbOrTx } from '../../db/client';
import { kpiSnapshots, reports } from './schema';
import { blocks, plotAllocations } from '../land/schema';
import { budgetLines, plantings, seasons } from '../planning/schema';
import { farmers } from '../farmers/schema';
import { disbursements, facilities, repayments, scheduleLines } from '../facilities/schema';
import { buyerInvoices, escrowReceipts, harvestDeliveries } from '../harvest/schema';
import { alerts, serviceDeliveries } from '../operations/schema';
import { settlementLines, settlementRuns } from '../settlement/schema';
import { financingRequests } from '../marketplace/schema';
import { riskCovers } from '../dossier/schema';
import { contracts, contractParties } from '../agreements/schema';
import { organizations } from '../identity/schema';
import type { ActorContext } from '../../core/context';
import { actorUserId, isPlatformStaff, requireOrg } from '../../core/context';
import { audit } from '../../core/audit';
import { badRequest, notFound } from '../../core/errors';
import { getSetting } from '../../core/settings';
import { pdfRenderer } from '../../core/adapters/pdf';
import { storeFile } from '../files/service';
import { loadBlock } from '../land/service';
import type { ModuleContext } from '../../core/module';

const todayIso = () => new Date().toISOString().slice(0, 10);
export const PLATFORM_SCOPE_ID = '00000000-0000-0000-0000-000000000000';
const isoDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

// ---------------------------------------------------------------- KPI input assembly (SPEC §9.9)

/** KPI inputs for a set of blocks (their current/latest season) and facilities. */
async function kpiInput(db: DbOrTx, blockIds: string[], facilityFilter: (f: typeof facilities.$inferSelect) => boolean, asOf: string): Promise<KpiInput> {
  const empty: KpiInput = { asOf, plantedHa: 0, baseProductionT: 0, farmers: [], facilities: [], expectedKg: 0, deliveredKg: 0, invoices: [], settlement: [], serviceCostXof: 0, submittedAt: null, firstDisbursementAt: null, openAlerts: [] };
  if (!blockIds.length) return empty;
  const ss = await db.select().from(seasons).where(and(inArray(seasons.blockId, blockIds), ne(seasons.status, 'cancelled'))).orderBy(desc(seasons.startDate));
  const latest = new Map<string, (typeof ss)[number]>();
  for (const s of ss) if (!latest.has(s.blockId)) latest.set(s.blockId, s);
  const seasonIds = [...latest.values()].map((s) => s.id);
  const pls = seasonIds.length ? await db.select().from(plantings).where(inArray(plantings.seasonId, seasonIds)) : [];
  const allocs = await db.select().from(plotAllocations).where(and(inArray(plotAllocations.blockId, blockIds), eq(plotAllocations.status, 'active')));
  const farmerIds = [...new Set(allocs.map((a) => a.farmerId))];
  const fs = farmerIds.length ? await db.select({ id: farmers.id, sex: farmers.sex, birthYear: farmers.birthYear, baseline: farmers.baselineIncomeXof }).from(farmers).where(inArray(farmers.id, farmerIds)) : [];
  const expected = expectedKgByFarmer(
    pls.map((p) => ({ plotId: p.plotId, areaHa: Number(p.areaHa), yieldBaseTHa: p.yieldBaseTHa === null ? null : Number(p.yieldBaseTHa), postHarvestLossPct: p.postHarvestLossPct === null ? null : Number(p.postHarvestLossPct), deliveryRatePct: p.deliveryRatePct === null ? null : Number(p.deliveryRatePct) })),
    allocs.map((a) => ({ plotId: a.plotId, farmerId: a.farmerId, sharePct: Number(a.sharePct) })),
  );
  const facs = (await db.select().from(facilities).where(inArray(facilities.blockId, blockIds))).filter(facilityFilter);
  const facIds = facs.map((f) => f.id);
  const lines = facIds.length ? await db.select().from(scheduleLines).where(inArray(scheduleLines.facilityId, facIds)) : [];
  const dsb = facIds.length ? await db.select().from(disbursements).where(and(inArray(disbursements.facilityId, facIds), eq(disbursements.status, 'confirmed'))) : [];
  const repaidPrincipal = facIds.length ? await db.select({ id: repayments.facilityId, p: sql<string>`sum(${repayments.principalXof})` }).from(repayments).where(inArray(repayments.facilityId, facIds)).groupBy(repayments.facilityId) : [];
  const tickets = seasonIds.length ? await db.select({ kg: harvestDeliveries.netKg }).from(harvestDeliveries).where(and(inArray(harvestDeliveries.seasonId, seasonIds), notInArray(harvestDeliveries.status, ['void', 'rejected']))) : [];
  const invs = seasonIds.length ? await db.select().from(buyerInvoices).where(inArray(buyerInvoices.seasonId, seasonIds)) : [];
  const recs = invs.length ? await db.select({ inv: escrowReceipts.buyerInvoiceId, at: escrowReceipts.confirmedByLenderAt }).from(escrowReceipts).where(and(inArray(escrowReceipts.buyerInvoiceId, invs.map((i) => i.id)), eq(escrowReceipts.status, 'confirmed'))) : [];
  const runs = seasonIds.length ? await db.select().from(settlementRuns).where(inArray(settlementRuns.seasonId, seasonIds)) : [];
  const sl = runs.length ? await db.select().from(settlementLines).where(inArray(settlementLines.runId, runs.map((r) => r.id))) : [];
  const delivered = seasonIds.length ? await db.select({ id: serviceDeliveries.budgetLineId }).from(serviceDeliveries).where(inArray(serviceDeliveries.seasonId, seasonIds)) : [];
  const bl = delivered.length ? await db.select({ qty: budgetLines.qty, unit: budgetLines.unitPriceXof }).from(budgetLines).where(inArray(budgetLines.id, [...new Set(delivered.map((d) => d.id))])) : [];
  const frs = seasonIds.length ? await db.select().from(financingRequests).where(inArray(financingRequests.seasonId, seasonIds)) : [];
  const open = await db.select({ severity: alerts.severity }).from(alerts).where(and(inArray(alerts.blockId, blockIds), inArray(alerts.status, ['open', 'acknowledged'])));
  const firstDsb = dsb.map((d) => d.confirmedAt).filter((x): x is Date => Boolean(x)).sort((a, b) => a.getTime() - b.getTime())[0];
  const submitted = frs.map((f) => f.submittedAt).filter((x): x is Date => Boolean(x)).sort((a, b) => a.getTime() - b.getTime())[0];
  return {
    asOf,
    plantedHa: pls.reduce((s, p) => s + Number(p.areaHa), 0),
    baseProductionT: pls.reduce((s, p) => s + Number(p.areaHa) * Number(p.yieldBaseTHa ?? 0), 0),
    farmers: fs.map((f) => ({ sex: f.sex, birthYear: f.birthYear })),
    facilities: facs.map((f) => {
      const disbursed = dsb.filter((d) => d.facilityId === f.id).reduce((s, d) => s + d.amountXof, 0);
      const repaid = Number(repaidPrincipal.find((r) => r.id === f.id)?.p ?? 0);
      return { trancheType: f.trancheType as 'seasonal' | 'investment', disbursedXof: disbursed, outstandingPrincipalXof: Math.max(disbursed - repaid, 0), lines: lines.filter((l) => l.facilityId === f.id).map((l) => ({ dueDate: l.dueDate, totalXof: l.totalXof, paidXof: l.paidXof, matured: l.status === 'paid' || l.status === 'overdue' })) };
    }),
    expectedKg: [...expected.values()].reduce((s, x) => s + x, 0),
    deliveredKg: tickets.reduce((s, t) => s + Number(t.kg), 0),
    invoices: invs.map((i) => ({ issuedAt: isoDay(i.issuedAt)!, amountXof: i.amountXof, paidAt: i.status === 'paid' ? isoDay(recs.filter((r) => r.inv === i.id).map((r) => r.at).filter((x): x is Date => Boolean(x)).sort((a, b) => b.getTime() - a.getTime())[0]) : null })),
    settlement: sl.map((l) => ({ payoutXof: l.payoutXof, baselineIncomeXof: fs.find((f) => f.id === l.farmerId)?.baseline ?? null, feesPaidXof: l.investmentFeePaidXof + l.operatorFeesPaidXof })),
    serviceCostXof: Math.round(bl.reduce((s, b) => s + Number(b.qty) * b.unit, 0)),
    submittedAt: isoDay(submitted),
    firstDisbursementAt: isoDay(firstDsb),
    openAlerts: open,
  };
}

export async function blockKpis(db: DbOrTx, blockId: string, asOf = todayIso()): Promise<Kpis> {
  return computeKpis(await kpiInput(db, [blockId], () => true, asOf));
}

export async function lenderKpis(db: DbOrTx, lenderOrgId: string, asOf = todayIso()): Promise<Kpis> {
  const bs = await db.selectDistinct({ id: facilities.blockId }).from(facilities).where(eq(facilities.lenderOrgId, lenderOrgId));
  return computeKpis(await kpiInput(db, bs.map((b) => b.id), (f) => f.lenderOrgId === lenderOrgId, asOf));
}

/** Facilities covered by a committed/active risk cover of the provider: the cover's tranche, or every facility of the block when the cover has no tranche. */
async function coveredFacilities(db: DbOrTx, providerOrgId: string) {
  const covers = await db.select().from(riskCovers).where(and(eq(riskCovers.providerOrgId, providerOrgId), inArray(riskCovers.status, ['committed', 'active'])));
  if (!covers.length) return { covers, facs: [] as (typeof facilities.$inferSelect)[], coverOf: () => undefined };
  const all = await db.select().from(facilities).where(inArray(facilities.blockId, [...new Set(covers.map((c) => c.blockId))]));
  const coverOf = (f: typeof facilities.$inferSelect) => covers.find((c) => c.trancheId === f.trancheId) ?? covers.find((c) => !c.trancheId && c.blockId === f.blockId);
  return { covers, facs: all.filter((f) => coverOf(f)), coverOf };
}

// ---------------------------------------------------------------- snapshots

/** Nightly KPI snapshot per block, lender portfolio and platform (SPEC §9.9). Idempotent per scope and date. */
export async function snapshotKpis(db: Db, asOf = todayIso()) {
  const put = async (scopeType: 'block' | 'season' | 'lender_portfolio' | 'platform', scopeId: string, metrics: Kpis) => {
    await db
      .insert(kpiSnapshots)
      .values({ scopeType, scopeId, date: asOf, metrics })
      .onConflictDoUpdate({ target: [kpiSnapshots.scopeType, kpiSnapshots.scopeId, kpiSnapshots.date], set: { metrics, updatedAt: new Date() } });
  };
  const bs = await db.select({ id: blocks.id }).from(blocks).where(notInArray(blocks.status, ['draft', 'archived']));
  for (const b of bs) await put('block', b.id, await blockKpis(db, b.id, asOf));
  const lenders = await db.selectDistinct({ id: facilities.lenderOrgId }).from(facilities);
  for (const l of lenders) await put('lender_portfolio', l.id, await lenderKpis(db, l.id, asOf));
  await put('platform', PLATFORM_SCOPE_ID, computeKpis(await kpiInput(db, bs.map((b) => b.id), () => true, asOf)));
  return { blocks: bs.length, lenders: lenders.length };
}

export async function listKpis(db: DbOrTx, actor: ActorContext, q: { scopeType: 'block' | 'season' | 'lender_portfolio' | 'platform'; scopeId?: string; from?: string; to?: string }) {
  const orgId = requireOrg(actor);
  if (q.scopeType === 'block') {
    if (!q.scopeId) throw badRequest('VALIDATION_FAILED', 'scopeId is required', [{ path: 'query.scopeId', message: 'required' }]);
    await loadBlock(db, actor, q.scopeId);
  } else if (q.scopeType === 'lender_portfolio') {
    if (q.scopeId !== orgId && !isPlatformStaff(actor)) throw notFound('Portfolio');
  } else if (!isPlatformStaff(actor)) throw notFound('Scope');
  const conds = [eq(kpiSnapshots.scopeType, q.scopeType), eq(kpiSnapshots.scopeId, q.scopeType === 'platform' ? PLATFORM_SCOPE_ID : q.scopeId!)];
  if (q.from) conds.push(gte(kpiSnapshots.date, q.from));
  if (q.to) conds.push(lte(kpiSnapshots.date, q.to));
  const rows = await db.select().from(kpiSnapshots).where(and(...conds)).orderBy(kpiSnapshots.date).limit(400);
  return rows.map((r) => ({ date: r.date, metrics: r.metrics as Kpis }));
}

// ---------------------------------------------------------------- dashboards (SPEC §12.3, §12.4, §12.6)

export async function operatorDashboard(db: DbOrTx, actor: ActorContext) {
  const orgId = requireOrg(actor);
  const bs = await db.select().from(blocks).where(and(eq(blocks.ownerOrgId, orgId), ne(blocks.status, 'archived')));
  const byStatus: Record<string, number> = {};
  for (const b of bs) byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;
  const kpis = computeKpis(await kpiInput(db, bs.map((b) => b.id), () => true, todayIso()));
  const openAlerts = bs.length ? await db.select().from(alerts).where(and(inArray(alerts.blockId, bs.map((b) => b.id)), eq(alerts.status, 'open'))).orderBy(sql`case ${alerts.severity} when 'critical' then 0 when 'warning' then 1 else 2 end`, desc(alerts.createdAt)).limit(10) : [];
  const toSign = await db.select({ id: contracts.id }).from(contracts).where(and(eq(contracts.ownerOrgId, orgId), inArray(contracts.status, ['out_for_signature', 'partially_signed'])));
  const pendingDsb = bs.length ? await db.select({ id: disbursements.id }).from(disbursements).innerJoin(facilities, eq(facilities.id, disbursements.facilityId)).where(and(inArray(facilities.blockId, bs.map((b) => b.id)), inArray(disbursements.status, ['requested', 'approved', 'executed']))) : [];
  const runs = await db.select({ id: settlementRuns.id, status: settlementRuns.status }).from(settlementRuns).where(and(eq(settlementRuns.ownerOrgId, orgId), ne(settlementRuns.status, 'reconciled')));
  return {
    blocksByStatus: byStatus,
    blocks: bs.map((b) => ({ id: b.id, ref: b.ref, name: b.name, status: b.status, region: b.region })),
    kpis,
    alerts: openAlerts.map((a) => ({ id: a.id, blockId: a.blockId, severity: a.severity, message: a.message, createdAt: a.createdAt.toISOString() })),
    tasks: { contractsPendingSignature: toSign.length, disbursementsInProgress: pendingDsb.length, settlementsOpen: runs.length },
  };
}

export async function lenderDashboard(db: DbOrTx, actor: ActorContext) {
  const orgId = requireOrg(actor);
  const kpis = await lenderKpis(db, orgId);
  const facs = await db.select({ f: facilities, ref: blocks.ref, name: blocks.name }).from(facilities).innerJoin(blocks, eq(blocks.id, facilities.blockId)).where(eq(facilities.lenderOrgId, orgId));
  const dsb = facs.length ? await db.select({ id: disbursements.id }).from(disbursements).where(and(inArray(disbursements.facilityId, facs.map((x) => x.f.id)), inArray(disbursements.status, ['requested', 'approved', 'executed']))) : [];
  const runs = facs.length ? await db.select({ id: settlementRuns.id }).from(settlementRuns).where(and(inArray(settlementRuns.blockId, [...new Set(facs.map((x) => x.f.blockId))]), eq(settlementRuns.status, 'approved_operator'))) : [];
  const signs = await db.select({ id: contractParties.id }).from(contractParties).innerJoin(contracts, eq(contracts.id, contractParties.contractId)).where(and(eq(contractParties.orgId, orgId), isNull(contractParties.signedAt), inArray(contracts.status, ['out_for_signature', 'partially_signed'])));
  const opps = await db.execute<{ n: number }>(sql`select count(*)::int as n from rfp_invitations i join rfps r on r.id = i.rfp_id where i.lender_org_id = ${orgId} and r.status = 'open' and i.status in ('invited', 'viewed')`);
  return {
    kpis,
    facilities: facs.map(({ f, ref, name }) => ({ id: f.id, ref: f.ref, blockRef: ref, blockName: name, status: f.status, principalXof: f.principalXof, trancheType: f.trancheType })),
    pending: { cpToConfirm: facs.filter((x) => x.f.status === 'pending_cp').length, disbursements: dsb.length, settlementsToApprove: runs.length, contractsToSign: signs.length },
    openOpportunities: opps.rows[0]?.n ?? 0,
  };
}

export async function blockDashboard(db: DbOrTx, actor: ActorContext, blockId: string) {
  const b = await loadBlock(db, actor, blockId);
  const kpis = await blockKpis(db, b.id);
  const recentAlerts = await db.select().from(alerts).where(and(eq(alerts.blockId, b.id), ne(alerts.status, 'resolved'))).orderBy(desc(alerts.createdAt)).limit(10);
  const [season] = await db.select().from(seasons).where(and(eq(seasons.blockId, b.id), ne(seasons.status, 'cancelled'))).orderBy(desc(seasons.startDate)).limit(1);
  const visits = await db.execute<{ plot_code: string; visited_at: Date; health_score: number; crop_stage: string }>(sql`select p.code as plot_code, v.visited_at, v.health_score, v.crop_stage from field_visits v join plots p on p.id = v.plot_id where v.block_id = ${b.id} order by v.visited_at desc limit 10`);
  return {
    block: { id: b.id, ref: b.ref, name: b.name, status: b.status },
    season: season ? { id: season.id, name: season.name, status: season.status, startDate: season.startDate, endDate: season.endDate } : null,
    kpis,
    harvestProgressPct: kpis.deliveryRatePct,
    alerts: recentAlerts.map((a) => ({ id: a.id, severity: a.severity, message: a.message, status: a.status, createdAt: a.createdAt.toISOString() })),
    recentVisits: visits.rows.map((v) => ({ plotCode: v.plot_code, visitedAt: new Date(v.visited_at).toISOString(), healthScore: v.health_score, cropStage: v.crop_stage })),
  };
}

/** Guarantor / insurer portfolio of covered facilities (SPEC §12.6). */
export async function guarantorDashboard(db: DbOrTx, actor: ActorContext) {
  const orgId = requireOrg(actor);
  const { facs, coverOf } = await coveredFacilities(db, orgId);
  const threshold = await getSetting<number>(db, 'guarantee.claim_threshold_days', 60);
  const asOf = todayIso();
  const facIds = facs.map((f) => f.id);
  const lines = facIds.length ? await db.select().from(scheduleLines).where(inArray(scheduleLines.facilityId, facIds)) : [];
  const bs = facs.length ? await db.select({ id: blocks.id, ref: blocks.ref, name: blocks.name }).from(blocks).where(inArray(blocks.id, [...new Set(facs.map((f) => f.blockId))])) : [];
  const lenders = facs.length ? await db.select({ id: organizations.id, name: organizations.legalName }).from(organizations).where(inArray(organizations.id, [...new Set(facs.map((f) => f.lenderOrgId))])) : [];
  const kpis = computeKpis(await kpiInput(db, [...new Set(facs.map((f) => f.blockId))], (f) => facIds.includes(f.id), asOf));
  const rows = facs.map((f) => {
    const c = coverOf(f)!;
    const own = lines.filter((l) => l.facilityId === f.id);
    const outstanding = own.reduce((s, l) => s + (l.totalXof - l.paidXof), 0);
    const overdue = own.reduce((m, l) => Math.max(m, daysOverdue(l.dueDate, asOf, l.totalXof - l.paidXof)), 0);
    const exposure = Math.min(Math.round((outstanding * Number(c.coveragePct)) / 100), c.capXof ?? Number.MAX_SAFE_INTEGER);
    return { facilityId: f.id, facilityRef: f.ref, blockId: f.blockId, blockRef: bs.find((b) => b.id === f.blockId)?.ref ?? '', blockName: bs.find((b) => b.id === f.blockId)?.name ?? '', lenderName: lenders.find((l) => l.id === f.lenderOrgId)?.name ?? '', coverType: c.type, coveragePct: Number(c.coveragePct), outstandingXof: outstanding, exposureXof: exposure, maxOverdueDays: overdue, claimCandidate: overdue > threshold, status: f.status };
  });
  return { kpis, claimThresholdDays: threshold, totalExposureXof: rows.reduce((s, r) => s + r.exposureXof, 0), facilities: rows };
}

// ---------------------------------------------------------------- reports (PDF)

export async function createReport(ctx: ModuleContext, actor: ActorContext, body: { type: 'lender_monthly' | 'season_close' | 'guarantor_portfolio'; scopeId?: string | null; period: string }) {
  const orgId = requireOrg(actor);
  const db = ctx.db;
  let title: string;
  let kpis: Kpis;
  let rows: { label: string; values: (string | number)[] }[] = [];
  let header: string[] = [];
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  const locale = org?.locale === 'en' ? 'en' : 'fr';
  if (body.type === 'lender_monthly') {
    if (actor.orgType !== 'lender') throw notFound('Portfolio');
    const d = await lenderDashboard(db, actor);
    kpis = d.kpis;
    title = locale === 'en' ? `Lender report ${body.period}` : `Rapport prêteur ${body.period}`;
    header = ['Facility', 'Block', 'Type', 'Principal', 'Status'];
    rows = d.facilities.filter((f) => !body.scopeId || f.id === body.scopeId).map((f) => ({ label: f.ref, values: [f.blockRef, f.trancheType, f.principalXof, f.status] }));
  } else if (body.type === 'season_close') {
    if (!body.scopeId) throw badRequest('VALIDATION_FAILED', 'scopeId (block) is required', [{ path: 'body.scopeId', message: 'required' }]);
    const d = await blockDashboard(db, actor, body.scopeId);
    kpis = d.kpis;
    title = locale === 'en' ? `Season close ${d.block.ref} · ${d.season?.name ?? ''}` : `Clôture de campagne ${d.block.ref} · ${d.season?.name ?? ''}`;
    header = ['Severity', 'Status', 'Date'];
    rows = d.alerts.map((a) => ({ label: a.message, values: [a.severity, a.status, a.createdAt.slice(0, 10)] }));
  } else {
    if (!['guarantor', 'insurer'].includes(actor.orgType ?? '')) throw notFound('Portfolio');
    const d = await guarantorDashboard(db, actor);
    kpis = d.kpis;
    title = locale === 'en' ? `Guarantee portfolio ${body.period}` : `Portefeuille garanti ${body.period}`;
    header = ['Block', 'Lender', 'Outstanding', 'Exposure', 'Overdue days'];
    rows = d.facilities.map((f) => ({ label: f.facilityRef, values: [f.blockRef, f.lenderName, f.outstandingXof, f.exposureXof, f.maxOverdueDays] }));
  }
  const html = renderReportHtml({ title, orgName: org?.legalName ?? '', period: body.period, generatedAt: new Date().toISOString().slice(0, 16).replace('T', ' '), kpis: kpis as unknown as Record<string, unknown>, header, rows }, locale);
  return db.transaction(async (tx) => {
    const [r] = await tx.insert(reports).values({ ownerOrgId: orgId, type: body.type, scopeId: body.scopeId ?? null, period: body.period, status: 'generating', createdBy: actorUserId(actor) }).returning();
    const f = await storeFile(ctx, tx, actor, { filename: `${body.type}-${body.period}.pdf`, declaredMime: 'application/pdf', buffer: await pdfRenderer().render(html) }, { linkedType: 'report', linkedId: r!.id, ownerOrgId: orgId });
    const [u] = await tx.update(reports).set({ pdfFileId: f.id, status: 'ready', generatedAt: new Date() }).where(eq(reports.id, r!.id)).returning();
    await audit(tx, actor, { action: 'report.generated', resourceType: 'report', resourceId: r!.id, after: { type: body.type, period: body.period } });
    return reportDto(u!);
  });
}

export const reportDto = (r: typeof reports.$inferSelect) => ({ id: r.id, type: r.type, scopeId: r.scopeId, period: r.period, status: r.status, hasPdf: Boolean(r.pdfFileId), generatedAt: r.generatedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() });

export async function listReports(db: DbOrTx, actor: ActorContext) {
  const rows = await db.select().from(reports).where(eq(reports.ownerOrgId, requireOrg(actor))).orderBy(desc(reports.createdAt)).limit(200);
  return rows.map(reportDto);
}

export async function getReport(db: DbOrTx, actor: ActorContext, id: string) {
  const [r] = await db.select().from(reports).where(eq(reports.id, id));
  if (!r || (r.ownerOrgId !== actor.orgId && !isPlatformStaff(actor))) throw notFound('Report');
  return r;
}

