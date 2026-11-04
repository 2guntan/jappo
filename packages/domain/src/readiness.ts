import { dec, roundXof, type Dec } from './money';

export const READINESS_ENGINE_VERSION = 'readiness-1.0.0';

export interface ReadinessInput {
  block: { hasBoundary: boolean; areaHa: number; activePlotAreaHa: number; plotCount: number };
  landDocs: { id: string; docType: string; status: string; expiryDate: string | null }[];
  /** ISO date used for expiry checks. */
  today: string;
  /** Remaining tenor of the requested financing (months), for bail duration scoring. */
  remainingTenorMonths: number;
  plantings: { plantingId: string; plotId: string; hasYields: boolean; hasPrices: boolean }[];
  plotsWithPlanting: { plotId: string; hasActiveAllocation: boolean }[];
  farmers: { farmerId: string; kycVerified: boolean; consentData: boolean; consentCreditBureau: boolean; walletVerified: boolean; hasPhoto: boolean; inArrears: boolean }[];
  seasonalBorrowerIsFarmers: boolean;
  offtake: {
    cropId: string;
    deliverableKgBase: number;
    contracts: { id: string; status: string; minVolumeKg: number; paysIntoEscrow: boolean; priceType: string; hasFloor: boolean; buyerKycVerified: boolean }[];
  }[];
  model: { current: boolean; hcrBase: number | null; hcrCombined: number | null; minDscr: number | null; hasSeasonalTranche: boolean; hasInvestmentTranche: boolean };
  operatorKycVerified: boolean;
  riskCovers: { id: string; type: 'guarantee' | 'index_insurance' | 'indemnity_insurance' | 'first_loss'; status: string; coveragePct: number }[];
  firstLossPctOfTranche: number;
  operator: { priorSettledSeasons: number; haPerStaff: number | null; equityShareOfCapexPct: number };
  completeness: { allPlotsSoilType: boolean; allFarmersPhoto: boolean; visitsOk: boolean; quotedShareOfSeasonalBudgetPct: number };
  /** Configurable thresholds (settings); defaults per SPEC §9.2.1. */
  thresholds?: { offtakeCoveragePct?: number; hcrBaseMin?: number; hcrCombinedMin?: number; plotAreaTolerance?: number };
}

export type GateCode = 'G1_BOUNDARY' | 'G2_LAND_TITLE' | 'G3_COMMUNITY' | 'G4_FARMERS' | 'G5_PLAN' | 'G6_OFFTAKE' | 'G7_MODEL' | 'G8_HCR' | 'G9_OPERATOR_KYC' | 'G10_ESCROW';

export interface GateResult {
  code: GateCode;
  pass: boolean;
  reasons: { code: string; entityIds: string[] }[];
}

export interface Readiness {
  engineVersion: string;
  gates: GateResult[];
  allGatesPass: boolean;
  breakdown: { landSecurity: number; offtakeStrength: number; financialRobustness: number; farmerQuality: number; riskCover: number; operatorCapacity: number; dataCompleteness: number };
  rawScore: number;
  score: number;
  grade: 'A' | 'B' | 'C' | 'D';
}

const ACTIVE_COVER = ['committed', 'active'];

function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Readiness gates and score (SPEC §9.2). Pure and deterministic. */
export function computeReadiness(input: ReadinessInput): Readiness {
  const th = { offtakeCoveragePct: 60, hcrBaseMin: 1.3, hcrCombinedMin: 1.0, plotAreaTolerance: 1.02, ...input.thresholds };
  const valid = (d: ReadinessInput['landDocs'][number]) => d.status === 'verified' && (!d.expiryDate || d.expiryDate >= input.today);
  const docs = (type: string) => input.landDocs.filter((d) => d.docType === type && valid(d));
  const gates: GateResult[] = [];
  const gate = (code: GateCode, reasons: GateResult['reasons']) => gates.push({ code, pass: reasons.length === 0, reasons });

  // G1 boundary and plots
  const g1: GateResult['reasons'] = [];
  if (!input.block.hasBoundary) g1.push({ code: 'BOUNDARY_MISSING', entityIds: [] });
  if (input.block.plotCount < 1) g1.push({ code: 'NO_PLOTS', entityIds: [] });
  if (input.block.activePlotAreaHa > input.block.areaHa * th.plotAreaTolerance) g1.push({ code: 'PLOT_AREA_EXCEEDS_BLOCK', entityIds: [] });
  gate('G1_BOUNDARY', g1);

  // G2 land title
  const title = docs('title_foncier');
  const bail = docs('bail');
  const delibOk = docs('deliberation').length > 0 && docs('approval_prefect').length > 0;
  gate('G2_LAND_TITLE', title.length || bail.length || delibOk ? [] : [{ code: 'LAND_TITLE_MISSING', entityIds: input.landDocs.filter((d) => !valid(d)).map((d) => d.id) }]);

  // G3 community agreement (waived if G2 satisfied by title foncier)
  gate('G3_COMMUNITY', title.length || docs('community_agreement').length ? [] : [{ code: 'COMMUNITY_AGREEMENT_MISSING', entityIds: [] }]);

  // G4 farmers
  const g4: GateResult['reasons'] = [];
  const unallocated = input.plotsWithPlanting.filter((p) => !p.hasActiveAllocation).map((p) => p.plotId);
  if (unallocated.length) g4.push({ code: 'PLOT_WITHOUT_ALLOCATION', entityIds: unallocated });
  const noKyc = input.farmers.filter((f) => !f.kycVerified).map((f) => f.farmerId);
  if (noKyc.length) g4.push({ code: 'FARMER_KYC_NOT_VERIFIED', entityIds: noKyc });
  const noConsent = input.farmers.filter((f) => !f.consentData).map((f) => f.farmerId);
  if (noConsent.length) g4.push({ code: 'FARMER_CONSENT_MISSING', entityIds: noConsent });
  if (input.seasonalBorrowerIsFarmers) {
    const noBureau = input.farmers.filter((f) => !f.consentCreditBureau).map((f) => f.farmerId);
    if (noBureau.length) g4.push({ code: 'FARMER_CREDIT_BUREAU_CONSENT_MISSING', entityIds: noBureau });
  }
  gate('G4_FARMERS', g4);

  // G5 plan
  const g5: GateResult['reasons'] = [];
  if (!input.plantings.length) g5.push({ code: 'NO_PLANTINGS', entityIds: [] });
  const noYield = input.plantings.filter((p) => !p.hasYields).map((p) => p.plantingId);
  const noPrice = input.plantings.filter((p) => !p.hasPrices).map((p) => p.plantingId);
  if (noYield.length) g5.push({ code: 'PLANTING_YIELD_MISSING', entityIds: noYield });
  if (noPrice.length) g5.push({ code: 'PLANTING_PRICE_MISSING', entityIds: noPrice });
  gate('G5_PLAN', g5);

  // G6 offtake coverage ≥ 60 % per crop (loi|signed, min volume counted); G10 same with escrow only
  const coverage = (c: ReadinessInput['offtake'][number], filter: (k: ReadinessInput['offtake'][number]['contracts'][number]) => boolean) =>
    c.deliverableKgBase > 0 ? dec(c.contracts.filter((k) => ['loi', 'signed'].includes(k.status) && filter(k)).reduce((s, k) => s + k.minVolumeKg, 0)).div(c.deliverableKgBase) : dec(0);
  const short6 = input.offtake.filter((c) => coverage(c, () => true).times(100).lt(th.offtakeCoveragePct)).map((c) => c.cropId);
  gate('G6_OFFTAKE', short6.length || !input.offtake.length ? [{ code: 'OFFTAKE_COVERAGE_LOW', entityIds: short6 }] : []);

  // G7 current model
  gate('G7_MODEL', input.model.current ? [] : [{ code: 'MODEL_NOT_CURRENT', entityIds: [] }]);

  // G8 HCR thresholds if a seasonal tranche is requested
  const g8: GateResult['reasons'] = [];
  if (input.model.hasSeasonalTranche) {
    if (input.model.hcrBase === null || input.model.hcrBase < th.hcrBaseMin) g8.push({ code: 'HCR_BASE_BELOW_MIN', entityIds: [] });
    if (input.model.hcrCombined === null || input.model.hcrCombined < th.hcrCombinedMin) g8.push({ code: 'HCR_COMBINED_BELOW_MIN', entityIds: [] });
  }
  gate('G8_HCR', g8);

  gate('G9_OPERATOR_KYC', input.operatorKycVerified ? [] : [{ code: 'OPERATOR_KYC_NOT_VERIFIED', entityIds: [] }]);

  const short10 = input.offtake.filter((c) => coverage(c, (k) => k.paysIntoEscrow).times(100).lt(th.offtakeCoveragePct)).map((c) => c.cropId);
  gate('G10_ESCROW', short10.length || !input.offtake.length ? [{ code: 'ESCROW_COVERAGE_LOW', entityIds: short10 }] : []);

  // ---------------------------------------------------------------- score (§9.2.2)
  // Land security (20)
  let land = 0;
  if (title.length) land = 20;
  else if (bail.length) {
    const needed = addMonths(input.today, input.remainingTenorMonths + 12);
    land = bail.some((b) => !b.expiryDate || b.expiryDate >= needed) ? 18 : 12;
  } else if (delibOk && docs('community_agreement').length) land = 15;

  // Offtake strength (20): signed coverage × 12 + pricing 4 + buyer KYC 4
  const totalDeliverable = input.offtake.reduce((s, c) => s + c.deliverableKgBase, 0);
  const signedCovered = input.offtake.reduce((s, c) => s.plus(Math.min(c.deliverableKgBase, c.contracts.filter((k) => k.status === 'signed').reduce((a, k) => a + k.minVolumeKg, 0))), dec(0));
  const signedCoverage: Dec = totalDeliverable > 0 ? signedCovered.div(totalDeliverable) : dec(0);
  const signed = input.offtake.flatMap((c) => c.contracts.filter((k) => k.status === 'signed'));
  const pricingOk = signed.length > 0 && signed.every((k) => k.priceType === 'fixed' || (k.priceType === 'floor_plus_market' && k.hasFloor));
  const buyersOk = signed.length > 0 && signed.every((k) => k.buyerKycVerified);
  const offtake = Decimal2(dec(Math.min(1, signedCoverage.toNumber())).times(12).plus(pricingOk ? 4 : 0).plus(buyersOk ? 4 : 0));

  // Financial robustness (20)
  const band = (x: number | null, bands: [number, number][]) => (x === null ? 0 : (bands.find(([min]) => x >= min)?.[1] ?? 0));
  const fin =
    band(input.model.hcrBase, [[1.8, 8], [1.5, 6], [1.3, 3]]) +
    band(input.model.hcrCombined, [[1.3, 6], [1.1, 4], [1.0, 2]]) +
    (input.model.hasInvestmentTranche ? band(input.model.minDscr, [[1.5, 6], [1.25, 4], [1.1, 2]]) : 6);

  // Farmer quality (10)
  const n = input.farmers.length;
  const share = (p: (f: ReadinessInput['farmers'][number]) => boolean) => (n ? dec(input.farmers.filter(p).length).div(n) : dec(0));
  const farmer = Decimal2(share((f) => f.walletVerified).times(4).plus(share((f) => f.consentCreditBureau).times(3)).plus(dec(3).times(dec(1).minus(share((f) => f.inArrears)))));

  // Risk cover (15)
  const guarantee = input.riskCovers.filter((r) => r.type === 'guarantee' && ACTIVE_COVER.includes(r.status));
  const gPct = guarantee.length ? Math.max(...guarantee.map((g) => g.coveragePct)) : 0;
  const insured = input.riskCovers.some((r) => (r.type === 'index_insurance' || r.type === 'indemnity_insurance') && ACTIVE_COVER.includes(r.status));
  const risk = Decimal2(dec(Math.min(gPct, 80)).div(80).times(8).plus(insured ? 4 : 0).plus(input.firstLossPctOfTranche >= 5 ? 3 : 0));

  // Operator capacity (10)
  const prior = input.operator.priorSettledSeasons >= 2 ? 5 : input.operator.priorSettledSeasons === 1 ? 3 : 0;
  const staff = input.operator.haPerStaff !== null && input.operator.haPerStaff <= 50 ? 3 : 0;
  const equity = input.operator.equityShareOfCapexPct >= 10 ? 2 : 0;
  const ops = prior + staff + equity;

  // Data completeness (5)
  const c = input.completeness;
  const data = (c.allPlotsSoilType ? 1 : 0) + (c.allFarmersPhoto ? 1 : 0) + (c.visitsOk ? 1 : 0) + (c.quotedShareOfSeasonalBudgetPct >= 80 ? 2 : 0);

  const breakdown = { landSecurity: land, offtakeStrength: offtake, financialRobustness: fin, farmerQuality: farmer, riskCover: risk, operatorCapacity: ops, dataCompleteness: data };
  const raw = Object.values(breakdown).reduce((s, v) => s.plus(v), dec(0));
  const score = roundXof(raw); // Σ components rounded to integer (half-even)
  const grade = score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : 'D';
  return { engineVersion: READINESS_ENGINE_VERSION, gates, allGatesPass: gates.every((g) => g.pass), breakdown, rawScore: raw.toNumber(), score, grade };
}

/** Score components are reported with 2 decimals. */
function Decimal2(v: Dec): number {
  return v.toDecimalPlaces(2).toNumber();
}
