import { describe, expect, it } from 'vitest';
import { computeSettlement, type SettlementInput } from '../src';

/** SPEC §9.6.3 / §9.6.4 — golden tests are contracts: numbers must not be changed. */
const farmer = (code: string, kg: number, principal: number, interest: number) => ({
  farmerId: code,
  farmerCode: code,
  deliveries: [{ netKg: kg, priceXofPerKg: 250, adjustmentPct: 0 }],
  seasonalDue: [{ facilityId: 'FAC-SEASONAL', amountXof: principal + interest }],
  investmentFeeXof: 100_000,
  landFeeXof: 0,
  operatorServiceFeeXof: 50_000,
  otherDeductionsXof: 0,
});

const base: SettlementInput = {
  receiptsTotalXof: 5_750_000,
  farmers: [farmer('F1', 12_000, 1_200_000, 108_000), farmer('F2', 8_000, 1_000_000, 90_000), farmer('F3', 3_000, 800_000, 72_000)],
  seasonalFacilities: [{ facilityId: 'FAC-SEASONAL', dueXof: 3_270_000 }],
  operatorInvestmentDueXof: 200_000,
  solidarity: { mode: 'none', capPct: 20 },
};

const line = (out: ReturnType<typeof computeSettlement>, id: string) => out.lines.find((l) => l.farmerId === id)!;

describe('golden WF-1 (no solidarity)', () => {
  const out = computeSettlement(base);
  it('gross credit per farmer', () => {
    expect(out.lines.map((l) => l.grossCreditXof)).toEqual([3_000_000, 2_000_000, 750_000]);
  });
  it('farmer lines', () => {
    expect(line(out, 'F1')).toMatchObject({ seasonalPaidXof: 1_308_000, investmentFeePaidXof: 100_000, operatorFeesPaidXof: 50_000, payoutXof: 1_542_000, arrears: { seasonalDebtXof: 0, investmentFeeXof: 0, operatorFeesXof: 0 } });
    expect(line(out, 'F2')).toMatchObject({ seasonalPaidXof: 1_090_000, investmentFeePaidXof: 100_000, operatorFeesPaidXof: 50_000, payoutXof: 760_000, arrears: { seasonalDebtXof: 0, investmentFeeXof: 0, operatorFeesXof: 0 } });
    expect(line(out, 'F3')).toMatchObject({ seasonalPaidXof: 750_000, investmentFeePaidXof: 0, operatorFeesPaidXof: 0, payoutXof: 0, arrears: { seasonalDebtXof: 122_000, investmentFeeXof: 100_000, operatorFeesXof: 50_000 } });
  });
  it('block distribution and invariant', () => {
    expect(out.distribution.seasonalByFacility).toEqual([{ facilityId: 'FAC-SEASONAL', amountXof: 3_148_000 }]);
    expect(out.distribution.investmentToLenderXof).toBe(200_000);
    expect(out.distribution.operatorXof).toBe(100_000);
    expect(out.distribution.farmersTotalXof).toBe(2_302_000);
    expect(3_148_000 + 200_000 + 100_000 + 2_302_000).toBe(5_750_000);
    expect(out.invariants.sumEqualsReceipts).toBe(true);
  });
});

describe('golden WF-2 (solidarity group, cap 20 %)', () => {
  const out = computeSettlement({ ...base, solidarity: { mode: 'group', capPct: 20 } });
  it('contributions F1 81 722 / F2 40 278 and payouts', () => {
    expect(line(out, 'F1')).toMatchObject({ solidarityContributionXof: 81_722, payoutXof: 1_460_278 });
    expect(line(out, 'F2')).toMatchObject({ solidarityContributionXof: 40_278, payoutXof: 719_722 });
    expect(line(out, 'F3')).toMatchObject({ solidarityReceivedXof: 122_000, payoutXof: 0, arrears: { seasonalDebtXof: 0, investmentFeeXof: 100_000, operatorFeesXof: 50_000 } });
  });
  it('block distribution and invariant', () => {
    expect(out.distribution.seasonalByFacility).toEqual([{ facilityId: 'FAC-SEASONAL', amountXof: 3_270_000 }]);
    expect(out.distribution.investmentToLenderXof).toBe(200_000);
    expect(out.distribution.operatorXof).toBe(100_000);
    expect(out.distribution.farmersTotalXof).toBe(2_180_000);
    expect(out.invariants.sumEqualsReceipts).toBe(true);
  });
});
