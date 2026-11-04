import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { blockMachine, canonicalJson, computeReadiness, transition, type ModelOutput, type ReadinessInput } from '@jappo/domain';
import type { Db, DbOrTx } from '../../db/client';
import { dossiers, riskCovers } from './schema';
import { blocks, landDocuments, plotAllocations, plots } from '../land/schema';
import { farmers } from '../farmers/schema';
import { offtakeContracts } from '../offtake/schema';
import { organizations, memberships } from '../identity/schema';
import { seasons, supplierQuotes, capexItems } from '../planning/schema';
import { crops } from '../catalogue/schema';
import { files } from '../../core/schema';
import type { ActorContext } from '../../core/context';
import { actorUserId } from '../../core/context';
import { audit } from '../../core/audit';
import { emit } from '../../core/events';
import { nextRef } from '../../core/refs';
import { conflict, notFound, unprocessable } from '../../core/errors';
import { hasPermission } from '../../core/authz/permissions';
import { assertVersion } from '../../core/etag';
import { sha256 } from '../../core/crypto';
import { asGeoJson } from '../../core/geo';
import { budgetSummary, listPlantings, loadSeason } from '../planning/service';
import { blockVisible, loadBlock } from '../land/service';
import { currentInputsHash, getAssumptions, latestRun, assembleModelInput } from '../finance/service';
import { linkFile } from '../files/service';
import { grant } from '../../core/authz/visibility';
import { facilities } from '../facilities/schema';

const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- readiness

/** Gather everything §9.2 needs for a season. */
export async function gatherReadiness(db: DbOrTx, actor: ActorContext, seasonId: string): Promise<{ input: ReadinessInput; run: Awaited<ReturnType<typeof latestRun>>; current: boolean }> {
  const { season, block } = await loadSeason(db, actor, seasonId);
  const [areas] = await db
    .select({ n: sql<number>`count(*)::int`, area: sql<string>`coalesce(sum(${plots.areaHa}) filter (where ${plots.status} <> 'excluded'), 0)` })
    .from(plots)
    .where(and(eq(plots.blockId, block.id), isNull(plots.archivedAt)));
  const docs = await db.select().from(landDocuments).where(eq(landDocuments.blockId, block.id));
  const eff = await listPlantings(db, actor, seasonId);
  const plantedPlots = [...new Set(eff.map((p) => p.plotId))];
  const allocs = await db.select().from(plotAllocations).where(and(eq(plotAllocations.blockId, block.id), eq(plotAllocations.status, 'active')));
  const farmerIds = [...new Set(allocs.filter((a) => plantedPlots.includes(a.plotId)).map((a) => a.farmerId))];
  const fs = farmerIds.length ? await db.select().from(farmers).where(inArray(farmers.id, farmerIds)) : [];
  const assumptions = await getAssumptions(db, seasonId);
  const run = await latestRun(db, seasonId);
  const hash = await currentInputsHash(db, actor, seasonId);
  const current = !!run && run.inputsHash === hash;
  const out = run?.outputs as ModelOutput | undefined;

  // Offtake coverage per crop vs. base deliverable kg (§9.1.2 formula on the effective plan)
  const delivByCrop = new Map<string, number>();
  for (const p of eff) {
    const kg = p.areaHa * (p.yieldBaseTHa ?? 0) * 1000 * (1 - (p.postHarvestLossPct ?? 0) / 100) * ((p.deliveryRatePct ?? 0) / 100);
    delivByCrop.set(p.cropId, (delivByCrop.get(p.cropId) ?? 0) + kg);
  }
  const cropIds = [...new Set(eff.map((p) => p.cropId))];
  const contracts = cropIds.length
    ? await db
        .select({ o: offtakeContracts, buyerKyc: organizations.kycStatus })
        .from(offtakeContracts)
        .innerJoin(organizations, eq(organizations.id, offtakeContracts.buyerOrgId))
        .where(and(eq(offtakeContracts.blockId, block.id), inArray(offtakeContracts.cropId, cropIds)))
    : [];
  const covers = await db.select().from(riskCovers).where(eq(riskCovers.blockId, block.id));
  const [operator] = await db.select().from(organizations).where(eq(organizations.id, block.ownerOrgId));
  const [{ closed } = { closed: 0 }] = await db.select({ closed: sql<number>`count(*)::int` }).from(seasons).where(and(eq(seasons.ownerOrgId, block.ownerOrgId), eq(seasons.status, 'closed')));
  const [{ staff } = { staff: 0 }] = await db
    .select({ staff: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.orgId, block.ownerOrgId), eq(memberships.status, 'active'), sql`${memberships.roles} && array['agronomist','field_agent']::text[]`));
  const capex = await db.select().from(capexItems).where(eq(capexItems.blockId, block.id));
  const capexTotal = capex.reduce((s, c) => s + c.amountXof, 0);
  const equity = capex.filter((c) => c.tranche === 'equity').reduce((s, c) => s + c.amountXof, 0);
  const plotRows = await db.select({ soil: plots.soilType }).from(plots).where(and(eq(plots.blockId, block.id), isNull(plots.archivedAt)));
  const summary = await budgetSummary(db, actor, seasonId);
  const tenors = [assumptions?.seasonal?.tenorMonths ?? 0, assumptions?.investment?.tenorMonths ?? 0];
  const seasonalRequested = !!assumptions?.seasonal;
  const firstLoss = covers.filter((c) => c.type === 'first_loss' && c.providerOrgId === block.ownerOrgId && ['committed', 'active'].includes(c.status));

  const input: ReadinessInput = {
    block: { hasBoundary: !!block.boundary, areaHa: Number(block.areaHa ?? 0), activePlotAreaHa: Number(areas?.area ?? 0), plotCount: areas?.n ?? 0 },
    landDocs: docs.map((d) => ({ id: d.id, docType: d.docType, status: d.status, expiryDate: d.expiryDate })),
    today: today(),
    remainingTenorMonths: Math.max(...tenors),
    plantings: eff.map((p) => ({ plantingId: p.id, plotId: p.plotId, hasYields: p.yieldBaseTHa !== null && p.yieldStressTHa !== null, hasPrices: p.priceXofPerKgBase !== null && p.priceXofPerKgStress !== null })),
    plotsWithPlanting: plantedPlots.map((pid) => ({ plotId: pid, hasActiveAllocation: allocs.some((a) => a.plotId === pid) })),
    farmers: fs.map((f) => ({ farmerId: f.id, kycVerified: f.kycStatus === 'verified', consentData: !!f.consentDataAt, consentCreditBureau: !!f.consentCreditBureauAt, walletVerified: !!f.walletVerifiedAt, hasPhoto: !!f.photoFileId, inArrears: false })),
    seasonalBorrowerIsFarmers: seasonalRequested && assumptions!.seasonal!.borrowerType !== 'operator',
    offtake: cropIds.map((cid) => ({
      cropId: cid,
      deliverableKgBase: delivByCrop.get(cid) ?? 0,
      contracts: contracts
        .filter((c) => c.o.cropId === cid && (c.o.seasonId === null || c.o.seasonId === seasonId))
        .map((c) => ({ id: c.o.id, status: c.o.status, minVolumeKg: Number(c.o.minVolumeKg), paysIntoEscrow: c.o.paysIntoEscrow, priceType: c.o.priceType, hasFloor: c.o.floorXofPerKg !== null, buyerKycVerified: c.buyerKyc === 'verified' })),
    })),
    model: {
      current,
      hcrBase: out?.scenarios.base.block.hcr ?? null,
      hcrCombined: out?.scenarios.combined.block.hcr ?? null,
      minDscr: out?.scenarios.base.block.minDscr ?? null,
      hasSeasonalTranche: seasonalRequested,
      hasInvestmentTranche: !!assumptions?.investment,
    },
    operatorKycVerified: operator?.kycStatus === 'verified',
    riskCovers: covers.map((c) => ({ id: c.id, type: c.type, status: c.status, coveragePct: Number(c.coveragePct) })),
    firstLossPctOfTranche: firstLoss.length ? Math.max(...firstLoss.map((c) => Number(c.coveragePct))) : 0,
    operator: { priorSettledSeasons: closed, haPerStaff: staff > 0 ? Number(block.areaHa ?? 0) / staff : null, equityShareOfCapexPct: capexTotal > 0 ? (equity / capexTotal) * 100 : 0 },
    completeness: {
      allPlotsSoilType: plotRows.length > 0 && plotRows.every((p) => !!p.soil),
      allFarmersPhoto: fs.length > 0 && fs.every((f) => !!f.photoFileId),
      visitsOk: season.status === 'planning' || season.status === 'financing',
      quotedShareOfSeasonalBudgetPct: summary.quotedSharePct,
    },
  };
  return { input, run, current };
}

export async function readiness(db: DbOrTx, actor: ActorContext, seasonId: string) {
  return computeReadiness((await gatherReadiness(db, actor, seasonId)).input);
}

/** Block `documenting ↔ ready` from the readiness of a season (SPEC §8.1). */
export async function checkBlockReadiness(db: Db, actor: ActorContext, blockId: string, seasonId: string) {
  const r = await readiness(db, actor, seasonId);
  await db.transaction(async (tx) => {
    const b = await loadBlock(tx, actor, blockId, true);
    const { season } = await loadSeason(tx, actor, seasonId);
    if (season.blockId !== blockId) throw notFound('Season');
    if (r.allGatesPass && b.status === 'documenting') {
      await tx.update(blocks).set({ status: transition(blockMachine, b.status, 'check_readiness'), version: b.version + 1 }).where(eq(blocks.id, blockId));
      await audit(tx, actor, { action: 'block.ready', resourceType: 'block', resourceId: blockId, before: { status: b.status }, after: { status: 'ready', score: r.score } });
      await emit(tx, actor, 'block.ready', { type: 'block', id: blockId }, { seasonId, score: r.score, grade: r.grade });
    } else if (!r.allGatesPass && b.status === 'ready') {
      await tx.update(blocks).set({ status: transition(blockMachine, b.status, 'gate_failed'), version: b.version + 1 }).where(eq(blocks.id, blockId));
      await audit(tx, actor, { action: 'block.documenting', resourceType: 'block', resourceId: blockId, before: { status: b.status }, after: { status: 'documenting' } });
    } else if (b.status === 'draft' && r.allGatesPass) {
      throw conflict('INVALID_STATE_TRANSITION', 'Add land documents or plots first');
    }
  });
  return r;
}

// ---------------------------------------------------------------- dossier

type DossierRow = typeof dossiers.$inferSelect;

async function dataRoomFiles(db: DbOrTx, manifest: DossierRow['dataRoomManifest']) {
  const ids = manifest.map((m) => m.fileId);
  const fs = ids.length ? await db.select().from(files).where(inArray(files.id, ids)) : [];
  return manifest.map((m) => {
    const f = fs.find((x) => x.id === m.fileId);
    return { ...m, filename: f?.filename, mime: f?.mime };
  });
}

export async function dossierDto(db: DbOrTx, actor: ActorContext, d: DossierRow) {
  const own = d.ownerOrgId === actor.orgId;
  return {
    id: d.id,
    ref: d.ref,
    blockId: d.blockId,
    seasonId: d.seasonId,
    version: d.dossierVersion,
    status: d.status,
    readinessScore: d.readinessScore,
    grade: d.grade as 'A',
    gates: d.gates as never,
    scoreBreakdown: d.scoreBreakdown as Record<string, number>,
    modelRunId: d.modelRunId,
    snapshot: d.snapshot as Record<string, unknown>,
    contentSha256: d.contentSha256,
    pdfFileId: d.pdfFileId,
    pdfStatus: d.pdfStatus,
    dataRoom: await dataRoomFiles(db, d.dataRoomManifest),
    frozenAt: d.frozenAt?.toISOString() ?? null,
    allowedActions: own && hasPermission(actor.permissions, 'financing_request:manage') && d.status === 'frozen' ? ['create_financing_request'] : [],
  };
}

/** Dossiers are visible with their block (owner, platform staff, grantees) or through a direct grant. */
export async function getDossier(db: DbOrTx, actor: ActorContext, id: string) {
  const [d] = await db.select({ d: dossiers }).from(dossiers).innerJoin(blocks, eq(blocks.id, dossiers.blockId)).where(and(eq(dossiers.id, id), blockVisibleOrDossierGrant(actor)));
  if (!d) throw notFound('Dossier');
  return d.d;
}

function blockVisibleOrDossierGrant(actor: ActorContext) {
  return sql`(${blockVisible(actor)} or exists (select 1 from access_grants g where g.resource_type = 'dossier' and g.resource_id = "dossiers"."id" and g.grantee_org_id = ${actor.orgId ?? '00000000-0000-0000-0000-000000000000'} and (g.expires_at is null or g.expires_at > now())))`;
}

export async function listDossiers(db: DbOrTx, actor: ActorContext, seasonId: string) {
  await loadSeason(db, actor, seasonId);
  const rows = await db.select().from(dossiers).where(eq(dossiers.seasonId, seasonId)).orderBy(desc(dossiers.dossierVersion));
  return Promise.all(rows.map((d) => dossierDto(db, actor, d)));
}

/** Freeze a dossier version (SPEC §10.8): all gates must pass and the model must be current. */
export async function freezeDossier(db: Db, actor: ActorContext, seasonId: string) {
  const { input, run, current } = await gatherReadiness(db, actor, seasonId);
  const r = computeReadiness(input);
  if (!r.allGatesPass) throw unprocessable('GATES_FAILING', 'All readiness gates must pass before freezing the dossier', r.gates.filter((g) => !g.pass).map((g) => ({ path: g.code, message: g.reasons.map((x) => x.code).join(', '), code: g.code })), { gates: r.gates });
  if (!run || !current) throw unprocessable('MODEL_NOT_CURRENT', 'Run the model before freezing');
  const { season, block } = await loadSeason(db, actor, seasonId, true);
  const snapshot = await buildSnapshot(db, actor, seasonId, run.outputs as ModelOutput, r);
  const manifest = await buildManifest(db, block.id, seasonId);
  return db.transaction(async (tx) => {
    const [prev] = await tx.select().from(dossiers).where(eq(dossiers.seasonId, seasonId)).orderBy(desc(dossiers.dossierVersion)).limit(1);
    if (prev?.status === 'frozen') await tx.update(dossiers).set({ status: 'superseded', version: prev.version + 1 }).where(eq(dossiers.id, prev.id));
    const ref = await nextRef(tx, 'DOS');
    const content = canonicalJson({ snapshot, gates: r.gates, breakdown: r.breakdown, score: r.score, modelRunId: run.id, manifest });
    const [d] = await tx
      .insert(dossiers)
      .values({
        ref,
        blockId: block.id,
        seasonId,
        ownerOrgId: block.ownerOrgId,
        dossierVersion: (prev?.dossierVersion ?? 0) + 1,
        status: 'frozen',
        readinessScore: r.score,
        grade: r.grade,
        gates: r.gates,
        scoreBreakdown: r.breakdown,
        modelRunId: run.id,
        snapshot,
        contentSha256: sha256(content),
        dataRoomManifest: manifest,
        frozenAt: new Date(),
        createdBy: actorUserId(actor),
      })
      .returning();
    if (block.status === 'documenting') {
      await tx.update(blocks).set({ status: transition(blockMachine, 'documenting', 'check_readiness'), version: block.version + 1 }).where(eq(blocks.id, block.id));
      await emit(tx, actor, 'block.ready', { type: 'block', id: block.id }, { seasonId, score: r.score });
    }
    await audit(tx, actor, { action: 'dossier.frozen', resourceType: 'dossier', resourceId: d!.id, after: { ref, score: r.score, grade: r.grade, season: season.name } });
    await emit(tx, actor, 'dossier.frozen', { type: 'dossier', id: d!.id }, { seasonId, blockId: block.id, ref });
    return d!;
  });
}

async function buildSnapshot(db: DbOrTx, actor: ActorContext, seasonId: string, model: ModelOutput, r: ReturnType<typeof computeReadiness>) {
  const { season, block } = await loadSeason(db, actor, seasonId);
  const [blockRow] = await db.select({ boundary: asGeoJson(blocks.boundary) }).from(blocks).where(eq(blocks.id, block.id));
  const plotRows = await db.select({ id: plots.id, code: plots.code, areaHa: plots.areaHa, geom: asGeoJson(plots.geometry) }).from(plots).where(and(eq(plots.blockId, block.id), isNull(plots.archivedAt)));
  const input = await assembleModelInput(db, actor, seasonId);
  const fIds = input.farmers.map((f) => f.farmerId);
  const fs = fIds.length ? await db.select().from(farmers).where(inArray(farmers.id, fIds)) : [];
  const year = Number(season.startDate.slice(0, 4));
  const cropRows = await db.select({ id: crops.id, code: crops.code, nameFr: crops.nameFr, nameEn: crops.nameEn }).from(crops);
  const cropName = new Map(cropRows.map((c) => [c.id, { code: c.code, fr: c.nameFr, en: c.nameEn }]));
  const contracts = await db.select({ o: offtakeContracts, buyer: organizations.legalName }).from(offtakeContracts).innerJoin(organizations, eq(organizations.id, offtakeContracts.buyerOrgId)).where(and(eq(offtakeContracts.blockId, block.id), ne(offtakeContracts.status, 'draft')));
  const covers = await db.select().from(riskCovers).where(eq(riskCovers.blockId, block.id));
  const summary = await budgetSummary(db, actor, seasonId);
  const assumptions = await getAssumptions(db, seasonId);
  const base = model.scenarios.base;
  const nets = base.farmers.map((f) => f.netIncomeXof).sort((a, b) => a - b);
  // Farmers summary only — no PII in the dossier (SPEC §14.1).
  return {
    block: { ref: block.ref, name: block.name, region: block.region, department: block.department, commune: block.commune, village: block.village, areaHa: Number(block.areaHa ?? 0), tenureType: block.tenureType, waterSource: block.waterSource, irrigationType: block.irrigationType, boundary: blockRow?.boundary ?? null, plots: plotRows.map((p) => ({ code: p.code, areaHa: Number(p.areaHa), geometry: p.geom })) },
    season: { name: season.name, kind: season.kind, startDate: season.startDate, endDate: season.endDate },
    farmers: {
      count: fs.length,
      women: fs.filter((f) => f.sex === 'F').length,
      youth: fs.filter((f) => f.birthYear !== null && year - f.birthYear < 35).length,
      walletVerified: fs.filter((f) => !!f.walletVerifiedAt).length,
      kycVerified: fs.filter((f) => f.kycStatus === 'verified').length,
      netIncomeAvgXof: nets.length ? Math.round(nets.reduce((a, b) => a + b, 0) / nets.length) : 0,
      netIncomeMedianXof: nets.length ? nets[Math.floor(nets.length / 2)]! : 0,
    },
    plan: input.plantings.map((p) => ({ crop: cropName.get(p.cropId), areaHa: p.areaHa, yieldBaseTHa: p.yieldBaseTHa, yieldStressTHa: p.yieldStressTHa, priceXofPerKgBase: p.priceXofPerKgBase, priceXofPerKgStress: p.priceXofPerKgStress })),
    budget: { totals: summary.totals, perHaXof: summary.perHaXof, plantedHa: summary.plantedHa, quotedSharePct: summary.quotedSharePct },
    offtake: contracts.map((c) => ({ ref: c.o.ref, buyer: c.buyer, crop: cropName.get(c.o.cropId), minVolumeKg: Number(c.o.minVolumeKg), maxVolumeKg: Number(c.o.maxVolumeKg), priceType: c.o.priceType, priceXofPerKg: c.o.priceXofPerKg, status: c.o.status, paysIntoEscrow: c.o.paysIntoEscrow })),
    model: { engineVersion: model.engineVersion, inputsHash: model.inputsHash, tranches: model.tranches, scenarios: Object.fromEntries(Object.entries(model.scenarios).map(([k, v]) => [k, v.block])), breakevenYieldByCrop: model.breakevenYieldByCrop.map((b) => ({ ...b, crop: cropName.get(b.cropId) })), cashflow: base.monthlyCashflow.slice(0, 24), warnings: model.warnings },
    assumptions: { seasonal: assumptions?.seasonal ?? null, investment: assumptions?.investment ?? null },
    riskCovers: covers.map((c) => ({ type: c.type, providerName: c.providerName, coveragePct: Number(c.coveragePct), status: c.status, capXof: c.capXof })),
    readiness: { score: r.score, grade: r.grade, breakdown: r.breakdown, gates: r.gates.map((g) => ({ code: g.code, pass: g.pass })) },
  };
}

async function buildManifest(db: DbOrTx, blockId: string, seasonId: string) {
  const out: { fileId: string; label: string; category: string }[] = [];
  const docs = await db.select().from(landDocuments).where(and(eq(landDocuments.blockId, blockId), eq(landDocuments.status, 'verified')));
  for (const d of docs) out.push({ fileId: d.fileId, label: `${d.docType}${d.number ? ` ${d.number}` : ''}`, category: 'land' });
  const contracts = await db.select().from(offtakeContracts).where(and(eq(offtakeContracts.blockId, blockId), inArray(offtakeContracts.status, ['loi', 'signed'])));
  for (const c of contracts) if (c.fileId) out.push({ fileId: c.fileId, label: `Offtake ${c.ref}`, category: 'offtake' });
  const covers = await db.select().from(riskCovers).where(eq(riskCovers.blockId, blockId));
  for (const c of covers) if (c.fileId) out.push({ fileId: c.fileId, label: `${c.type} ${c.providerName}`, category: 'risk_cover' });
  const [block] = await db.select({ owner: blocks.ownerOrgId }).from(blocks).where(eq(blocks.id, blockId));
  const quotes = await db.select().from(supplierQuotes).where(and(eq(supplierQuotes.ownerOrgId, block!.owner), eq(supplierQuotes.private, false)));
  for (const q of quotes) if (q.fileId) out.push({ fileId: q.fileId, label: `Devis ${q.supplierName}`, category: 'quote' });
  void seasonId;
  return out;
}

// ---------------------------------------------------------------- risk covers

const coverDto = (c: typeof riskCovers.$inferSelect) => ({ id: c.id, blockId: c.blockId, trancheId: c.trancheId, type: c.type, providerOrgId: c.providerOrgId, providerName: c.providerName, coveragePct: Number(c.coveragePct), capXof: c.capXof, premiumXof: c.premiumXof, status: c.status, fileId: c.fileId, version: c.version });

export async function listCovers(db: DbOrTx, actor: ActorContext, blockId: string) {
  await loadBlock(db, actor, blockId);
  return (await db.select().from(riskCovers).where(eq(riskCovers.blockId, blockId)).orderBy(desc(riskCovers.id))).map(coverDto);
}

/** Committed/active covers with a provider org: read grants on the block and the covered facilities (SPEC §12.6). */
async function grantCoverProvider(tx: DbOrTx, c: typeof riskCovers.$inferSelect) {
  if (!c.providerOrgId || !['committed', 'active'].includes(c.status)) return;
  await grant(tx, { resourceType: 'block', resourceId: c.blockId, granteeOrgId: c.providerOrgId, scope: 'read', grantedByEvent: 'risk_cover.committed', expiresAt: null });
  const facs = await tx.select({ id: facilities.id, trancheId: facilities.trancheId }).from(facilities).where(eq(facilities.blockId, c.blockId));
  for (const f of facs) if (!c.trancheId || c.trancheId === f.trancheId) await grant(tx, { resourceType: 'facility', resourceId: f.id, granteeOrgId: c.providerOrgId, scope: 'read', grantedByEvent: 'risk_cover.committed', expiresAt: null });
}

export async function createCover(db: Db, actor: ActorContext, blockId: string, body: { type: typeof riskCovers.$inferInsert.type; providerOrgId?: string | null; providerName: string; coveragePct: number; capXof?: number | null; premiumXof?: number | null; status: typeof riskCovers.$inferInsert.status; fileId?: string | null; trancheId?: string | null }) {
  return db.transaction(async (tx) => {
    const b = await loadBlock(tx, actor, blockId, true);
    if (body.fileId) await linkFile(tx, actor, body.fileId, 'block', blockId);
    const [c] = await tx.insert(riskCovers).values({ ...body, coveragePct: String(body.coveragePct), blockId, ownerOrgId: b.ownerOrgId, createdBy: actorUserId(actor) }).returning();
    await audit(tx, actor, { action: 'risk_cover.created', resourceType: 'risk_cover', resourceId: c!.id, after: body });
    await grantCoverProvider(tx, c!);
    return coverDto(c!);
  });
}

export async function updateCover(db: Db, actor: ActorContext, id: string, expected: number, body: Partial<Parameters<typeof createCover>[3]>) {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(riskCovers).where(eq(riskCovers.id, id));
    if (!c) throw notFound('Risk cover');
    await loadBlock(tx, actor, c.blockId, true).catch(() => {
      throw notFound('Risk cover');
    });
    assertVersion(expected, c.version);
    if (body.fileId) await linkFile(tx, actor, body.fileId, 'block', c.blockId);
    const [after] = await tx.update(riskCovers).set({ ...body, coveragePct: body.coveragePct === undefined ? undefined : String(body.coveragePct), version: c.version + 1 }).where(eq(riskCovers.id, id)).returning();
    await audit(tx, actor, { action: 'risk_cover.updated', resourceType: 'risk_cover', resourceId: id, before: coverDto(c), after: body });
    await grantCoverProvider(tx, after!);
    return coverDto(after!);
  });
}
