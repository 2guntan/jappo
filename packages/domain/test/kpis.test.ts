import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeKpis, type KpiInput } from '../src';

/** P9 DoD: KPIs on fixture match the expected values file. */
const load = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));

describe('computeKpis on fixture', () => {
  it('matches kpi-expected.json exactly', () => {
    expect(computeKpis(load('kpi-fixture.json') as KpiInput)).toEqual(load('kpi-expected.json'));
  });
  it('counts lines settled at harvest before their due date in the repayment rate', () => {
    const k = computeKpis({ asOf: '2026-12-01', plantedHa: 0, baseProductionT: 0, farmers: [], facilities: [{ trancheType: 'seasonal', disbursedXof: 3_000_000, outstandingPrincipalXof: 122_000, lines: [{ dueDate: '2027-06-01', totalXof: 3_270_000, paidXof: 3_148_000, matured: true }] }], expectedKg: 0, deliveredKg: 0, invoices: [], settlement: [], serviceCostXof: 0, submittedAt: null, firstDisbursementAt: null, openAlerts: [] });
    expect(k.repaymentRatePct).toBe(96.27);
    expect(k.par30Pct).toBe(0);
  });
  it('returns nulls instead of dividing by zero', () => {
    const k = computeKpis({ asOf: '2027-01-01', plantedHa: 0, baseProductionT: 0, farmers: [], facilities: [], expectedKg: 0, deliveredKg: 0, invoices: [], settlement: [], serviceCostXof: 0, submittedAt: null, firstDisbursementAt: null, openAlerts: [] });
    expect(k).toMatchObject({ womenPct: null, youthPct: null, par30Pct: null, repaymentRatePct: null, deliveryRatePct: null, yieldAchievedTHa: null, farmerNetIncomeMedianXof: null, serviceCostPerFarmerXof: null, daysSubmissionToFirstDisbursement: null });
  });
});
