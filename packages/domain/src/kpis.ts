import { dec, roundRatio } from './money';

/** Inputs for one scope (block-season, lender portfolio or platform), as of a date (YYYY-MM-DD). */
export interface KpiInput {
  asOf: string;
  plantedHa: number;
  /** Σ base yield × planted ha (t), for the weighted base yield. */
  baseProductionT: number;
  farmers: { sex: 'F' | 'M'; birthYear: number | null }[];
  facilities: {
    trancheType: 'seasonal' | 'investment';
    disbursedXof: number;
    outstandingPrincipalXof: number;
    lines: { dueDate: string; totalXof: number; paidXof: number }[];
  }[];
  expectedKg: number;
  deliveredKg: number;
  invoices: { issuedAt: string; amountXof: number; paidAt: string | null }[];
  /** Latest settlement lines of the scope. */
  settlement: { payoutXof: number; baselineIncomeXof: number | null; feesPaidXof: number }[];
  serviceCostXof: number;
  submittedAt: string | null;
  firstDisbursementAt: string | null;
  openAlerts: { severity: 'info' | 'warning' | 'critical' }[];
}

export interface Kpis {
  areaFinancedHa: number;
  farmers: number;
  womenPct: number | null;
  youthPct: number | null;
  disbursedXof: { seasonal: number; investment: number; total: number };
  outstandingXof: { seasonal: number; investment: number; total: number };
  par30Pct: number | null;
  par90Pct: number | null;
  repaymentRatePct: number | null;
  expectedKg: number;
  deliveredKg: number;
  deliveryRatePct: number | null;
  yieldAchievedTHa: number | null;
  yieldBaseTHa: number | null;
  yieldAchievedPctOfBase: number | null;
  buyerPaymentDelayDays: number | null;
  farmerNetIncomeAvgXof: number | null;
  farmerNetIncomeMedianXof: number | null;
  valueCreatedAvgXof: number | null;
  serviceCostPerFarmerXof: number | null;
  directCostRecoveryPct: number | null;
  daysSubmissionToFirstDisbursement: number | null;
  alerts: { info: number; warning: number; critical: number };
}

const days = (from: string, to: string) => Math.floor((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86400_000);
const pct = (num: number, den: number) => (den > 0 ? roundRatio(dec(num).div(den).times(100), 2) : null);
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

/** KPI engine (SPEC §9.9). Pure; percentages rounded to 2 decimals, XOF averages to the unit. */
export function computeKpis(i: KpiInput): Kpis {
  const year = Number(i.asOf.slice(0, 4));
  const women = i.farmers.filter((f) => f.sex === 'F').length;
  const known = i.farmers.filter((f) => f.birthYear !== null);
  const youth = known.filter((f) => year - (f.birthYear as number) < 35).length;
  const sum = (t?: 'seasonal' | 'investment') => (pick: (f: KpiInput['facilities'][number]) => number) => i.facilities.filter((f) => !t || f.trancheType === t).reduce((s, f) => s + pick(f), 0);
  const outstanding = sum()((f) => f.outstandingPrincipalXof);
  const overdueDays = (f: KpiInput['facilities'][number]) => f.lines.reduce((m, l) => (l.paidXof < l.totalXof && days(l.dueDate, i.asOf) > 0 ? Math.max(m, days(l.dueDate, i.asOf)) : m), 0);
  const parAt = (threshold: number) => pct(i.facilities.filter((f) => overdueDays(f) > threshold).reduce((s, f) => s + f.outstandingPrincipalXof, 0), outstanding);
  const dueLines = i.facilities.flatMap((f) => f.lines.filter((l) => days(l.dueDate, i.asOf) >= 0));
  const delays = i.invoices.filter((v) => v.paidAt).map((v) => days(v.issuedAt, v.paidAt!));
  const net = i.settlement.map((s) => s.payoutXof);
  const created = i.settlement.filter((s) => s.baselineIncomeXof !== null).map((s) => s.payoutXof - (s.baselineIncomeXof as number));
  const fees = i.settlement.reduce((s, x) => s + x.feesPaidXof, 0);
  const yieldAchieved = i.plantedHa > 0 && i.deliveredKg > 0 ? roundRatio(dec(i.deliveredKg).div(1000).div(i.plantedHa), 3) : null;
  const yieldBase = i.plantedHa > 0 ? roundRatio(dec(i.baseProductionT).div(i.plantedHa), 3) : null;
  return {
    areaFinancedHa: roundRatio(i.plantedHa, 4),
    farmers: i.farmers.length,
    womenPct: pct(women, i.farmers.length),
    youthPct: pct(youth, known.length),
    disbursedXof: { seasonal: sum('seasonal')((f) => f.disbursedXof), investment: sum('investment')((f) => f.disbursedXof), total: sum()((f) => f.disbursedXof) },
    outstandingXof: { seasonal: sum('seasonal')((f) => f.outstandingPrincipalXof), investment: sum('investment')((f) => f.outstandingPrincipalXof), total: outstanding },
    par30Pct: parAt(30),
    par90Pct: parAt(90),
    repaymentRatePct: pct(dueLines.reduce((s, l) => s + Math.min(l.paidXof, l.totalXof), 0), dueLines.reduce((s, l) => s + l.totalXof, 0)),
    expectedKg: roundRatio(i.expectedKg, 3),
    deliveredKg: roundRatio(i.deliveredKg, 3),
    deliveryRatePct: pct(i.deliveredKg, i.expectedKg),
    yieldAchievedTHa: yieldAchieved,
    yieldBaseTHa: yieldBase,
    yieldAchievedPctOfBase: yieldAchieved !== null && i.baseProductionT > 0 ? pct(dec(i.deliveredKg).div(1000).toNumber(), i.baseProductionT) : null,
    buyerPaymentDelayDays: delays.length ? roundRatio(dec(delays.reduce((s, x) => s + x, 0)).div(delays.length), 1) : null,
    farmerNetIncomeAvgXof: avg(net),
    farmerNetIncomeMedianXof: median(net),
    valueCreatedAvgXof: avg(created),
    serviceCostPerFarmerXof: i.farmers.length ? Math.round(i.serviceCostXof / i.farmers.length) : null,
    directCostRecoveryPct: pct(fees, i.serviceCostXof),
    daysSubmissionToFirstDisbursement: i.submittedAt && i.firstDisbursementAt ? days(i.submittedAt, i.firstDisbursementAt) : null,
    alerts: { info: i.openAlerts.filter((a) => a.severity === 'info').length, warning: i.openAlerts.filter((a) => a.severity === 'warning').length, critical: i.openAlerts.filter((a) => a.severity === 'critical').length },
  };
}
