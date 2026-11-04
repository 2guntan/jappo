import { dec, roundXof } from './money';

export interface QualityGrade {
  grade: string;
  adjustmentPct: number;
}

export interface InvoiceDeliveryLine {
  netKg: number;
  grade: string;
}

export interface InvoiceInput {
  priceXofPerKg: number;
  qualitySpec: readonly QualityGrade[];
  /** Deliveries of the accepted dispatches, grouped as they were weighed. */
  dispatches: { netKgTotal: number; acceptedKg: number; deliveries: InvoiceDeliveryLine[] }[];
}

export interface InvoiceOutput {
  acceptedKg: number;
  amountXof: number;
  byGrade: { grade: string; acceptedKg: number; adjustmentPct: number; unitPriceXof: number; amountXof: number }[];
}

/**
 * Buyer invoice amount (SPEC §7.14): Σ accepted kg × price × (1 + grade adjustment).
 * Accepted kg of a dispatch are apportioned to its grades pro rata to weighed net kg (rejections reduce
 * every grade proportionally). Exact decimal arithmetic; XOF rounded half-even once per grade line
 * and the total is the sum of the rounded lines. Kg rounded to 3 decimals for display.
 */
export function computeInvoice(input: InvoiceInput): InvoiceOutput {
  const adj = new Map(input.qualitySpec.map((g) => [g.grade, g.adjustmentPct]));
  const kgByGrade = new Map<string, ReturnType<typeof dec>>();
  for (const d of input.dispatches) {
    if (d.netKgTotal <= 0 || d.acceptedKg <= 0) continue;
    const ratio = dec(d.acceptedKg).div(d.netKgTotal);
    for (const l of d.deliveries) kgByGrade.set(l.grade, (kgByGrade.get(l.grade) ?? dec(0)).plus(dec(l.netKg).times(ratio)));
  }
  const byGrade = [...kgByGrade.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([grade, kg]) => {
      const pct = adj.get(grade) ?? 0;
      const unit = dec(input.priceXofPerKg).times(dec(100).plus(pct)).div(100);
      return { grade, acceptedKg: kg.toDecimalPlaces(3).toNumber(), adjustmentPct: pct, unitPriceXof: unit.toDecimalPlaces(2).toNumber(), amountXof: roundXof(kg.times(unit)) };
    });
  return {
    acceptedKg: byGrade.reduce((s, g) => dec(s).plus(g.acceptedKg).toNumber(), 0),
    amountXof: byGrade.reduce((s, g) => s + g.amountXof, 0),
    byGrade,
  };
}

// ---------------------------------------------------------------- alert rules (SPEC §9.8)

export type AlertSeverity = 'info' | 'warning' | 'critical';
export const ALERT_RULE_CODES = [
  'VISIT_GAP', 'HEALTH_LOW', 'YIELD_FORECAST_DROP', 'INPUT_LATE', 'DISBURSEMENT_LATE', 'DELIVERY_SHORTFALL', 'BUYER_PAYMENT_OVERDUE', 'SCHEDULE_OVERDUE', 'LAND_DOC_EXPIRING', 'GRIEVANCE_OPEN',
] as const;
export type AlertRuleCode = (typeof ALERT_RULE_CODES)[number];

export interface AlertRuleConfig {
  code: AlertRuleCode;
  enabled: boolean;
  /** Rule parameters (days, thresholds); defaults below. */
  params: Record<string, number>;
}

export const DEFAULT_ALERT_RULES: AlertRuleConfig[] = [
  { code: 'VISIT_GAP', enabled: true, params: { days: 21 } },
  { code: 'HEALTH_LOW', enabled: true, params: { warningMax: 2, criticalMax: 1 } },
  { code: 'YIELD_FORECAST_DROP', enabled: true, params: { pctOfBase: 80, lastVisits: 3 } },
  { code: 'INPUT_LATE', enabled: true, params: { days: 10 } },
  { code: 'DISBURSEMENT_LATE', enabled: true, params: { days: 7 } },
  { code: 'DELIVERY_SHORTFALL', enabled: true, params: { daysAfterSeasonEnd: 15, pctOfExpected: 85 } },
  { code: 'BUYER_PAYMENT_OVERDUE', enabled: true, params: {} },
  { code: 'SCHEDULE_OVERDUE', enabled: true, params: {} },
  { code: 'LAND_DOC_EXPIRING', enabled: true, params: { days: 90 } },
  { code: 'GRIEVANCE_OPEN', enabled: true, params: { days: 30 } },
];

/** Everything the rules need about one block, as of a date (YYYY-MM-DD). */
export interface AlertSnapshot {
  blockId: string;
  asOf: string;
  season: { id: string; status: string; endDate: string } | null;
  plantedPlots: { plotId: string; plotCode: string; plantedSince: string; lastVisitAt: string | null }[];
  lastVisits: { plotId: string; plotCode: string; visitId: string; healthScore: number }[];
  yieldForecasts: { cropId: string; cropName: string; baseYieldTHa: number; recentEstimatesTHa: number[] }[];
  budgetLines: { id: string; label: string; plannedDate: string | null; delivered: boolean }[];
  disbursements: { id: string; ref: string; status: string; approvedAt: string | null }[];
  farmerDeliveries: { farmerId: string; farmerCode: string; expectedKg: number; deliveredKg: number }[];
  buyerInvoices: { id: string; ref: string; dueDate: string; status: string; outstandingXof: number }[];
  scheduleLines: { facilityId: string; facilityRef: string; seq: number; dueDate: string; outstandingXof: number }[];
  landDocuments: { id: string; docType: string; expiresAt: string | null }[];
  grievances: { id: string; openedAt: string; status: string; category: string }[];
}

export interface AlertCandidate {
  ruleCode: AlertRuleCode;
  severity: AlertSeverity;
  /** Stable key: an open alert with the same key is not raised twice. */
  dedupeKey: string;
  message: string;
  data: Record<string, unknown>;
}

const days = (from: string, to: string) => Math.floor((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86400_000);

/** Pure rules engine (SPEC §9.8). Deterministic order: rule order, then subject. */
export function evaluateAlertRules(s: AlertSnapshot, rules: readonly AlertRuleConfig[] = DEFAULT_ALERT_RULES): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  const on = (code: AlertRuleCode) => rules.find((r) => r.code === code && r.enabled);
  const p = (code: AlertRuleCode, k: string) => on(code)?.params[k] ?? DEFAULT_ALERT_RULES.find((r) => r.code === code)!.params[k]!;
  const inProgress = s.season?.status === 'in_progress';

  if (on('VISIT_GAP') && inProgress) {
    for (const pl of s.plantedPlots) {
      const ref = pl.lastVisitAt ?? pl.plantedSince;
      const gap = days(ref, s.asOf);
      if (gap >= p('VISIT_GAP', 'days')) out.push({ ruleCode: 'VISIT_GAP', severity: 'warning', dedupeKey: `VISIT_GAP:${pl.plotId}`, message: `Plot ${pl.plotCode}: no field visit for ${gap} days`, data: { plotId: pl.plotId, days: gap } });
    }
  }
  if (on('HEALTH_LOW')) {
    for (const v of s.lastVisits) {
      if (v.healthScore <= p('HEALTH_LOW', 'warningMax')) {
        const critical = v.healthScore <= p('HEALTH_LOW', 'criticalMax');
        out.push({ ruleCode: 'HEALTH_LOW', severity: critical ? 'critical' : 'warning', dedupeKey: `HEALTH_LOW:${v.visitId}`, message: `Plot ${v.plotCode}: crop health ${v.healthScore}/5 at last visit`, data: { plotId: v.plotId, visitId: v.visitId, healthScore: v.healthScore } });
      }
    }
  }
  if (on('YIELD_FORECAST_DROP')) {
    for (const y of s.yieldForecasts) {
      const n = p('YIELD_FORECAST_DROP', 'lastVisits');
      const recent = y.recentEstimatesTHa.slice(0, n);
      if (!recent.length || y.baseYieldTHa <= 0) continue;
      const avg = recent.reduce((a, b) => dec(a).plus(b).toNumber(), 0) / recent.length;
      const pct = dec(avg).div(y.baseYieldTHa).times(100);
      if (pct.lt(p('YIELD_FORECAST_DROP', 'pctOfBase'))) out.push({ ruleCode: 'YIELD_FORECAST_DROP', severity: 'critical', dedupeKey: `YIELD_FORECAST_DROP:${s.season?.id}:${y.cropId}`, message: `${y.cropName}: estimated yield ${dec(avg).toDecimalPlaces(2).toNumber()} t/ha is ${pct.toDecimalPlaces(0).toNumber()} % of base ${y.baseYieldTHa} t/ha`, data: { cropId: y.cropId, avgEstimateTHa: dec(avg).toDecimalPlaces(3).toNumber(), baseYieldTHa: y.baseYieldTHa } });
    }
  }
  if (on('INPUT_LATE')) {
    for (const b of s.budgetLines) {
      if (!b.plannedDate || b.delivered) continue;
      const late = days(b.plannedDate, s.asOf);
      if (late > p('INPUT_LATE', 'days')) out.push({ ruleCode: 'INPUT_LATE', severity: 'warning', dedupeKey: `INPUT_LATE:${b.id}`, message: `${b.label}: planned ${b.plannedDate}, not delivered after ${late} days`, data: { budgetLineId: b.id, days: late } });
    }
  }
  if (on('DISBURSEMENT_LATE')) {
    for (const d of s.disbursements) {
      if (d.status !== 'approved' || !d.approvedAt) continue;
      const late = days(d.approvedAt, s.asOf);
      if (late > p('DISBURSEMENT_LATE', 'days')) out.push({ ruleCode: 'DISBURSEMENT_LATE', severity: 'warning', dedupeKey: `DISBURSEMENT_LATE:${d.id}`, message: `Disbursement ${d.ref} approved ${late} days ago, not executed`, data: { disbursementId: d.id, days: late } });
    }
  }
  if (on('DELIVERY_SHORTFALL') && s.season && days(s.season.endDate, s.asOf) >= p('DELIVERY_SHORTFALL', 'daysAfterSeasonEnd')) {
    for (const f of s.farmerDeliveries) {
      if (f.expectedKg <= 0) continue;
      const pct = dec(f.deliveredKg).div(f.expectedKg).times(100);
      if (pct.lt(p('DELIVERY_SHORTFALL', 'pctOfExpected'))) {
        out.push({ ruleCode: 'DELIVERY_SHORTFALL', severity: 'critical', dedupeKey: `DELIVERY_SHORTFALL:${s.season.id}:${f.farmerId}`, message: `Farmer ${f.farmerCode}: delivered ${f.deliveredKg} kg of ${f.expectedKg} kg expected (${pct.toDecimalPlaces(0).toNumber()} %) — possible side-selling`, data: { farmerId: f.farmerId, expectedKg: f.expectedKg, deliveredKg: f.deliveredKg, sideSellingSuspected: true } });
      }
    }
  }
  if (on('BUYER_PAYMENT_OVERDUE')) {
    for (const i of s.buyerInvoices) {
      if (['paid', 'disputed'].includes(i.status) || i.outstandingXof <= 0) continue;
      if (days(i.dueDate, s.asOf) > 0) out.push({ ruleCode: 'BUYER_PAYMENT_OVERDUE', severity: 'critical', dedupeKey: `BUYER_PAYMENT_OVERDUE:${i.id}`, message: `Buyer invoice ${i.ref} overdue since ${i.dueDate}`, data: { buyerInvoiceId: i.id, outstandingXof: i.outstandingXof } });
    }
  }
  if (on('SCHEDULE_OVERDUE')) {
    for (const l of s.scheduleLines) {
      if (l.outstandingXof > 0 && days(l.dueDate, s.asOf) > 0) out.push({ ruleCode: 'SCHEDULE_OVERDUE', severity: 'critical', dedupeKey: `SCHEDULE_OVERDUE:${l.facilityId}:${l.seq}`, message: `Facility ${l.facilityRef}: instalment ${l.seq} due ${l.dueDate} unpaid`, data: { facilityId: l.facilityId, seq: l.seq, outstandingXof: l.outstandingXof } });
    }
  }
  if (on('LAND_DOC_EXPIRING')) {
    for (const d of s.landDocuments) {
      if (!d.expiresAt) continue;
      const left = days(s.asOf, d.expiresAt);
      if (left <= p('LAND_DOC_EXPIRING', 'days')) out.push({ ruleCode: 'LAND_DOC_EXPIRING', severity: 'warning', dedupeKey: `LAND_DOC_EXPIRING:${d.id}`, message: `Land document ${d.docType} expires on ${d.expiresAt}`, data: { landDocumentId: d.id, daysLeft: left } });
    }
  }
  if (on('GRIEVANCE_OPEN')) {
    for (const g of s.grievances) {
      if (!['open', 'in_progress'].includes(g.status)) continue;
      const age = days(g.openedAt, s.asOf);
      if (age > p('GRIEVANCE_OPEN', 'days')) out.push({ ruleCode: 'GRIEVANCE_OPEN', severity: 'warning', dedupeKey: `GRIEVANCE_OPEN:${g.id}`, message: `Community grievance (${g.category}) open for ${age} days`, data: { grievanceId: g.id, days: age } });
    }
  }
  return out;
}

/** Expected base deliveries per farmer (§9.1.2 deliverable kg split by plot allocation share). */
export function expectedKgByFarmer(
  plantings: readonly { plotId: string; areaHa: number; yieldBaseTHa: number | null; postHarvestLossPct: number | null; deliveryRatePct: number | null }[],
  allocations: readonly { plotId: string; farmerId: string; sharePct: number }[],
): Map<string, number> {
  const out = new Map<string, ReturnType<typeof dec>>();
  for (const p of plantings) {
    const kg = dec(p.areaHa).times(p.yieldBaseTHa ?? 0).times(1000).times(dec(1).minus(dec(p.postHarvestLossPct ?? 0).div(100))).times(dec(p.deliveryRatePct ?? 100).div(100));
    for (const a of allocations.filter((x) => x.plotId === p.plotId)) out.set(a.farmerId, (out.get(a.farmerId) ?? dec(0)).plus(kg.times(a.sharePct).div(100)));
  }
  return new Map([...out.entries()].map(([k, v]) => [k, v.toDecimalPlaces(3).toNumber()]));
}
