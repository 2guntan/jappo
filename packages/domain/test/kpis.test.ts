import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeKpis, type KpiInput } from '../src';

/** P9 DoD: KPIs on fixture match the expected values file. */
const load = (f: string) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));

describe('computeKpis on fixture', () => {
  it('matches kpi-expected.json exactly', () => {
    expect(computeKpis(load('kpi-fixture.json') as KpiInput)).toEqual(load('kpi-expected.json'));
  });
  it('returns nulls instead of dividing by zero', () => {
    const k = computeKpis({ asOf: '2027-01-01', plantedHa: 0, baseProductionT: 0, farmers: [], facilities: [], expectedKg: 0, deliveredKg: 0, invoices: [], settlement: [], serviceCostXof: 0, submittedAt: null, firstDisbursementAt: null, openAlerts: [] });
    expect(k).toMatchObject({ womenPct: null, youthPct: null, par30Pct: null, repaymentRatePct: null, deliveryRatePct: null, yieldAchievedTHa: null, farmerNetIncomeMedianXof: null, serviceCostPerFarmerXof: null, daysSubmissionToFirstDisbursement: null });
  });
});
