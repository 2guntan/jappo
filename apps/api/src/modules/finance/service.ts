import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { computeBlockModel, type ModelInput, type ModelOutput } from '@jappo/domain';
import type { Db, DbOrTx } from '../../db/client';
import { financingAssumptions, modelRuns } from './schema';
import { farmers } from '../farmers/schema';
import type { ActorContext } from '../../core/context';
import { actorUserId } from '../../core/context';
import { audit } from '../../core/audit';
import { emit } from '../../core/events';
import { notFound, unprocessable } from '../../core/errors';
import { budgetInput, currentFeePolicy, listPlantings, loadSeason } from '../planning/service';
import { capexItems, operatorOpex } from '../planning/schema';

type Assumptions = typeof financingAssumptions.$inferSelect;

/** Whole months between two ISO dates (≥ 0). */
export function monthOffset(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00Z`);
  const b = new Date(`${toIso}T00:00:00Z`);
  return Math.max(0, (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()));
}

export async function getAssumptions(db: DbOrTx, seasonId: string): Promise<Assumptions | null> {
  const [a] = await db.select().from(financingAssumptions).where(eq(financingAssumptions.seasonId, seasonId));
  return a ?? null;
}

const assumptionsDto = (seasonId: string, a: Assumptions | null) => ({
  seasonId,
  seasonal: a?.seasonal ?? null,
  investment: a?.investment ?? null,
  seasonsPerYear: a?.seasonsPerYear ?? 1,
  discountRateBps: a?.discountRateBps ?? 1200,
  version: a?.version ?? 0,
});

export async function assumptionsOut(db: DbOrTx, actor: ActorContext, seasonId: string) {
  await loadSeason(db, actor, seasonId);
  return assumptionsDto(seasonId, await getAssumptions(db, seasonId));
}

export async function putAssumptions(db: Db, actor: ActorContext, seasonId: string, body: { seasonal: Assumptions['seasonal']; investment: Assumptions['investment']; seasonsPerYear: number; discountRateBps: number }) {
  return db.transaction(async (tx) => {
    const { season, block } = await loadSeason(tx, actor, seasonId, true);
    if (!['planning', 'financing'].includes(season.status)) throw unprocessable('SEASON_LOCKED', 'Assumptions are locked once the season started');
    const prev = await getAssumptions(tx, seasonId);
    if (prev) await tx.update(financingAssumptions).set({ ...body, version: prev.version + 1 }).where(eq(financingAssumptions.id, prev.id));
    else await tx.insert(financingAssumptions).values({ ...body, seasonId, blockId: block.id, ownerOrgId: block.ownerOrgId, createdBy: actorUserId(actor) });
    await audit(tx, actor, { action: 'model_assumptions.set', resourceType: 'season', resourceId: seasonId, after: body });
    return assumptionsDto(seasonId, await getAssumptions(tx, seasonId));
  });
}

/** Assemble the full §9.1 model input for a season from current data. */
export async function assembleModelInput(db: DbOrTx, actor: ActorContext, seasonId: string): Promise<ModelInput> {
  const { season, block } = await loadSeason(db, actor, seasonId);
  const { input: b } = await budgetInput(db, seasonId, block.id);
  const eff = await listPlantings(db, actor, seasonId);
  const farmerIds = [...new Set(b.allocations.map((a) => a.farmerId))];
  const fs = farmerIds.length ? await db.select({ id: farmers.id, code: farmers.code, baseline: farmers.baselineIncomeXof }).from(farmers).where(inArray(farmers.id, farmerIds)) : [];
  const fee = await currentFeePolicy(db, block.id);
  const capex = await db.select().from(capexItems).where(eq(capexItems.blockId, block.id));
  const opex = await db.select().from(operatorOpex).where(eq(operatorOpex.blockId, block.id));
  const a = await getAssumptions(db, seasonId);
  return {
    plots: b.plots,
    allocations: b.allocations,
    farmers: fs.map((f) => ({ farmerId: f.id, farmerCode: f.code, baselineIncomeXof: f.baseline })).sort((x, y) => x.farmerCode.localeCompare(y.farmerCode)),
    plantings: eff
      .map((p) => ({
        plantingId: p.id,
        plotId: p.plotId,
        cropId: p.cropId,
        areaHa: p.areaHa,
        yieldBaseTHa: p.yieldBaseTHa,
        yieldStressTHa: p.yieldStressTHa,
        postHarvestLossPct: p.postHarvestLossPct,
        deliveryRatePct: p.deliveryRatePct,
        priceXofPerKgBase: p.priceXofPerKgBase,
        priceXofPerKgStress: p.priceXofPerKgStress,
        harvestMonth: monthOffset(season.startDate, p.plannedHarvestDate ?? season.endDate),
      }))
      .sort((x, y) => x.plantingId.localeCompare(y.plantingId)),
    budgetLines: b.lines,
    feePolicy: fee ? { operatorServiceFeeXofPerFarmerSeason: fee.operatorServiceFeeXofPerFarmerSeason, landFeeXofPerHaSeason: fee.landFeeXofPerHaSeason, investmentRecoveryFeeXofPerHaSeason: fee.investmentRecoveryFeeXofPerHaSeason } : null,
    capexItems: capex.map((c) => ({ amountXof: c.amountXof, tranche: c.tranche, month: monthOffset(season.startDate, c.plannedDate) })).sort((x, y) => x.month - y.month || x.amountXof - y.amountXof),
    opex: opex.map((o) => ({ amountXofPerMonth: o.amountXofPerMonth, startMonth: monthOffset(season.startDate, o.startDate), endMonth: o.endDate ? monthOffset(season.startDate, o.endDate) : null })).sort((x, y) => x.startMonth - y.startMonth),
    tranches: {
      seasonal: a?.seasonal ? { ...a.seasonal } : null,
      investment: a?.investment ?? null,
    },
    seasonsPerYear: a?.seasonsPerYear ?? 1,
    discountRateBps: a?.discountRateBps ?? 1200,
  };
}

const runDto = (r: typeof modelRuns.$inferSelect, currentHash: string | null) => ({
  id: r.id,
  blockId: r.blockId,
  seasonId: r.seasonId,
  engineVersion: r.engineVersion,
  inputsHash: r.inputsHash,
  current: currentHash !== null && r.inputsHash === currentHash,
  computedAt: r.computedAt.toISOString(),
  outputs: r.outputs as ModelOutput,
});

/** Current inputs hash (cheap enough to recompute: same pure engine). */
export async function currentInputsHash(db: DbOrTx, actor: ActorContext, seasonId: string): Promise<string> {
  return computeBlockModel(await assembleModelInput(db, actor, seasonId)).inputsHash;
}

export async function runModel(db: Db, actor: ActorContext, seasonId: string) {
  const { block } = await loadSeason(db, actor, seasonId, true);
  const input = await assembleModelInput(db, actor, seasonId);
  const out = computeBlockModel(input);
  return db.transaction(async (tx) => {
    const [r] = await tx
      .insert(modelRuns)
      .values({ blockId: block.id, seasonId, ownerOrgId: block.ownerOrgId, engineVersion: out.engineVersion, inputsHash: out.inputsHash, inputs: input as object, outputs: out as object, computedBy: actorUserId(actor), createdBy: actorUserId(actor) })
      .returning();
    await audit(tx, actor, { action: 'model_run.computed', resourceType: 'model_run', resourceId: r!.id, after: { seasonId, inputsHash: out.inputsHash, hcrBase: out.scenarios.base.block.hcr } });
    await emit(tx, actor, 'model_run.computed', { type: 'model_run', id: r!.id }, { seasonId, blockId: block.id });
    return runDto(r!, out.inputsHash);
  });
}

export async function getRun(db: DbOrTx, actor: ActorContext, id: string) {
  const [r] = await db.select().from(modelRuns).where(eq(modelRuns.id, id));
  if (!r) throw notFound('Model run');
  await loadSeason(db, actor, r.seasonId).catch(() => {
    throw notFound('Model run');
  });
  return runDto(r, await currentInputsHash(db, actor, r.seasonId).catch(() => null));
}

export async function latestRun(db: DbOrTx, seasonId: string) {
  const [r] = await db.select().from(modelRuns).where(and(eq(modelRuns.seasonId, seasonId), isNull(modelRuns.financingRequestId))).orderBy(desc(modelRuns.computedAt)).limit(1);
  return r ?? null;
}

export async function currentRun(db: DbOrTx, actor: ActorContext, seasonId: string) {
  await loadSeason(db, actor, seasonId);
  const r = await latestRun(db, seasonId);
  if (!r) throw notFound('Model run');
  return runDto(r, await currentInputsHash(db, actor, seasonId));
}

/** Unsaved what-if (SPEC §10.8): shocks on base yield/price and an optional seasonal rate. */
export async function previewModel(db: DbOrTx, actor: ActorContext, seasonId: string, body: { yieldShockPct: number; priceShockPct: number; seasonalRateBps?: number }) {
  const input = await assembleModelInput(db, actor, seasonId);
  const y = 1 - body.yieldShockPct / 100;
  const p = 1 - body.priceShockPct / 100;
  input.plantings = input.plantings.map((pl) => ({
    ...pl,
    yieldBaseTHa: pl.yieldBaseTHa === null ? null : pl.yieldBaseTHa * y,
    yieldStressTHa: pl.yieldStressTHa === null ? null : pl.yieldStressTHa * y,
    priceXofPerKgBase: pl.priceXofPerKgBase === null ? null : Math.round(pl.priceXofPerKgBase * p),
    priceXofPerKgStress: pl.priceXofPerKgStress === null ? null : Math.round(pl.priceXofPerKgStress * p),
  }));
  if (body.seasonalRateBps !== undefined && input.tranches.seasonal) input.tranches.seasonal = { ...input.tranches.seasonal, rateBps: body.seasonalRateBps };
  const out = computeBlockModel(input);
  return { id: '00000000-0000-7000-8000-000000000000', blockId: (await loadSeason(db, actor, seasonId)).block.id, seasonId, engineVersion: out.engineVersion, inputsHash: out.inputsHash, current: false, computedAt: new Date().toISOString(), outputs: out };
}

