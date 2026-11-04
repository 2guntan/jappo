import { describe, expect, it } from 'vitest';
import { allocateBudget, type BudgetInput } from '../src';

/**
 * Manual calculation fixture (SPEC §17 P3 DoD).
 * Plots: P1 1.0 ha (F1 100 %), P2 0.5 ha (F2 60 %, F3 40 %), P3 0.5 ha (no allocation).
 * Plantings: maize on P1 (1.0 ha) and P2 (0.5 ha); onion on P3 (0.5 ha).
 * Lines:
 *  L1 per_ha_all seed-mix 1 unit/ha × 10 000 (farmer_credit) → P1 10 000, P2 5 000, P3 5 000
 *  L2 per_ha_crop maize NPK 200 kg/ha × 450 (farmer_credit) → P1 90 000, P2 45 000
 *  L3 plot P2 ploughing 1 × 35 001 (farmer_credit) → P2 35 001
 *  L4 block training 1 × 20 000 (farmer_credit) → pro rata area 1.0/0.5/0.5 → 10 000 / 5 000 / 5 000
 *  L5 per_ha_all labour 2 day/ha × 2 500 (farmer_cash) → P1 5 000, P2 2 500, P3 2 500
 *  L6 block fuel 1 × 30 000 (operator) → not allocated to farmers
 * Farmer credit:
 *  F1 = 10 000 + 90 000 + 10 000 = 110 000
 *  P2 credit = 5 000 + 45 000 + 35 001 + 5 000 = 90 001 → F2 60 %, F3 40 %
 *    L1 5 000 → 3 000 / 2 000; L2 45 000 → 27 000 / 18 000; L3 35 001 → 21 000.6 / 14 000.4 → 21 001 / 14 000;
 *    L4 5 000 → 3 000 / 2 000 ⇒ F2 54 001, F3 36 000
 *  P3 (no allocation): 5 000 + 5 000 = 10 000 credit unallocated (+ 2 500 cash) → warning
 * Farmer cash: F1 5 000, F2 1 500, F3 1 000
 */
const input: BudgetInput = {
  plots: [
    { plotId: 'P1', code: 'P-001', areaHa: 1 },
    { plotId: 'P2', code: 'P-002', areaHa: 0.5 },
    { plotId: 'P3', code: 'P-003', areaHa: 0.5 },
  ],
  allocations: [
    { plotId: 'P1', farmerId: 'F1', farmerCode: 'F-000001', sharePct: 100 },
    { plotId: 'P2', farmerId: 'F2', farmerCode: 'F-000002', sharePct: 60 },
    { plotId: 'P2', farmerId: 'F3', farmerCode: 'F-000003', sharePct: 40 },
  ],
  plantings: [
    { plantingId: 'PL1', plotId: 'P1', cropId: 'maize', areaHa: 1 },
    { plantingId: 'PL2', plotId: 'P2', cropId: 'maize', areaHa: 0.5 },
    { plantingId: 'PL3', plotId: 'P3', cropId: 'onion', areaHa: 0.5 },
  ],
  lines: [
    { lineId: 'L1', scope: 'per_ha_all', qty: 1, unitPriceXof: 10000, payer: 'farmer_credit' },
    { lineId: 'L2', scope: 'per_ha_crop', cropId: 'maize', qty: 200, unitPriceXof: 450, payer: 'farmer_credit' },
    { lineId: 'L3', scope: 'plot', plotId: 'P2', qty: 1, unitPriceXof: 35001, payer: 'farmer_credit' },
    { lineId: 'L4', scope: 'block', qty: 1, unitPriceXof: 20000, payer: 'farmer_credit' },
    { lineId: 'L5', scope: 'per_ha_all', qty: 2, unitPriceXof: 2500, payer: 'farmer_cash' },
    { lineId: 'L6', scope: 'block', qty: 1, unitPriceXof: 30000, payer: 'operator' },
  ],
};

describe('allocateBudget (SPEC §9.1.3)', () => {
  const r = allocateBudget(input);
  const f = (id: string) => r.farmers.find((x) => x.farmerId === id)!;

  it('computes line totals', () => {
    expect(r.lines.map((l) => l.totalXof)).toEqual([20000, 135000, 35001, 20000, 10000, 30000]);
  });
  it('matches the manual per-farmer fixture', () => {
    expect(f('F1')).toMatchObject({ farmerCreditXof: 110000, farmerCashXof: 5000, ha: 1 });
    expect(f('F2')).toMatchObject({ farmerCreditXof: 54001, farmerCashXof: 1500, ha: 0.3 });
    expect(f('F3')).toMatchObject({ farmerCreditXof: 36000, farmerCashXof: 1000, ha: 0.2 });
  });
  it('reports totals by payer and unallocated amounts', () => {
    expect(r.totals).toEqual({ farmer_credit: 210001, farmer_cash: 10000, operator: 30000, grant: 0 });
    expect(r.unallocated).toEqual({ farmerCreditXof: 10000, farmerCashXof: 2500 });
    expect(r.warnings).toEqual([{ code: 'PLOT_WITHOUT_ALLOCATION', plotId: 'P3', message: 'Plot P-003 has a planting but no active allocation' }]);
    expect(f('F1').farmerCreditXof + f('F2').farmerCreditXof + f('F3').farmerCreditXof + r.unallocated.farmerCreditXof).toBe(r.totals.farmer_credit);
  });
  it('gives the rounding residual to the largest allocation, ties by farmer code', () => {
    const tie = allocateBudget({
      plots: [{ plotId: 'P', code: 'P', areaHa: 1 }],
      allocations: [
        { plotId: 'P', farmerId: 'B', farmerCode: 'F-2', sharePct: 50 },
        { plotId: 'P', farmerId: 'A', farmerCode: 'F-1', sharePct: 50 },
      ],
      plantings: [{ plantingId: 'X', plotId: 'P', cropId: 'c', areaHa: 1 }],
      lines: [{ lineId: 'L', scope: 'plot', plotId: 'P', qty: 1, unitPriceXof: 1001, payer: 'farmer_credit' }],
    });
    // 500.5 each → half-even 500 / 500 → residual 1 to largest (tie) → lowest code F-1 (A)
    expect(tie.farmers.find((x) => x.farmerId === 'A')!.farmerCreditXof).toBe(501);
    expect(tie.farmers.find((x) => x.farmerId === 'B')!.farmerCreditXof).toBe(500);
  });
  it('handles lines with no matching plantings', () => {
    const r2 = allocateBudget({ ...input, lines: [{ lineId: 'L', scope: 'per_ha_crop', cropId: 'rice', qty: 1, unitPriceXof: 100, payer: 'farmer_credit' }] });
    expect(r2.lines[0]!.totalXof).toBe(0);
    expect(r2.farmers.every((x) => x.farmerCreditXof === 0)).toBe(true);
  });
});
