import { and, asc, desc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import { allocateBudget, allowedActions as machineActions, dec, roundXof, seasonMachine, transition, type BudgetInput } from '@jappo/domain';
import type { Db, DbOrTx } from '../../db/client';
import { budgetLines, capexItems, feePolicies, operatorOpex, plantings, seasons, supplierQuotes } from './schema';
import { crops, cropTemplates, serviceCatalog } from '../catalogue/schema';
import { offtakeContracts } from '../offtake/schema';
import { farmers } from '../farmers/schema';
import { plotAllocations, plots } from '../land/schema';
import type { ActorContext } from '../../core/context';
import { actorUserId, requireOrg } from '../../core/context';
import { audit } from '../../core/audit';
import { emit } from '../../core/events';
import { badRequest, conflict, notFound, unprocessable } from '../../core/errors';
import { hasPermission } from '../../core/authz/permissions';
import { assertVersion } from '../../core/etag';
import { loadBlock } from '../land/service';
import { latestMarketPrice, resolveTemplate, zoneForRegion, getVisibleService } from '../catalogue/service';
import { files } from '../../core/schema';

const num = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));
type SeasonRow = typeof seasons.$inferSelect;
type PlantingRow = typeof plantings.$inferSelect;
type LineRow = typeof budgetLines.$inferSelect;

// ---------------------------------------------------------------- seasons

export async function loadSeason(db: DbOrTx, actor: ActorContext, id: string, write = false) {
  const [s] = await db.select().from(seasons).where(eq(seasons.id, id));
  if (!s) throw notFound('Season');
  const block = await loadBlock(db, actor, s.blockId, write).catch(() => {
    throw notFound('Season');
  });
  return { season: s, block };
}

function seasonActions(s: SeasonRow, actor: ActorContext, own: boolean) {
  if (!own) return [];
  const out: string[] = [];
  const m = machineActions(seasonMachine, s.status);
  if (hasPermission(actor.permissions, 'season:update') && ['planning', 'financing'].includes(s.status)) out.push('update');
  if (hasPermission(actor.permissions, 'season:start') && m.includes('start')) out.push('start');
  if (hasPermission(actor.permissions, 'season:cancel') && m.includes('cancel')) out.push('cancel');
  if (hasPermission(actor.permissions, 'planting:manage') && ['planning', 'financing'].includes(s.status)) out.push('edit_plan');
  if (hasPermission(actor.permissions, 'budget:manage') && ['planning', 'financing'].includes(s.status)) out.push('edit_budget');
  return out;
}

export async function seasonOut(db: DbOrTx, actor: ActorContext, id: string) {
  const { season: s, block } = await loadSeason(db, actor, id);
  const ps = await db.select({ area: plantings.areaHa }).from(plantings).where(eq(plantings.seasonId, id));
  const summary = await budgetSummary(db, actor, id);
  return {
    id: s.id,
    blockId: s.blockId,
    name: s.name,
    kind: s.kind,
    startDate: s.startDate,
    endDate: s.endDate,
    status: s.status,
    planVersion: s.planVersion,
    selfFinanced: s.selfFinanced,
    stats: { plantings: ps.length, plantedHa: ps.reduce((a, p) => a + Number(p.area), 0), budgetXof: Object.values(summary.totals).reduce((a, b) => a + b, 0) },
    version: s.version,
    createdAt: s.createdAt.toISOString(),
    allowedActions: seasonActions(s, actor, block.ownerOrgId === actor.orgId),
  };
}

export async function listSeasons(db: DbOrTx, actor: ActorContext, blockId: string) {
  await loadBlock(db, actor, blockId);
  const rows = await db.select({ id: seasons.id }).from(seasons).where(eq(seasons.blockId, blockId)).orderBy(desc(seasons.startDate));
  return Promise.all(rows.map((r) => seasonOut(db, actor, r.id)));
}

export async function createSeason(db: Db, actor: ActorContext, blockId: string, body: { name: string; kind: SeasonRow['kind']; startDate: string; endDate: string }) {
  if (body.endDate <= body.startDate) throw unprocessable('END_BEFORE_START', 'The season must end after it starts');
  return db.transaction(async (tx) => {
    const b = await loadBlock(tx, actor, blockId, true);
    const [s] = await tx.insert(seasons).values({ ...body, blockId, ownerOrgId: b.ownerOrgId, createdBy: actorUserId(actor) }).returning();
    await audit(tx, actor, { action: 'season.created', resourceType: 'season', resourceId: s!.id, after: body });
    await emit(tx, actor, 'season.created', { type: 'season', id: s!.id }, { blockId });
    return s!.id;
  });
}

function assertEditable(s: SeasonRow) {
  if (!['planning', 'financing'].includes(s.status)) throw conflict('SEASON_LOCKED', `The season plan cannot change in status ${s.status}`);
}

export async function updateSeason(db: Db, actor: ActorContext, id: string, expected: number, body: Partial<{ name: string; kind: SeasonRow['kind']; startDate: string; endDate: string }>) {
  return db.transaction(async (tx) => {
    const { season: s } = await loadSeason(tx, actor, id, true);
    assertVersion(expected, s.version);
    assertEditable(s);
    if ((body.endDate ?? s.endDate) <= (body.startDate ?? s.startDate)) throw unprocessable('END_BEFORE_START', 'The season must end after it starts');
    await tx.update(seasons).set({ ...body, version: s.version + 1 }).where(eq(seasons.id, id));
    await audit(tx, actor, { action: 'season.updated', resourceType: 'season', resourceId: id, after: body });
  });
}

/** `planning|financing → in_progress` (SPEC §8.2). Guard: ≥ 1 planting, and self-financed or a confirmed disbursement. */
export async function startSeason(db: Db, actor: ActorContext, id: string, expected: number, selfFinanced: boolean, hasConfirmedDisbursement: (tx: DbOrTx, seasonId: string, blockId: string) => Promise<boolean> = async () => false) {
  return db.transaction(async (tx) => {
    const { season: s, block } = await loadSeason(tx, actor, id, true);
    assertVersion(expected, s.version);
    const next = transition(seasonMachine, s.status, 'start');
    const [p] = await tx.select({ id: plantings.id }).from(plantings).where(eq(plantings.seasonId, id)).limit(1);
    if (!p) throw unprocessable('NO_PLANTINGS', 'Plan at least one planting before starting the season');
    if (!selfFinanced && !(await hasConfirmedDisbursement(tx, id, block.id))) throw unprocessable('DISBURSEMENT_REQUIRED', 'A confirmed disbursement is required, or declare the season self-financed');
    await tx.update(seasons).set({ status: next, selfFinanced, startedAt: new Date(), version: s.version + 1 }).where(eq(seasons.id, id));
    await audit(tx, actor, { action: 'season.started', resourceType: 'season', resourceId: id, before: { status: s.status }, after: { status: next, selfFinanced } });
    await emit(tx, actor, 'season.started', { type: 'season', id }, { blockId: block.id, selfFinanced });
  });
}

export async function cancelSeason(db: Db, actor: ActorContext, id: string, expected: number, reason: string) {
  return db.transaction(async (tx) => {
    const { season: s } = await loadSeason(tx, actor, id, true);
    assertVersion(expected, s.version);
    const next = transition(seasonMachine, s.status, 'cancel');
    await tx.update(seasons).set({ status: next, version: s.version + 1 }).where(eq(seasons.id, id));
    await audit(tx, actor, { action: 'season.cancelled', resourceType: 'season', resourceId: id, before: { status: s.status }, after: { status: next, reason } });
    await emit(tx, actor, 'season.cancelled', { type: 'season', id }, { reason });
  });
}

// ---------------------------------------------------------------- plantings (effective values)

interface PlantingCtx {
  templates: Map<string, typeof cropTemplates.$inferSelect>;
  offtakePrice: Map<string, number>;
  marketPrice: Map<string, number | null>;
  cropCode: Map<string, string>;
  plotCode: Map<string, string>;
}

async function plantingContext(db: DbOrTx, season: SeasonRow, rows: PlantingRow[]): Promise<PlantingCtx> {
  const tplIds = [...new Set(rows.map((r) => r.templateId).filter((x): x is string => !!x))];
  const templates = new Map((tplIds.length ? await db.select().from(cropTemplates).where(inArray(cropTemplates.id, tplIds)) : []).map((t) => [t.id, t]));
  const cropIds = [...new Set(rows.map((r) => r.cropId))];
  const cs = cropIds.length ? await db.select({ id: crops.id, code: crops.code }).from(crops).where(inArray(crops.id, cropIds)) : [];
  // Offtake price (SPEC §7.6): contracts with status loi|signed for this block & crop; season-specific first.
  const contracts = cropIds.length
    ? await db.select().from(offtakeContracts).where(and(eq(offtakeContracts.blockId, season.blockId), inArray(offtakeContracts.cropId, cropIds), inArray(offtakeContracts.status, ['loi', 'signed'])))
    : [];
  const offtakePrice = new Map<string, number>();
  for (const cid of cropIds) {
    const c = contracts
      .filter((k) => k.cropId === cid && (k.seasonId === null || k.seasonId === season.id))
      .sort((a, b) => Number(b.seasonId === season.id) - Number(a.seasonId === season.id) || Number(b.status === 'signed') - Number(a.status === 'signed'))[0];
    if (c) offtakePrice.set(cid, c.priceXofPerKg);
  }
  const marketPrice = new Map<string, number | null>();
  for (const cid of cropIds) if (!offtakePrice.has(cid)) marketPrice.set(cid, await latestMarketPrice(db, cid));
  const plotIds = [...new Set(rows.map((r) => r.plotId))];
  const ps = plotIds.length ? await db.select({ id: plots.id, code: plots.code }).from(plots).where(inArray(plots.id, plotIds)) : [];
  return { templates, offtakePrice, marketPrice, cropCode: new Map(cs.map((c) => [c.id, c.code])), plotCode: new Map(ps.map((p) => [p.id, p.code])) };
}

export function effectivePlanting(p: PlantingRow, ctx: PlantingCtx) {
  const t = p.templateId ? ctx.templates.get(p.templateId) : undefined;
  const offtake = ctx.offtakePrice.get(p.cropId);
  const market = ctx.marketPrice.get(p.cropId) ?? null;
  const base = p.priceXofPerKgBase ?? offtake ?? market;
  const priceSource = p.priceXofPerKgBase !== null ? 'manual' : offtake !== undefined ? 'offtake' : market !== null ? 'market' : 'none';
  return {
    id: p.id,
    seasonId: p.seasonId,
    plotId: p.plotId,
    plotCode: ctx.plotCode.get(p.plotId) ?? '',
    cropId: p.cropId,
    cropCode: ctx.cropCode.get(p.cropId) ?? '',
    varietyId: p.varietyId,
    templateId: p.templateId,
    areaHa: Number(p.areaHa),
    plannedSowingDate: p.plannedSowingDate,
    plannedHarvestDate: p.plannedHarvestDate,
    yieldBaseTHa: num(p.yieldBaseTHa) ?? num(t?.yieldBaseTHa),
    yieldStressTHa: num(p.yieldStressTHa) ?? num(t?.yieldStressTHa),
    postHarvestLossPct: num(p.postHarvestLossPct) ?? num(t?.postHarvestLossPct),
    deliveryRatePct: num(p.deliveryRatePct) ?? num(t?.deliveryRatePct),
    priceXofPerKgBase: base ?? null,
    // Stress price default = base × 0.85 (SPEC §7.6), half-even.
    priceXofPerKgStress: p.priceXofPerKgStress ?? (base === null || base === undefined ? null : roundXof(dec(base).times('0.85'))),
    priceSource: priceSource as 'manual' | 'offtake' | 'market' | 'none',
    version: p.version,
  };
}

export async function listPlantings(db: DbOrTx, actor: ActorContext, seasonId: string) {
  const { season } = await loadSeason(db, actor, seasonId);
  const rows = await db.select().from(plantings).where(eq(plantings.seasonId, seasonId)).orderBy(asc(plantings.createdAt));
  const ctx = await plantingContext(db, season, rows);
  return rows.map((r) => effectivePlanting(r, ctx)).sort((a, b) => a.plotCode.localeCompare(b.plotCode));
}

type PlantingBody = {
  plotId: string;
  cropId: string;
  varietyId?: string | null;
  templateId?: string | null;
  areaHa?: number;
  plannedSowingDate?: string | null;
  plannedHarvestDate?: string | null;
  yieldBaseTHa?: number | null;
  yieldStressTHa?: number | null;
  postHarvestLossPct?: number | null;
  deliveryRatePct?: number | null;
  priceXofPerKgBase?: number | null;
  priceXofPerKgStress?: number | null;
};

const plantingNumeric = (b: Partial<PlantingBody>) => {
  const o: Partial<typeof plantings.$inferInsert> = {};
  for (const k of ['yieldBaseTHa', 'yieldStressTHa', 'postHarvestLossPct', 'deliveryRatePct'] as const) if (b[k] !== undefined) o[k] = b[k] === null ? null : String(b[k]);
  for (const k of ['priceXofPerKgBase', 'priceXofPerKgStress', 'plannedSowingDate', 'plannedHarvestDate', 'varietyId'] as const) if (b[k] !== undefined) (o as Record<string, unknown>)[k] = b[k];
  if (b.areaHa !== undefined) o.areaHa = String(b.areaHa);
  return o;
};

export async function createPlanting(tx: DbOrTx, actor: ActorContext, seasonId: string, body: PlantingBody): Promise<string> {
  const { season, block } = await loadSeason(tx, actor, seasonId, true);
  assertEditable(season);
  const [plot] = await tx.select().from(plots).where(and(eq(plots.id, body.plotId), eq(plots.blockId, block.id), isNull(plots.archivedAt)));
  if (!plot) throw badRequest('PLOT_NOT_FOUND', 'Plot not in this block', [{ path: 'body.plotId', message: 'unknown plot' }]);
  if (plot.status === 'excluded') throw unprocessable('PLOT_EXCLUDED', 'The plot is excluded');
  const [crop] = await tx.select().from(crops).where(eq(crops.id, body.cropId));
  if (!crop) throw badRequest('CROP_NOT_FOUND', 'Unknown crop', [{ path: 'body.cropId', message: 'unknown crop' }]);
  const area = body.areaHa ?? Number(plot.areaHa);
  const [{ used } = { used: '0' }] = await tx.select({ used: sql<string>`coalesce(sum(${plantings.areaHa}), 0)` }).from(plantings).where(and(eq(plantings.seasonId, seasonId), eq(plantings.plotId, plot.id)));
  if (Number(used) + area > Number(plot.areaHa) + 0.00005) throw unprocessable('PLANTING_AREA_EXCEEDS_PLOT', `Planted area exceeds the plot area (${plot.areaHa} ha)`);
  let templateId = body.templateId ?? null;
  if (!templateId) {
    const t = await resolveTemplate(tx, block.ownerOrgId, body.cropId, await zoneForRegion(tx, block.region), plot.irrigated);
    templateId = t?.id ?? null;
  }
  const [p] = await tx
    .insert(plantings)
    .values({ seasonId, blockId: block.id, ownerOrgId: block.ownerOrgId, plotId: plot.id, cropId: body.cropId, templateId, ...plantingNumeric(body), areaHa: String(area), createdBy: actorUserId(actor) })
    .returning({ id: plantings.id });
  await tx.update(seasons).set({ planVersion: sql`${seasons.planVersion} + 1` }).where(eq(seasons.id, seasonId));
  await audit(tx, actor, { action: 'planting.created', resourceType: 'planting', resourceId: p!.id, after: { seasonId, plotId: plot.id, cropId: body.cropId, areaHa: area } });
  return p!.id;
}

export async function bulkAssign(db: Db, actor: ActorContext, seasonId: string, body: { cropId: string; plotIds: string[]; templateId?: string | null; plannedSowingDate?: string | null; plannedHarvestDate?: string | null; priceXofPerKgBase?: number | null }) {
  return db.transaction(async (tx) => {
    const existing = await tx.select({ plotId: plantings.plotId }).from(plantings).where(and(eq(plantings.seasonId, seasonId), inArray(plantings.plotId, body.plotIds)));
    const taken = new Set(existing.map((e) => e.plotId));
    const created: string[] = [];
    for (const plotId of body.plotIds) {
      if (taken.has(plotId)) continue; // a plot already planted this season keeps its planting
      created.push(await createPlanting(tx, actor, seasonId, { plotId, cropId: body.cropId, templateId: body.templateId, plannedSowingDate: body.plannedSowingDate, plannedHarvestDate: body.plannedHarvestDate, priceXofPerKgBase: body.priceXofPerKgBase }));
    }
    await emit(tx, actor, 'planting.bulk_assigned', { type: 'season', id: seasonId }, { cropId: body.cropId, count: created.length });
    return created;
  });
}

async function loadPlanting(tx: DbOrTx, actor: ActorContext, id: string) {
  const [p] = await tx.select().from(plantings).where(eq(plantings.id, id));
  if (!p) throw notFound('Planting');
  const { season } = await loadSeason(tx, actor, p.seasonId, true).catch(() => {
    throw notFound('Planting');
  });
  return { p, season };
}

export async function updatePlanting(db: Db, actor: ActorContext, id: string, expected: number, body: Partial<PlantingBody>) {
  return db.transaction(async (tx) => {
    const { p, season } = await loadPlanting(tx, actor, id);
    assertEditable(season);
    assertVersion(expected, p.version);
    if (body.areaHa !== undefined) {
      const [plot] = await tx.select().from(plots).where(eq(plots.id, p.plotId));
      const [{ used } = { used: '0' }] = await tx.select({ used: sql<string>`coalesce(sum(${plantings.areaHa}), 0)` }).from(plantings).where(and(eq(plantings.seasonId, p.seasonId), eq(plantings.plotId, p.plotId), ne(plantings.id, id)));
      if (Number(used) + body.areaHa > Number(plot!.areaHa) + 0.00005) throw unprocessable('PLANTING_AREA_EXCEEDS_PLOT', `Planted area exceeds the plot area (${plot!.areaHa} ha)`);
    }
    const set = { ...plantingNumeric(body), ...(body.cropId ? { cropId: body.cropId } : {}), ...(body.templateId !== undefined ? { templateId: body.templateId } : {}), version: p.version + 1 };
    await tx.update(plantings).set(set).where(eq(plantings.id, id));
    await tx.update(seasons).set({ planVersion: sql`${seasons.planVersion} + 1` }).where(eq(seasons.id, p.seasonId));
    await audit(tx, actor, { action: 'planting.updated', resourceType: 'planting', resourceId: id, after: body });
  });
}

export async function deletePlanting(db: Db, actor: ActorContext, id: string) {
  return db.transaction(async (tx) => {
    const { p, season } = await loadPlanting(tx, actor, id);
    assertEditable(season);
    await tx.delete(plantings).where(eq(plantings.id, id));
    await tx.update(seasons).set({ planVersion: sql`${seasons.planVersion} + 1` }).where(eq(seasons.id, p.seasonId));
    await audit(tx, actor, { action: 'planting.deleted', resourceType: 'planting', resourceId: id, before: { plotId: p.plotId, cropId: p.cropId } });
  });
}

export async function plantingOut(db: DbOrTx, actor: ActorContext, id: string) {
  const [p] = await db.select().from(plantings).where(eq(plantings.id, id));
  if (!p) throw notFound('Planting');
  const { season } = await loadSeason(db, actor, p.seasonId);
  return effectivePlanting(p, await plantingContext(db, season, [p]));
}

// ---------------------------------------------------------------- budget

/** Assemble the §9.1.3 allocation input for a season from DB rows. */
export async function budgetInput(db: DbOrTx, seasonId: string, blockId: string): Promise<{ input: BudgetInput; names: Map<string, string>; lines: LineRow[] }> {
  const ps = await db.select().from(plantings).where(eq(plantings.seasonId, seasonId));
  const plotRows = await db.select({ id: plots.id, code: plots.code, areaHa: plots.areaHa }).from(plots).where(and(eq(plots.blockId, blockId), isNull(plots.archivedAt)));
  const allocs = await db
    .select({ plotId: plotAllocations.plotId, farmerId: plotAllocations.farmerId, sharePct: plotAllocations.sharePct, code: farmers.code, fn: farmers.firstName, ln: farmers.lastName })
    .from(plotAllocations)
    .innerJoin(farmers, eq(farmers.id, plotAllocations.farmerId))
    .where(and(eq(plotAllocations.blockId, blockId), eq(plotAllocations.status, 'active')));
  const lines = await db.select().from(budgetLines).where(eq(budgetLines.seasonId, seasonId)).orderBy(asc(budgetLines.createdAt), asc(budgetLines.id));
  return {
    input: {
      plots: plotRows.map((p) => ({ plotId: p.id, code: p.code, areaHa: Number(p.areaHa) })),
      allocations: allocs.map((a) => ({ plotId: a.plotId, farmerId: a.farmerId, farmerCode: a.code, sharePct: Number(a.sharePct) })),
      plantings: ps.map((p) => ({ plantingId: p.id, plotId: p.plotId, cropId: p.cropId, areaHa: Number(p.areaHa) })),
      lines: lines.map((l) => ({ lineId: l.id, scope: l.scope, plotId: l.plotId, cropId: l.cropId, qty: Number(l.qty), unitPriceXof: l.unitPriceXof, payer: l.payer })),
    },
    names: new Map(allocs.map((a) => [a.farmerId, `${a.fn} ${a.ln}`])),
    lines,
  };
}

export async function budgetSummary(db: DbOrTx, actor: ActorContext, seasonId: string) {
  const { season } = await loadSeason(db, actor, seasonId);
  const { input, names, lines } = await budgetInput(db, seasonId, season.blockId);
  const out = allocateBudget(input);
  const plantedHa = input.plantings.reduce((s, p) => s + p.areaHa, 0);
  const total = Object.values(out.totals).reduce((a, b) => a + b, 0);
  const creditLines = out.lines.filter((l) => lines.find((x) => x.id === l.lineId)?.payer === 'farmer_credit');
  const creditTotal = creditLines.reduce((s, l) => s + l.totalXof, 0);
  const quoted = creditLines.filter((l) => lines.find((x) => x.id === l.lineId)?.quoteId).reduce((s, l) => s + l.totalXof, 0);
  return {
    totals: out.totals,
    plantedHa: Number(plantedHa.toFixed(4)),
    perHaXof: plantedHa > 0 ? roundXof(dec(total).div(plantedHa)) : 0,
    quotedSharePct: creditTotal > 0 ? Number(((quoted / creditTotal) * 100).toFixed(2)) : 0,
    unallocated: out.unallocated,
    farmers: out.farmers.map((f) => ({ farmerId: f.farmerId, farmerCode: f.farmerCode, name: names.get(f.farmerId) ?? f.farmerCode, ha: f.ha, farmerCreditXof: f.farmerCreditXof, farmerCashXof: f.farmerCashXof })),
    warnings: out.warnings,
    lineTotals: new Map(out.lines.map((l) => [l.lineId, l.totalXof])),
  };
}

export async function listBudgetLines(db: DbOrTx, actor: ActorContext, seasonId: string) {
  const { block } = await loadSeason(db, actor, seasonId);
  const sum = await budgetSummary(db, actor, seasonId);
  const rows = await db.select({ l: budgetLines, sName: serviceCatalog.nameFr, sNameEn: serviceCatalog.nameEn, kind: serviceCatalog.kind }).from(budgetLines).innerJoin(serviceCatalog, eq(serviceCatalog.id, budgetLines.serviceId)).where(eq(budgetLines.seasonId, seasonId)).orderBy(asc(budgetLines.createdAt), asc(budgetLines.id));
  const own = block.ownerOrgId === actor.orgId;
  return rows.map(({ l, sName, kind }) => ({
    id: l.id,
    seasonId: l.seasonId,
    scope: l.scope,
    plotId: l.plotId,
    cropId: l.cropId,
    serviceId: l.serviceId,
    serviceName: sName,
    serviceKind: kind,
    qty: Number(l.qty),
    unit: l.unit,
    unitPriceXof: l.unitPriceXof,
    totalXof: sum.lineTotals.get(l.id) ?? 0,
    quoteId: l.quoteId,
    payer: l.payer,
    tranche: l.tranche,
    plannedDate: l.plannedDate,
    notes: own ? l.notes : null, // internal notes are private_operator (SPEC §6.3)
    source: l.source,
    version: l.version,
  }));
}

type LineBody = { scope: LineRow['scope']; serviceId: string; qty: number; payer: LineRow['payer']; plotId?: string | null; cropId?: string | null; unit?: LineRow['unit']; unitPriceXof?: number; quoteId?: string | null; tranche?: LineRow['tranche']; plannedDate?: string | null; notes?: string | null };

async function validateLine(tx: DbOrTx, actor: ActorContext, blockId: string, b: Partial<LineBody>, current?: LineRow) {
  const scope = b.scope ?? current?.scope;
  const plotId = b.plotId !== undefined ? b.plotId : current?.plotId;
  const cropId = b.cropId !== undefined ? b.cropId : current?.cropId;
  if (scope === 'plot') {
    if (!plotId) throw badRequest('VALIDATION_FAILED', 'plotId is required for scope plot', [{ path: 'body.plotId', message: 'required' }]);
    const [p] = await tx.select({ id: plots.id }).from(plots).where(and(eq(plots.id, plotId), eq(plots.blockId, blockId)));
    if (!p) throw badRequest('PLOT_NOT_FOUND', 'Plot not in this block');
  }
  if (scope === 'per_ha_crop' && !cropId) throw badRequest('VALIDATION_FAILED', 'cropId is required for scope per_ha_crop', [{ path: 'body.cropId', message: 'required' }]);
  let unitPrice = b.unitPriceXof;
  let unit = b.unit;
  if (b.quoteId) {
    const [q] = await tx.select().from(supplierQuotes).where(and(eq(supplierQuotes.id, b.quoteId), eq(supplierQuotes.ownerOrgId, requireOrg(actor))));
    if (!q) throw badRequest('QUOTE_NOT_FOUND', 'Unknown quote', [{ path: 'body.quoteId', message: 'unknown quote' }]);
    if (q.serviceId !== (b.serviceId ?? current?.serviceId)) throw unprocessable('QUOTE_SERVICE_MISMATCH', 'The quote is for another service');
    unitPrice ??= q.unitPriceXof;
    unit ??= q.unit;
  }
  if (b.serviceId) {
    const s = await getVisibleService(tx, actor, b.serviceId);
    unitPrice ??= current ? undefined : s.defaultUnitPriceXof;
    unit ??= current ? undefined : s.unit;
  }
  return { unitPrice, unit };
}

export async function createBudgetLine(db: Db, actor: ActorContext, seasonId: string, body: LineBody) {
  return db.transaction(async (tx) => {
    const { season, block } = await loadSeason(tx, actor, seasonId, true);
    assertEditable(season);
    const { unitPrice, unit } = await validateLine(tx, actor, block.id, body);
    const [l] = await tx
      .insert(budgetLines)
      .values({
        seasonId,
        blockId: block.id,
        ownerOrgId: block.ownerOrgId,
        scope: body.scope,
        plotId: body.scope === 'plot' ? (body.plotId ?? null) : null,
        cropId: body.scope === 'per_ha_crop' ? (body.cropId ?? null) : null,
        serviceId: body.serviceId,
        qty: String(body.qty),
        unit: unit!,
        unitPriceXof: unitPrice!,
        quoteId: body.quoteId ?? null,
        payer: body.payer,
        tranche: body.tranche ?? (body.payer === 'farmer_credit' ? 'seasonal' : 'none'),
        plannedDate: body.plannedDate ?? null,
        notes: body.notes ?? null,
        createdBy: actorUserId(actor),
      })
      .returning({ id: budgetLines.id });
    await tx.update(seasons).set({ planVersion: sql`${seasons.planVersion} + 1` }).where(eq(seasons.id, seasonId));
    await audit(tx, actor, { action: 'budget_line.created', resourceType: 'budget_line', resourceId: l!.id, after: { ...body, notes: undefined } });
    return l!.id;
  });
}

async function loadLine(tx: DbOrTx, actor: ActorContext, id: string) {
  const [l] = await tx.select().from(budgetLines).where(eq(budgetLines.id, id));
  if (!l) throw notFound('Budget line');
  const ctx = await loadSeason(tx, actor, l.seasonId, true).catch(() => {
    throw notFound('Budget line');
  });
  return { l, ...ctx };
}

export async function updateBudgetLine(db: Db, actor: ActorContext, id: string, expected: number, body: Partial<LineBody>) {
  return db.transaction(async (tx) => {
    const { l, season, block } = await loadLine(tx, actor, id);
    assertEditable(season);
    assertVersion(expected, l.version);
    const { unitPrice, unit } = await validateLine(tx, actor, block.id, body, l);
    const set: Partial<typeof budgetLines.$inferInsert> = { version: l.version + 1 };
    for (const k of ['scope', 'plotId', 'cropId', 'serviceId', 'quoteId', 'payer', 'tranche', 'plannedDate', 'notes'] as const) if (body[k] !== undefined) (set as Record<string, unknown>)[k] = body[k];
    if (body.qty !== undefined) set.qty = String(body.qty);
    if (unitPrice !== undefined) set.unitPriceXof = unitPrice;
    if (unit !== undefined) set.unit = unit;
    await tx.update(budgetLines).set(set).where(eq(budgetLines.id, id));
    await tx.update(seasons).set({ planVersion: sql`${seasons.planVersion} + 1` }).where(eq(seasons.id, l.seasonId));
    await audit(tx, actor, { action: 'budget_line.updated', resourceType: 'budget_line', resourceId: id, after: { ...body, notes: undefined } });
    return l.seasonId;
  });
}

export async function deleteBudgetLine(db: Db, actor: ActorContext, id: string) {
  return db.transaction(async (tx) => {
    const { l, season } = await loadLine(tx, actor, id);
    assertEditable(season);
    await tx.delete(budgetLines).where(eq(budgetLines.id, id));
    await tx.update(seasons).set({ planVersion: sql`${seasons.planVersion} + 1` }).where(eq(seasons.id, l.seasonId));
    await audit(tx, actor, { action: 'budget_line.deleted', resourceType: 'budget_line', resourceId: id, before: { serviceId: l.serviceId, qty: l.qty } });
  });
}

/**
 * Generate per-ha-crop budget lines from the crop templates of the season's plantings (SPEC §10.6).
 * Unit price: cheapest valid supplier quote of the operator for the service, else the catalogue default.
 */
export async function generateFromTemplates(db: Db, actor: ActorContext, seasonId: string, body: { replace: boolean; payer: LineRow['payer'] }) {
  return db.transaction(async (tx) => {
    const { season, block } = await loadSeason(tx, actor, seasonId, true);
    assertEditable(season);
    const existing = await tx.select({ id: budgetLines.id }).from(budgetLines).where(and(eq(budgetLines.seasonId, seasonId), eq(budgetLines.source, 'template')));
    if (existing.length && !body.replace) throw conflict('TEMPLATE_LINES_EXIST', 'Template lines already exist; pass replace=true to regenerate');
    if (existing.length) await tx.delete(budgetLines).where(and(eq(budgetLines.seasonId, seasonId), eq(budgetLines.source, 'template')));
    const ps = await tx.select().from(plantings).where(eq(plantings.seasonId, seasonId));
    if (!ps.length) throw unprocessable('NO_PLANTINGS', 'Plan plantings before generating the budget');
    const pairs = new Map<string, string>(); // cropId → templateId (first planting wins; deterministic order)
    for (const p of [...ps].sort((a, b) => a.id.localeCompare(b.id))) if (p.templateId && !pairs.has(p.cropId)) pairs.set(p.cropId, p.templateId);
    let created = 0;
    for (const [cropId, templateId] of pairs) {
      const [t] = await tx.select().from(cropTemplates).where(eq(cropTemplates.id, templateId));
      for (const inp of t?.inputs ?? []) {
        const [s] = await tx.select().from(serviceCatalog).where(eq(serviceCatalog.id, inp.serviceId));
        if (!s) continue;
        const [q] = await tx
          .select()
          .from(supplierQuotes)
          .where(and(eq(supplierQuotes.ownerOrgId, block.ownerOrgId), eq(supplierQuotes.serviceId, s.id), gte(supplierQuotes.validUntil, season.startDate)))
          .orderBy(asc(supplierQuotes.unitPriceXof))
          .limit(1);
        await tx.insert(budgetLines).values({
          seasonId,
          blockId: block.id,
          ownerOrgId: block.ownerOrgId,
          scope: 'per_ha_crop',
          cropId,
          serviceId: s.id,
          qty: String(inp.qtyPerHa),
          unit: q?.unit ?? inp.unit ?? s.unit,
          unitPriceXof: q?.unitPriceXof ?? s.defaultUnitPriceXof,
          quoteId: q?.id ?? null,
          payer: body.payer,
          tranche: body.payer === 'farmer_credit' ? 'seasonal' : 'none',
          source: 'template',
          createdBy: actorUserId(actor),
        });
        created++;
      }
    }
    await tx.update(seasons).set({ planVersion: sql`${seasons.planVersion} + 1` }).where(eq(seasons.id, seasonId));
    await audit(tx, actor, { action: 'budget.generated_from_templates', resourceType: 'season', resourceId: seasonId, after: { lines: created, replace: body.replace } });
    return created;
  });
}

// ---------------------------------------------------------------- supplier quotes

const quoteDto = (q: typeof supplierQuotes.$inferSelect) => ({ id: q.id, supplierOrgId: q.supplierOrgId, supplierName: q.supplierName, serviceId: q.serviceId, unit: q.unit, unitPriceXof: q.unitPriceXof, minQty: num(q.minQty), validUntil: q.validUntil, fileId: q.fileId, private: q.private, createdAt: q.createdAt.toISOString() });

export async function listQuotes(db: DbOrTx, actor: ActorContext, serviceId?: string) {
  const conds = [eq(supplierQuotes.ownerOrgId, requireOrg(actor))];
  if (serviceId) conds.push(eq(supplierQuotes.serviceId, serviceId));
  return (await db.select().from(supplierQuotes).where(and(...conds)).orderBy(desc(supplierQuotes.id))).map(quoteDto);
}

export async function createQuote(db: Db, actor: ActorContext, body: { supplierOrgId?: string | null; supplierName: string; serviceId: string; unit: LineRow['unit']; unitPriceXof: number; minQty?: number | null; validUntil: string; fileId?: string | null; private: boolean }) {
  const orgId = requireOrg(actor);
  return db.transaction(async (tx) => {
    await getVisibleService(tx, actor, body.serviceId);
    if (body.fileId) {
      const [f] = await tx.select({ id: files.id }).from(files).where(and(eq(files.id, body.fileId), eq(files.ownerOrgId, orgId)));
      if (!f) throw badRequest('FILE_NOT_FOUND', 'File not found', [{ path: 'body.fileId', message: 'unknown file' }]);
    }
    const [q] = await tx.insert(supplierQuotes).values({ ...body, minQty: body.minQty === undefined || body.minQty === null ? null : String(body.minQty), ownerOrgId: orgId, createdBy: actorUserId(actor) }).returning();
    await audit(tx, actor, { action: 'supplier_quote.created', resourceType: 'supplier_quote', resourceId: q!.id, after: { serviceId: body.serviceId, unitPriceXof: body.unitPriceXof } });
    return quoteDto(q!);
  });
}

// ---------------------------------------------------------------- capex, opex, fee policy

const capexDto = (c: typeof capexItems.$inferSelect) => ({ id: c.id, blockId: c.blockId, description: c.description, assetType: c.assetType, amountXof: c.amountXof, usefulLifeYears: c.usefulLifeYears, quoteId: c.quoteId, tranche: c.tranche, plannedDate: c.plannedDate, version: c.version });
const opexDto = (o: typeof operatorOpex.$inferSelect) => ({ id: o.id, blockId: o.blockId, description: o.description, kind: o.kind, amountXofPerMonth: o.amountXofPerMonth, startDate: o.startDate, endDate: o.endDate, version: o.version });
const feeDto = (f: typeof feePolicies.$inferSelect) => ({ id: f.id, blockId: f.blockId, operatorServiceFeeXofPerFarmerSeason: f.operatorServiceFeeXofPerFarmerSeason, landFeeXofPerHaSeason: f.landFeeXofPerHaSeason, investmentRecoveryFeeXofPerHaSeason: f.investmentRecoveryFeeXofPerHaSeason, effectiveFrom: f.effectiveFrom, version: f.version });

export async function listCapex(db: DbOrTx, actor: ActorContext, blockId: string) {
  await loadBlock(db, actor, blockId);
  return (await db.select().from(capexItems).where(eq(capexItems.blockId, blockId)).orderBy(asc(capexItems.plannedDate))).map(capexDto);
}
export async function createCapex(db: Db, actor: ActorContext, blockId: string, body: Omit<typeof capexItems.$inferInsert, 'blockId' | 'ownerOrgId'>) {
  return db.transaction(async (tx) => {
    const b = await loadBlock(tx, actor, blockId, true);
    const [c] = await tx.insert(capexItems).values({ ...body, blockId, ownerOrgId: b.ownerOrgId, createdBy: actorUserId(actor) }).returning();
    await audit(tx, actor, { action: 'capex_item.created', resourceType: 'capex_item', resourceId: c!.id, after: body });
    return capexDto(c!);
  });
}
export async function deleteCapex(db: Db, actor: ActorContext, id: string) {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(capexItems).where(eq(capexItems.id, id));
    if (!c) throw notFound('Capex item');
    await loadBlock(tx, actor, c.blockId, true).catch(() => {
      throw notFound('Capex item');
    });
    await tx.delete(capexItems).where(eq(capexItems.id, id));
    await audit(tx, actor, { action: 'capex_item.deleted', resourceType: 'capex_item', resourceId: id, before: capexDto(c) });
  });
}
export async function listOpex(db: DbOrTx, actor: ActorContext, blockId: string) {
  await loadBlock(db, actor, blockId);
  return (await db.select().from(operatorOpex).where(eq(operatorOpex.blockId, blockId)).orderBy(asc(operatorOpex.startDate))).map(opexDto);
}
export async function createOpex(db: Db, actor: ActorContext, blockId: string, body: Omit<typeof operatorOpex.$inferInsert, 'blockId' | 'ownerOrgId'>) {
  if (body.endDate && body.endDate < body.startDate) throw unprocessable('END_BEFORE_START', 'End date is before start date');
  return db.transaction(async (tx) => {
    const b = await loadBlock(tx, actor, blockId, true);
    const [o] = await tx.insert(operatorOpex).values({ ...body, blockId, ownerOrgId: b.ownerOrgId, createdBy: actorUserId(actor) }).returning();
    await audit(tx, actor, { action: 'operator_opex.created', resourceType: 'operator_opex', resourceId: o!.id, after: body });
    return opexDto(o!);
  });
}
export async function deleteOpex(db: Db, actor: ActorContext, id: string) {
  return db.transaction(async (tx) => {
    const [o] = await tx.select().from(operatorOpex).where(eq(operatorOpex.id, id));
    if (!o) throw notFound('Opex item');
    await loadBlock(tx, actor, o.blockId, true).catch(() => {
      throw notFound('Opex item');
    });
    await tx.delete(operatorOpex).where(eq(operatorOpex.id, id));
    await audit(tx, actor, { action: 'operator_opex.deleted', resourceType: 'operator_opex', resourceId: id, before: opexDto(o) });
  });
}

export async function currentFeePolicy(db: DbOrTx, blockId: string) {
  const [f] = await db.select().from(feePolicies).where(and(eq(feePolicies.blockId, blockId), isNull(feePolicies.supersededAt))).orderBy(desc(feePolicies.effectiveFrom)).limit(1);
  return f ?? null;
}
export async function getFeePolicy(db: DbOrTx, actor: ActorContext, blockId: string) {
  await loadBlock(db, actor, blockId);
  const f = await currentFeePolicy(db, blockId);
  if (!f) throw notFound('Fee policy');
  return feeDto(f);
}
/** One active fee policy per block: PUT supersedes the previous row (history kept). */
export async function putFeePolicy(db: Db, actor: ActorContext, blockId: string, body: { operatorServiceFeeXofPerFarmerSeason: number; landFeeXofPerHaSeason: number; investmentRecoveryFeeXofPerHaSeason: number; effectiveFrom?: string }) {
  return db.transaction(async (tx) => {
    const b = await loadBlock(tx, actor, blockId, true);
    const prev = await currentFeePolicy(tx, blockId);
    if (prev) await tx.update(feePolicies).set({ supersededAt: new Date() }).where(eq(feePolicies.id, prev.id));
    const [f] = await tx.insert(feePolicies).values({ ...body, effectiveFrom: body.effectiveFrom ?? new Date().toISOString().slice(0, 10), blockId, ownerOrgId: b.ownerOrgId, createdBy: actorUserId(actor) }).returning();
    await audit(tx, actor, { action: 'fee_policy.set', resourceType: 'fee_policy', resourceId: f!.id, before: prev ? feeDto(prev) : null, after: feeDto(f!) });
    await emit(tx, actor, 'fee_policy.set', { type: 'block', id: blockId }, {});
    return feeDto(f!);
  });
}
