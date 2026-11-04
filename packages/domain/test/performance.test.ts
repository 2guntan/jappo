import { describe, expect, it } from 'vitest';
import { computeBlockModel, computeSettlement, type ModelInput, type SettlementInput } from '../src';

/** SPEC §18.3: model run < 2 s for 500 farmers / 500 plots; settlement < 3 s for 2 000 farmers. */
describe('performance budgets', () => {
  it('runs the model for 500 farmers / 500 plots under 2 s', () => {
    const n = 500;
    const id = (i: number) => String(i).padStart(4, '0');
    const input: ModelInput = {
      plots: Array.from({ length: n }, (_, i) => ({ plotId: `P${id(i)}`, code: `P-${id(i)}`, areaHa: 1 })),
      allocations: Array.from({ length: n }, (_, i) => ({ plotId: `P${id(i)}`, farmerId: `F${id(i)}`, farmerCode: `F-${id(i)}`, sharePct: 100 })),
      farmers: Array.from({ length: n }, (_, i) => ({ farmerId: `F${id(i)}`, farmerCode: `F-${id(i)}`, baselineIncomeXof: 150000 })),
      plantings: Array.from({ length: n }, (_, i) => ({ plantingId: `PL${id(i)}`, plotId: `P${id(i)}`, cropId: 'maize', areaHa: 1, yieldBaseTHa: 4, yieldStressTHa: 3.2, postHarvestLossPct: 5, deliveryRatePct: 95, priceXofPerKgBase: 250, priceXofPerKgStress: 212, harvestMonth: 5 })),
      budgetLines: Array.from({ length: n }, (_, i) => ({ lineId: `L${id(i)}`, scope: 'plot' as const, plotId: `P${id(i)}`, qty: 1, unitPriceXof: 450000, payer: 'farmer_credit' as const })),
      feePolicy: { operatorServiceFeeXofPerFarmerSeason: 50000, landFeeXofPerHaSeason: 0, investmentRecoveryFeeXofPerHaSeason: 100000 },
      capexItems: [],
      opex: [],
      tranches: { seasonal: { rateBps: 1800, rateMethod: 'flat', upfrontFeeBps: 0, tenorMonths: 6, repaymentProfile: 'bullet', feesChargedTo: 'operator' } },
      seasonsPerYear: 1,
      discountRateBps: 1200,
    };
    const t0 = performance.now();
    const out = computeBlockModel(input);
    const ms = performance.now() - t0;
    expect(out.scenarios.base.farmers).toHaveLength(n);
    expect(ms).toBeLessThan(2000);
  });

  it('settles 2 000 farmers under 3 s with the invariant', () => {
    const n = 2000;
    const farmers: SettlementInput['farmers'] = Array.from({ length: n }, (_, i) => ({
      farmerId: `F${i}`,
      farmerCode: `F-${String(i).padStart(5, '0')}`,
      deliveries: [{ netKg: 1000 + (i % 37) * 100, priceXofPerKg: 250, adjustmentPct: i % 5 === 0 ? -10 : 0 }],
      seasonalDue: [{ facilityId: i % 2 ? 'S1' : 'S2', amountXof: 300_000 + (i % 11) * 10_000 }],
      investmentFeeXof: 100_000,
      landFeeXof: 0,
      operatorServiceFeeXof: 50_000,
      otherDeductionsXof: 0,
    }));
    const due = (k: string) => farmers.filter((f) => f.seasonalDue[0]!.facilityId === k).reduce((s, f) => s + f.seasonalDue[0]!.amountXof, 0);
    const t0 = performance.now();
    const out = computeSettlement({ receiptsTotalXof: 900_000_000, farmers, seasonalFacilities: [{ facilityId: 'S1', dueXof: due('S1') }, { facilityId: 'S2', dueXof: due('S2') }], operatorInvestmentDueXof: 50_000_000, solidarity: { mode: 'group', capPct: 20 } });
    const ms = performance.now() - t0;
    expect(out.invariants.sumEqualsReceipts).toBe(true);
    expect(ms).toBeLessThan(3000);
  });
});
