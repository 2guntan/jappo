import { describe, expect, it } from 'vitest';
import { annualise, buildSchedule, computeBlockModel, computeReadiness, irrMonthly, scheduleTotals, sha256Hex, type ModelInput, type ReadinessInput } from '../src';

describe('sha256', () => {
  it('matches known vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('é'.repeat(100))).toHaveLength(64);
  });
});

describe('irr', () => {
  it('solves BE-1 style flows and handles no sign change', () => {
    const flows = [-990000, 0, 0, 0, 0, 0, 1090000];
    const r = irrMonthly(flows)!;
    expect(annualise(r).times(10000).toDecimalPlaces(0).toNumber()).toBe(2122);
    expect(irrMonthly([1, 2, 3])).toBeNull();
    expect(irrMonthly([-100, -1])).toBeNull();
  });
});

describe('buildSchedule profiles', () => {
  const P = 1_200_000;
  it('bullet flat and declining', () => {
    expect(buildSchedule({ principalXof: 1_000_000, rateBps: 1800, rateMethod: 'flat', tenorMonths: 6, repaymentProfile: 'bullet' })).toEqual([{ seq: 1, month: 6, principalXof: 1_000_000, interestXof: 90000, feesXof: 0, totalXof: 1_090_000 }]);
    expect(buildSchedule({ principalXof: 0, rateBps: 1800, rateMethod: 'flat', tenorMonths: 6, repaymentProfile: 'bullet' })).toEqual([]);
  });
  it('equal principal declining with interest-only grace', () => {
    const l = buildSchedule({ principalXof: P, rateBps: 1200, rateMethod: 'declining', tenorMonths: 12, graceMonths: 2, graceType: 'interest_only', repaymentProfile: 'equal_principal' });
    expect(l).toHaveLength(12);
    expect(l[0]).toMatchObject({ principalXof: 0, interestXof: 12000 });
    expect(l[2]).toMatchObject({ principalXof: 120000, interestXof: 12000 });
    expect(l[11]!.interestXof).toBe(1200);
    expect(scheduleTotals(l).principalXof).toBe(P);
  });
  it('annuity flat and capitalised grace', () => {
    const flat = buildSchedule({ principalXof: P, rateBps: 1200, rateMethod: 'flat', tenorMonths: 12, repaymentProfile: 'annuity' });
    expect(new Set(flat.slice(0, 11).map((x) => x.totalXof)).size).toBe(1);
    expect(scheduleTotals(flat)).toMatchObject({ principalXof: P, interestXof: 144000 });
    const cap = buildSchedule({ principalXof: P, rateBps: 1200, rateMethod: 'declining', tenorMonths: 12, graceMonths: 3, graceType: 'capitalised', repaymentProfile: 'annuity' });
    expect(cap).toHaveLength(9);
    expect(cap[0]!.month).toBe(4);
    expect(scheduleTotals(cap).principalXof).toBe(1_236_361);
    const zero = buildSchedule({ principalXof: 900, rateBps: 0, rateMethod: 'declining', tenorMonths: 3, repaymentProfile: 'annuity' });
    expect(zero.map((x) => x.totalXof)).toEqual([300, 300, 300]);
    const flatEp = buildSchedule({ principalXof: P, rateBps: 1200, rateMethod: 'flat', tenorMonths: 12, repaymentProfile: 'equal_principal' });
    expect(flatEp.every((x) => x.interestXof === 12000)).toBe(true);
  });
  it('seasonal at harvest months', () => {
    const s = buildSchedule({ principalXof: P, rateBps: 1200, rateMethod: 'declining', tenorMonths: 24, repaymentProfile: 'seasonal', harvestMonths: [6, 18, 30] });
    expect(s.map((x) => x.month)).toEqual([6, 18]);
    expect(s[0]).toMatchObject({ principalXof: 600000, interestXof: 72000 });
    expect(s[1]).toMatchObject({ principalXof: 600000, interestXof: 72000 });
    const flat = buildSchedule({ principalXof: P, rateBps: 1200, rateMethod: 'flat', tenorMonths: 12, repaymentProfile: 'seasonal' });
    expect(flat).toEqual([expect.objectContaining({ month: 12, interestXof: 144000 })]);
  });
});

const multi: ModelInput = {
  plots: [{ plotId: 'A', code: 'P-001', areaHa: 1 }, { plotId: 'B', code: 'P-002', areaHa: 1 }, { plotId: 'C', code: 'P-003', areaHa: 1 }],
  allocations: [{ plotId: 'A', farmerId: 'F1', farmerCode: 'F-1', sharePct: 100 }, { plotId: 'B', farmerId: 'F2', farmerCode: 'F-2', sharePct: 100 }],
  farmers: [{ farmerId: 'F1', farmerCode: 'F-1', baselineIncomeXof: null }, { farmerId: 'F2', farmerCode: 'F-2', baselineIncomeXof: 0 }],
  plantings: [
    { plantingId: 'X', plotId: 'A', cropId: 'maize', areaHa: 1, yieldBaseTHa: 4, yieldStressTHa: 3.2, postHarvestLossPct: 5, deliveryRatePct: 95, priceXofPerKgBase: 250, priceXofPerKgStress: 212, harvestMonth: 5 },
    { plantingId: 'Y', plotId: 'B', cropId: 'onion', areaHa: 1, yieldBaseTHa: 1, yieldStressTHa: 0.5, postHarvestLossPct: 15, deliveryRatePct: 95, priceXofPerKgBase: 100, priceXofPerKgStress: null, harvestMonth: 4 },
    { plantingId: 'Z', plotId: 'C', cropId: 'onion', areaHa: 1, yieldBaseTHa: null, yieldStressTHa: null, postHarvestLossPct: null, deliveryRatePct: null, priceXofPerKgBase: null, priceXofPerKgStress: null, harvestMonth: 4 },
  ],
  budgetLines: [{ lineId: 'L', scope: 'per_ha_all', qty: 1, unitPriceXof: 450000, payer: 'farmer_credit' }, { lineId: 'C', scope: 'per_ha_all', qty: 1, unitPriceXof: 10000, payer: 'farmer_cash' }],
  feePolicy: { operatorServiceFeeXofPerFarmerSeason: 50000, landFeeXofPerHaSeason: 10000, investmentRecoveryFeeXofPerHaSeason: 100000 },
  capexItems: [{ amountXof: 5_000_000, tranche: 'investment', month: 0 }, { amountXof: 500_000, tranche: 'equity', month: 1 }, { amountXof: 200_000, tranche: 'grant', month: 1 }],
  opex: [{ amountXofPerMonth: 5000, startMonth: 0, endMonth: null }],
  tranches: {
    seasonal: { rateBps: 1800, rateMethod: 'declining', upfrontFeeBps: 100, tenorMonths: 6, repaymentProfile: 'equal_principal', feesChargedTo: 'farmers' },
    investment: { rateBps: 1200, rateMethod: 'declining', upfrontFeeBps: 0, tenorMonths: 36, graceMonths: 0, graceType: 'interest_only', repaymentProfile: 'seasonal' },
  },
  seasonsPerYear: 2,
  discountRateBps: 1200,
};

describe('computeBlockModel (multi-crop, investment tranche)', () => {
  const out = computeBlockModel(multi);
  it('computes DSCR, NPV, cash flows and warnings', () => {
    expect(out.tranches).toEqual({ seasonalAmountXof: 900000, investmentAmountXof: 5_000_000 });
    expect(out.scenarios.base.monthlyCashflow).toHaveLength(60);
    expect(out.scenarios.base.monthlyCashflow[0]!.inflowXof).toBe(5_000_000);
    expect(out.details.base.dscrByYear.filter((d) => d.debtServiceXof > 0)).toHaveLength(3);
    expect(out.scenarios.base.block.minDscr).not.toBeNull();
    expect(out.scenarios.base.block.avgDscr).not.toBeNull();
    expect(typeof out.scenarios.base.block.operatorNpvXof).toBe('number');
    expect(out.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['MISSING_YIELD', 'MISSING_PRICE', 'PLOT_WITHOUT_ALLOCATION', 'NEGATIVE_FARMER_NET_INCOME', 'HCR_STRESS_BELOW_1']));
    const f2 = out.scenarios.base.farmers.find((f) => f.farmerId === 'F2')!;
    expect(f2.valueCreatedXof).toBe(f2.netIncomeXof);
    expect(out.details.base.farmers.find((f) => f.farmerId === 'F1')!.seasonalFeesXof).toBe(4500);
    expect(out.scenarios.delay_2m.farmers[0]!.seasonalDebtDueXof).toBeGreaterThan(out.scenarios.base.farmers[0]!.seasonalDebtDueXof);
    expect(out.breakevenYieldByCrop.map((b) => b.cropId)).toEqual(['maize', 'onion']);
  });
  it('handles no revenue and no tranches', () => {
    const none = computeBlockModel({ ...multi, plantings: [], tranches: {}, feePolicy: null, capexItems: [], opex: [] });
    expect(none.scenarios.base.block.hcr).toBeNull();
    expect(none.scenarios.base.block.breakevenYieldMultiplier).toBeNull();
    expect(none.scenarios.base.block.operatorIrr).toBeNull();
    expect(none.scenarios.base.block.paybackMonth).toBe(0);
    expect(none.breakevenYieldByCrop).toEqual([]);
  });
});

const ok: ReadinessInput = {
  block: { hasBoundary: true, areaHa: 10, activePlotAreaHa: 10, plotCount: 3 },
  landDocs: [],
  today: '2026-11-05',
  remainingTenorMonths: 12,
  plantings: [{ plantingId: 'PL', plotId: 'P', hasYields: true, hasPrices: true }],
  plotsWithPlanting: [{ plotId: 'P', hasActiveAllocation: true }],
  farmers: [{ farmerId: 'F', kycVerified: true, consentData: true, consentCreditBureau: false, walletVerified: false, hasPhoto: false, inArrears: true }],
  seasonalBorrowerIsFarmers: true,
  offtake: [{ cropId: 'maize', deliverableKgBase: 1000, contracts: [{ id: 'O', status: 'loi', minVolumeKg: 500, paysIntoEscrow: false, priceType: 'formula', hasFloor: false, buyerKycVerified: false }] }],
  model: { current: false, hcrBase: 1.2, hcrCombined: 0.9, minDscr: 1.3, hasSeasonalTranche: true, hasInvestmentTranche: true },
  operatorKycVerified: false,
  riskCovers: [{ id: 'R', type: 'index_insurance', status: 'active', coveragePct: 100 }],
  firstLossPctOfTranche: 5,
  operator: { priorSettledSeasons: 2, haPerStaff: 80, equityShareOfCapexPct: 15 },
  completeness: { allPlotsSoilType: false, allFarmersPhoto: false, visitsOk: false, quotedShareOfSeasonalBudgetPct: 10 },
};

describe('computeReadiness gates and bands', () => {
  it('reports failing gates with reason codes and entity ids', () => {
    const r = computeReadiness({ ...ok, block: { hasBoundary: false, areaHa: 1, activePlotAreaHa: 2, plotCount: 0 }, plotsWithPlanting: [{ plotId: 'P9', hasActiveAllocation: false }], farmers: [{ ...ok.farmers[0]!, kycVerified: false, consentData: false }], plantings: [{ plantingId: 'X', plotId: 'P', hasYields: false, hasPrices: false }] });
    const failing = Object.fromEntries(r.gates.filter((g) => !g.pass).map((g) => [g.code, g.reasons.map((x) => x.code)]));
    expect(failing.G1_BOUNDARY).toEqual(['BOUNDARY_MISSING', 'NO_PLOTS', 'PLOT_AREA_EXCEEDS_BLOCK']);
    expect(failing.G2_LAND_TITLE).toEqual(['LAND_TITLE_MISSING']);
    expect(failing.G3_COMMUNITY).toEqual(['COMMUNITY_AGREEMENT_MISSING']);
    expect(failing.G4_FARMERS).toEqual(['PLOT_WITHOUT_ALLOCATION', 'FARMER_KYC_NOT_VERIFIED', 'FARMER_CONSENT_MISSING', 'FARMER_CREDIT_BUREAU_CONSENT_MISSING']);
    expect(r.gates.find((g) => g.code === 'G4_FARMERS')!.reasons[0]!.entityIds).toEqual(['P9']);
    expect(failing.G5_PLAN).toEqual(['PLANTING_YIELD_MISSING', 'PLANTING_PRICE_MISSING']);
    expect(failing.G6_OFFTAKE).toEqual(['OFFTAKE_COVERAGE_LOW']);
    expect(failing.G7_MODEL).toEqual(['MODEL_NOT_CURRENT']);
    expect(failing.G8_HCR).toEqual(['HCR_BASE_BELOW_MIN', 'HCR_COMBINED_BELOW_MIN']);
    expect(failing.G9_OPERATOR_KYC).toEqual(['OPERATOR_KYC_NOT_VERIFIED']);
    expect(failing.G10_ESCROW).toEqual(['ESCROW_COVERAGE_LOW']);
    expect(r.allGatesPass).toBe(false);
    expect(computeReadiness({ ...ok, plantings: [] }).gates.find((g) => g.code === 'G5_PLAN')!.reasons[0]!.code).toBe('NO_PLANTINGS');
  });
  it('scores land tenure, financial and operator bands', () => {
    const doc = (docType: string, expiryDate: string | null = null) => ({ id: docType, docType, status: 'verified', expiryDate });
    expect(computeReadiness({ ...ok, landDocs: [doc('bail', '2040-01-01')] }).breakdown.landSecurity).toBe(18);
    expect(computeReadiness({ ...ok, landDocs: [doc('bail', '2027-01-01')] }).breakdown.landSecurity).toBe(12);
    expect(computeReadiness({ ...ok, landDocs: [doc('deliberation'), doc('approval_prefect'), doc('community_agreement')] }).breakdown.landSecurity).toBe(15);
    expect(computeReadiness({ ...ok, landDocs: [doc('title_foncier', '2020-01-01')] }).breakdown.landSecurity).toBe(0);
    const r = computeReadiness(ok);
    expect(r.breakdown).toEqual({ landSecurity: 0, offtakeStrength: 0, financialRobustness: 4, farmerQuality: 0, riskCover: 7, operatorCapacity: 7, dataCompleteness: 0 });
    expect(r.score).toBe(18);
    expect(r.grade).toBe('D');
    expect(computeReadiness({ ...ok, model: { ...ok.model, hcrBase: 1.6, hcrCombined: 1.15, minDscr: 1.6 } }).breakdown.financialRobustness).toBe(16);
    expect(computeReadiness({ ...ok, operator: { priorSettledSeasons: 1, haPerStaff: null, equityShareOfCapexPct: 0 } }).breakdown.operatorCapacity).toBe(3);
    expect(computeReadiness({ ...ok, farmers: [] }).breakdown.farmerQuality).toBe(3);
  });
});

