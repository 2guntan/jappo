import { describe, expect, it } from 'vitest';
import { computeInvoice, DEFAULT_ALERT_RULES, evaluateAlertRules, type AlertSnapshot } from '../src';

describe('computeInvoice (grade-adjusted buyer invoice)', () => {
  it('apportions rejections pro rata to grades and applies grade adjustments', () => {
    const out = computeInvoice({
      priceXofPerKg: 250,
      qualitySpec: [{ grade: 'A', adjustmentPct: 0 }, { grade: 'B', adjustmentPct: -10 }],
      dispatches: [
        { netKgTotal: 10_000, acceptedKg: 9_500, deliveries: [{ netKg: 6_000, grade: 'A' }, { netKg: 4_000, grade: 'B' }] },
        { netKgTotal: 2_000, acceptedKg: 2_000, deliveries: [{ netKg: 2_000, grade: 'A' }] },
        { netKgTotal: 1_000, acceptedKg: 0, deliveries: [{ netKg: 1_000, grade: 'A' }] },
      ],
    });
    expect(out.byGrade).toEqual([
      { grade: 'A', acceptedKg: 7_700, adjustmentPct: 0, unitPriceXof: 250, amountXof: 1_925_000 },
      { grade: 'B', acceptedKg: 3_800, adjustmentPct: -10, unitPriceXof: 225, amountXof: 855_000 },
    ]);
    expect(out).toMatchObject({ acceptedKg: 11_500, amountXof: 2_780_000 });
  });

  it('rounds each grade line half-even and treats unknown grades at par', () => {
    const out = computeInvoice({ priceXofPerKg: 247, qualitySpec: [{ grade: 'B', adjustmentPct: -7.5 }], dispatches: [{ netKgTotal: 1000, acceptedKg: 999, deliveries: [{ netKg: 333.333, grade: 'B' }, { netKg: 666.667, grade: 'X' }] }] });
    // B: 333.333 × 0.999 = 332.999667 kg × 228.475 = 76 082.10… → 76 082 ; X: 666.000333 kg × 247 = 164 502.08… → 164 502
    expect(out.byGrade.map((g) => g.amountXof)).toEqual([76_082, 164_502]);
    expect(out.amountXof).toBe(240_584);
  });
});

const base: AlertSnapshot = {
  blockId: 'b1',
  asOf: '2027-05-20',
  season: { id: 's1', status: 'in_progress', endDate: '2027-04-30' },
  plantedPlots: [
    { plotId: 'p1', plotCode: 'P-001', plantedSince: '2026-11-20', lastVisitAt: '2027-05-10' },
    { plotId: 'p2', plotCode: 'P-002', plantedSince: '2026-11-20', lastVisitAt: '2027-04-20' },
    { plotId: 'p3', plotCode: 'P-003', plantedSince: '2027-05-01', lastVisitAt: null },
  ],
  lastVisits: [
    { plotId: 'p1', plotCode: 'P-001', visitId: 'v1', healthScore: 1 },
    { plotId: 'p2', plotCode: 'P-002', visitId: 'v2', healthScore: 2 },
    { plotId: 'p3', plotCode: 'P-003', visitId: 'v3', healthScore: 4 },
  ],
  yieldForecasts: [
    { cropId: 'maize', cropName: 'Maïs', baseYieldTHa: 7, recentEstimatesTHa: [5, 5.5, 6, 9] },
    { cropId: 'onion', cropName: 'Oignon', baseYieldTHa: 20, recentEstimatesTHa: [18, 17] },
  ],
  budgetLines: [
    { id: 'bl1', label: 'NPK', plannedDate: '2027-05-01', delivered: false },
    { id: 'bl2', label: 'Urée', plannedDate: '2027-05-15', delivered: false },
    { id: 'bl3', label: 'Semences', plannedDate: '2026-11-01', delivered: true },
  ],
  disbursements: [
    { id: 'd1', ref: 'DSB-1', status: 'approved', approvedAt: '2027-05-10T09:00:00Z' },
    { id: 'd2', ref: 'DSB-2', status: 'approved', approvedAt: '2027-05-15T09:00:00Z' },
  ],
  farmerDeliveries: [
    { farmerId: 'f1', farmerCode: 'F-1', expectedKg: 10_000, deliveredKg: 8_400 },
    { farmerId: 'f2', farmerCode: 'F-2', expectedKg: 10_000, deliveredKg: 8_500 },
  ],
  buyerInvoices: [
    { id: 'i1', ref: 'BIN-1', dueDate: '2027-05-19', status: 'issued', outstandingXof: 100 },
    { id: 'i2', ref: 'BIN-2', dueDate: '2027-05-19', status: 'paid', outstandingXof: 0 },
    { id: 'i3', ref: 'BIN-3', dueDate: '2027-05-20', status: 'issued', outstandingXof: 100 },
  ],
  scheduleLines: [
    { facilityId: 'fa1', facilityRef: 'FAC-1', seq: 1, dueDate: '2027-05-19', outstandingXof: 1 },
    { facilityId: 'fa1', facilityRef: 'FAC-1', seq: 2, dueDate: '2027-05-19', outstandingXof: 0 },
  ],
  landDocuments: [
    { id: 'l1', docType: 'bail', expiresAt: '2027-08-18' },
    { id: 'l2', docType: 'bail', expiresAt: '2027-08-19' },
    { id: 'l3', docType: 'deliberation', expiresAt: null },
  ],
  grievances: [
    { id: 'g1', openedAt: '2027-04-19', status: 'open', category: 'water' },
    { id: 'g2', openedAt: '2027-04-20', status: 'open', category: 'land' },
    { id: 'g3', openedAt: '2027-01-01', status: 'resolved', category: 'land' },
  ],
};

describe('alert rules engine (§9.8) on fixture', () => {
  it('raises exactly the expected alerts', () => {
    const out = evaluateAlertRules(base);
    expect(out.map((a) => [a.ruleCode, a.severity, a.dedupeKey])).toEqual([
      ['VISIT_GAP', 'warning', 'VISIT_GAP:p2'],
      ['HEALTH_LOW', 'critical', 'HEALTH_LOW:v1'],
      ['HEALTH_LOW', 'warning', 'HEALTH_LOW:v2'],
      ['YIELD_FORECAST_DROP', 'critical', 'YIELD_FORECAST_DROP:s1:maize'],
      ['INPUT_LATE', 'warning', 'INPUT_LATE:bl1'],
      ['DISBURSEMENT_LATE', 'warning', 'DISBURSEMENT_LATE:d1'],
      ['DELIVERY_SHORTFALL', 'critical', 'DELIVERY_SHORTFALL:s1:f1'],
      ['BUYER_PAYMENT_OVERDUE', 'critical', 'BUYER_PAYMENT_OVERDUE:i1'],
      ['SCHEDULE_OVERDUE', 'critical', 'SCHEDULE_OVERDUE:fa1:1'],
      ['LAND_DOC_EXPIRING', 'warning', 'LAND_DOC_EXPIRING:l1'],
      ['GRIEVANCE_OPEN', 'warning', 'GRIEVANCE_OPEN:g1'],
    ]);
    expect(out.find((a) => a.ruleCode === 'DELIVERY_SHORTFALL')!.data.sideSellingSuspected).toBe(true);
  });

  it('respects disabled rules, parameters and season state', () => {
    const rules = DEFAULT_ALERT_RULES.map((r) => (r.code === 'HEALTH_LOW' ? { ...r, enabled: false } : r.code === 'VISIT_GAP' ? { ...r, params: { days: 10 } } : r));
    const out = evaluateAlertRules(base, rules);
    expect(out.filter((a) => a.ruleCode === 'HEALTH_LOW')).toHaveLength(0);
    expect(out.filter((a) => a.ruleCode === 'VISIT_GAP').map((a) => a.dedupeKey)).toEqual(['VISIT_GAP:p1', 'VISIT_GAP:p2', 'VISIT_GAP:p3']);
    const planning = evaluateAlertRules({ ...base, season: { ...base.season!, status: 'planning' }, asOf: '2027-05-14' });
    expect(planning.filter((a) => ['VISIT_GAP', 'DELIVERY_SHORTFALL'].includes(a.ruleCode))).toHaveLength(0);
  });
});

describe('expectedKgByFarmer', () => {
  it('splits deliverable kg by allocation share', async () => {
    const { expectedKgByFarmer } = await import('../src');
    const m = expectedKgByFarmer([{ plotId: 'p1', areaHa: 1, yieldBaseTHa: 7, postHarvestLossPct: 10, deliveryRatePct: 90 }, { plotId: 'p2', areaHa: 0.5, yieldBaseTHa: 4, postHarvestLossPct: 0, deliveryRatePct: null }], [{ plotId: 'p1', farmerId: 'a', sharePct: 50 }, { plotId: 'p1', farmerId: 'b', sharePct: 50 }, { plotId: 'p2', farmerId: 'a', sharePct: 100 }]);
    expect(m.get('a')).toBe(2835 + 2000);
    expect(m.get('b')).toBe(2835);
  });
});
