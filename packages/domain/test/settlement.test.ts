import { describe, expect, it } from 'vitest';
import { computeSettlement, type SettlementInput } from '../src';

const f = (code: string, kg: number, due: { facilityId: string; amountXof: number }[], fees = { inv: 0, land: 0, op: 0 }) => ({
  farmerId: code, farmerCode: code, deliveries: [{ netKg: kg, priceXofPerKg: 100, adjustmentPct: 0 }], seasonalDue: due,
  investmentFeeXof: fees.inv, landFeeXof: fees.land, operatorServiceFeeXof: fees.op, otherDeductionsXof: 0,
});
const base = (o: Partial<SettlementInput>): SettlementInput => ({ receiptsTotalXof: 0, farmers: [], seasonalFacilities: [], operatorInvestmentDueXof: 0, solidarity: { mode: 'none', capPct: 20 }, ...o });

describe('computeSettlement edge cases', () => {
  it('scales gross credit down to receipts: floor, residual to the largest G_i (tie: code)', () => {
    const out = computeSettlement(base({ receiptsTotalXof: 1000, farmers: [f('B', 10, []), f('A', 10, []), f('C', 5, [])] }));
    // G = 1000/1000/500, R/G = 0.4 → 400/400/200 exactly; with R = 1001 the 1 XOF goes to A (largest, code A < B).
    expect(out.lines.map((l) => [l.farmerCode, l.grossCreditXof])).toEqual([['A', 400], ['B', 400], ['C', 200]]);
    const odd = computeSettlement(base({ receiptsTotalXof: 1001, farmers: [f('B', 10, []), f('A', 10, []), f('C', 5, [])] }));
    expect(odd.lines.map((l) => l.grossCreditXof)).toEqual([401, 400, 200]);
    expect(odd.invariants.sumEqualsReceipts).toBe(true);
  });

  it('distributes an excess (R > G) pro rata and keeps the invariant', () => {
    const out = computeSettlement(base({ receiptsTotalXof: 3300, farmers: [f('A', 10, []), f('B', 20, [])] }));
    expect(out.lines.map((l) => l.payoutXof)).toEqual([1100, 2200]);
    expect(out.distribution.farmersTotalXof).toBe(3300);
  });

  it('splits seasonal repayments across facilities and sends receipts without deliveries to the operator', () => {
    const due = [{ facilityId: 'F1', amountXof: 600 }, { facilityId: 'F2', amountXof: 400 }];
    const out = computeSettlement(base({ receiptsTotalXof: 700, farmers: [f('A', 7, due)], seasonalFacilities: [{ facilityId: 'F1', dueXof: 600 }, { facilityId: 'F2', dueXof: 400 }] }));
    expect(out.distribution.seasonalByFacility).toEqual([{ facilityId: 'F1', amountXof: 420 }, { facilityId: 'F2', amountXof: 280 }]);
    expect(out.lines[0]!.arrears.seasonalDebtXof).toBe(300);
    const none = computeSettlement(base({ receiptsTotalXof: 500, farmers: [f('A', 0, [])] }));
    expect(none.distribution).toMatchObject({ operatorXof: 500, roundingToOperatorXof: 500, farmersTotalXof: 0 });
    expect(none.invariants.sumEqualsReceipts).toBe(true);
  });

  it('caps solidarity contributions and never covers fee buckets', () => {
    const fac = [{ facilityId: 'S', amountXof: 1000 }];
    const out = computeSettlement(base({
      receiptsTotalXof: 2000,
      farmers: [f('A', 15, fac), f('B', 5, fac, { inv: 100, land: 0, op: 50 })],
      seasonalFacilities: [{ facilityId: 'S', dueXof: 2000 }],
      solidarity: { mode: 'group', capPct: 20 },
    }));
    // A: 1500 − 1000 = 500 payout, cap 100 → contributes 100; B short 500 seasonal → receives 100, fees stay in arrears.
    expect(out.lines.map((l) => [l.solidarityContributionXof, l.solidarityReceivedXof, l.payoutXof])).toEqual([[100, 0, 400], [0, 100, 0]]);
    expect(out.lines[1]!.arrears).toEqual({ seasonalDebtXof: 400, investmentFeeXof: 100, operatorFeesXof: 50 });
    expect(out.distribution.seasonalByFacility[0]!.amountXof).toBe(1600);
    const off = computeSettlement(base({ receiptsTotalXof: 2000, farmers: [f('A', 15, fac), f('B', 5, fac)], seasonalFacilities: [{ facilityId: 'S', dueXof: 2000 }], solidarity: { mode: 'group', capPct: 20, applies: false } }));
    expect(off.lines.every((l) => l.solidarityContributionXof === 0)).toBe(true);
  });

  it('routes investment fees to the investment lender up to the instalments due, excess to the operator', () => {
    const out = computeSettlement(base({ receiptsTotalXof: 1000, farmers: [f('A', 10, [], { inv: 300, land: 0, op: 0 })], operatorInvestmentDueXof: 200 }));
    expect(out.distribution).toMatchObject({ investmentToLenderXof: 200, investmentExcessToOperatorXof: 100, operatorXof: 100, farmersTotalXof: 700 });
  });
});
