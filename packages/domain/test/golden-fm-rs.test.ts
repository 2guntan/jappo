/**
 * Golden tests (SPEC §9.1.7, §9.1.8, §9.2.2). These numbers are contracts: never change them.
 */
import { describe, expect, it } from 'vitest';
import { buildSchedule, computeBlockModel, computeReadiness, type ModelInput, type ReadinessInput } from '../src';

const FM1: ModelInput = {
  plots: [{ plotId: 'P1', code: 'P-001', areaHa: 1 }],
  allocations: [{ plotId: 'P1', farmerId: 'F1', farmerCode: 'F-000001', sharePct: 100 }],
  farmers: [{ farmerId: 'F1', farmerCode: 'F-000001', baselineIncomeXof: 150000 }],
  plantings: [
    { plantingId: 'PL1', plotId: 'P1', cropId: 'maize', areaHa: 1, yieldBaseTHa: 4.0, yieldStressTHa: 3.2, postHarvestLossPct: 5, deliveryRatePct: 95, priceXofPerKgBase: 250, priceXofPerKgStress: 212, harvestMonth: 5 },
  ],
  budgetLines: [{ lineId: 'L1', scope: 'plot', plotId: 'P1', qty: 1, unitPriceXof: 450000, payer: 'farmer_credit' }],
  feePolicy: { operatorServiceFeeXofPerFarmerSeason: 50000, landFeeXofPerHaSeason: 0, investmentRecoveryFeeXofPerHaSeason: 100000 },
  capexItems: [],
  opex: [],
  tranches: { seasonal: { rateBps: 1800, rateMethod: 'flat', upfrontFeeBps: 0, tenorMonths: 6, repaymentProfile: 'bullet', feesChargedTo: 'operator' } },
  seasonsPerYear: 1,
  discountRateBps: 1200,
};

describe('FM-1 single farmer, one planting (SPEC §9.1.7)', () => {
  const out = computeBlockModel(FM1);
  const base = out.scenarios.base;
  const f = base.farmers[0]!;

  it('base scenario', () => {
    expect(out.details.base.plantings[0]!.deliverableKg).toBe(3610);
    expect(f.grossRevenueXof).toBe(902500);
    expect(out.details.base.farmers[0]!.seasonalInterestXof).toBe(40500);
    expect(f.seasonalDebtDueXof).toBe(490500);
    expect(f.investmentFeeXof).toBe(100000);
    expect(f.operatorServiceFeeXof).toBe(50000);
    expect(f.landFeeXof).toBe(0);
    expect(f.farmerCashCostsXof).toBe(0);
    expect(f.netIncomeXof).toBe(262000);
    expect(f.valueCreatedXof).toBe(112000);
    expect(f.hcr).toBe(1.84);
    expect(base.block.hcr).toBe(1.84);
    expect(base.block.breakevenYieldMultiplier).toBe(0.54);
    expect(base.block.breakevenPriceMultiplier).toBe(0.54);
    expect(out.breakevenYieldByCrop).toEqual([{ cropId: 'maize', yieldTHa: 2.17 }]);
    expect(base.block.minDscr).toBeNull();
  });

  it('yield_minus_20 scenario uses the stress yield', () => {
    const s = out.scenarios.yield_minus_20;
    expect(out.details.yield_minus_20.plantings[0]!.deliverableKg).toBe(2888);
    expect(s.farmers[0]!.grossRevenueXof).toBe(722000);
    expect(s.farmers[0]!.hcr).toBe(1.47);
    expect(s.farmers[0]!.netIncomeXof).toBe(81500);
  });

  it('computes all stress scenarios deterministically', () => {
    expect(Object.keys(out.scenarios).sort()).toEqual(['base', 'combined', 'delay_2m', 'price_minus_15', 'yield_minus_20']);
    expect(computeBlockModel(FM1)).toEqual(out);
    expect(out.inputsHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('FM-2 annuity schedule (SPEC §9.1.8)', () => {
  const lines = buildSchedule({ principalXof: 10_000_000, rateBps: 1200, rateMethod: 'declining', tenorMonths: 36, graceMonths: 0, graceType: 'interest_only', repaymentProfile: 'annuity', upfrontFeeBps: 0 });
  it('has 36 equal instalments of 332 143 with the last absorbing rounding', () => {
    expect(lines).toHaveLength(36);
    for (const l of lines.slice(0, 35)) expect(l.totalXof).toBe(332143);
    expect(lines.reduce((s, l) => s + l.principalXof, 0)).toBe(10_000_000);
    const totalInterest = lines.reduce((s, l) => s + l.interestXof, 0);
    expect(totalInterest).toBe(lines.reduce((s, l) => s + l.totalXof, 0) - 10_000_000);
    for (const l of lines) expect(l.totalXof).toBe(l.principalXof + l.interestXof + l.feesXof);
  });
});

const RS1: ReadinessInput = {
  block: { hasBoundary: true, areaHa: 10, activePlotAreaHa: 10, plotCount: 20 },
  landDocs: [{ id: 'D1', docType: 'title_foncier', status: 'verified', expiryDate: null }],
  today: '2026-11-05',
  remainingTenorMonths: 6,
  plantings: [{ plantingId: 'PL1', plotId: 'P1', hasYields: true, hasPrices: true }],
  plotsWithPlanting: [{ plotId: 'P1', hasActiveAllocation: true }],
  farmers: [{ farmerId: 'F1', kycVerified: true, consentData: true, consentCreditBureau: true, walletVerified: true, hasPhoto: true, inArrears: false }],
  seasonalBorrowerIsFarmers: true,
  offtake: [{ cropId: 'maize', deliverableKgBase: 100000, contracts: [{ id: 'O1', status: 'signed', minVolumeKg: 70000, paysIntoEscrow: true, priceType: 'fixed', hasFloor: false, buyerKycVerified: true }] }],
  model: { current: true, hcrBase: 1.84, hcrCombined: 1.18, minDscr: null, hasSeasonalTranche: true, hasInvestmentTranche: false },
  operatorKycVerified: true,
  riskCovers: [{ id: 'R1', type: 'guarantee', status: 'committed', coveragePct: 80 }],
  firstLossPctOfTranche: 0,
  operator: { priorSettledSeasons: 0, haPerStaff: 25, equityShareOfCapexPct: 0 },
  completeness: { allPlotsSoilType: true, allFarmersPhoto: true, visitsOk: true, quotedShareOfSeasonalBudgetPct: 100 },
};

describe('RS-1 readiness score (SPEC §9.2.2)', () => {
  const r = computeReadiness(RS1);
  it('scores 80.4 → 80, grade A, all gates pass', () => {
    expect(r.breakdown).toEqual({ landSecurity: 20, offtakeStrength: 16.4, financialRobustness: 18, farmerQuality: 10, riskCover: 8, operatorCapacity: 3, dataCompleteness: 5 });
    expect(r.rawScore).toBeCloseTo(80.4, 10);
    expect(r.score).toBe(80);
    expect(r.grade).toBe('A');
    expect(r.gates.every((g) => g.pass)).toBe(true);
    expect(r.allGatesPass).toBe(true);
  });
});
