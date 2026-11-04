import Handlebars from 'handlebars';

export interface ReportRenderInput {
  title: string;
  orgName: string;
  period: string;
  generatedAt: string;
  kpis: Record<string, unknown>;
  header: string[];
  rows: { label: string; values: (string | number)[] }[];
}

const KPI_LABELS: Record<string, { fr: string; en: string; kind: 'xof' | 'pct' | 'num' }> = {
  areaFinancedHa: { fr: 'Surface financée (ha)', en: 'Area financed (ha)', kind: 'num' },
  farmers: { fr: 'Producteurs', en: 'Farmers', kind: 'num' },
  womenPct: { fr: 'Femmes (%)', en: 'Women (%)', kind: 'pct' },
  youthPct: { fr: 'Jeunes < 35 ans (%)', en: 'Youth < 35 (%)', kind: 'pct' },
  par30Pct: { fr: 'PAR 30 (%)', en: 'PAR 30 (%)', kind: 'pct' },
  par90Pct: { fr: 'PAR 90 (%)', en: 'PAR 90 (%)', kind: 'pct' },
  repaymentRatePct: { fr: 'Taux de remboursement (%)', en: 'Repayment rate (%)', kind: 'pct' },
  deliveryRatePct: { fr: 'Livré / attendu (%)', en: 'Delivered / expected (%)', kind: 'pct' },
  yieldAchievedTHa: { fr: 'Rendement réalisé (t/ha)', en: 'Yield achieved (t/ha)', kind: 'num' },
  buyerPaymentDelayDays: { fr: 'Délai de paiement acheteur (j)', en: 'Buyer payment delay (days)', kind: 'num' },
  farmerNetIncomeAvgXof: { fr: 'Revenu net moyen producteur', en: 'Average farmer net income', kind: 'xof' },
  farmerNetIncomeMedianXof: { fr: 'Revenu net médian producteur', en: 'Median farmer net income', kind: 'xof' },
  valueCreatedAvgXof: { fr: 'Valeur créée moyenne', en: 'Average value created', kind: 'xof' },
  serviceCostPerFarmerXof: { fr: 'Coût des services par producteur', en: 'Service cost per farmer', kind: 'xof' },
  directCostRecoveryPct: { fr: 'Recouvrement des coûts directs (%)', en: 'Direct cost recovery (%)', kind: 'pct' },
  daysSubmissionToFirstDisbursement: { fr: 'Jours soumission → 1er décaissement', en: 'Days submission → first disbursement', kind: 'num' },
};

/** Monitoring report PDF (lender monthly, season close, guarantor portfolio). */
export function renderReportHtml(d: ReportRenderInput, locale: string): string {
  const en = locale === 'en';
  const esc = Handlebars.Utils.escapeExpression;
  const nf = new Intl.NumberFormat(en ? 'en-GB' : 'fr-SN', { maximumFractionDigits: 2 });
  const fmt = (v: unknown, kind: 'xof' | 'pct' | 'num') => (v === null || v === undefined ? '—' : typeof v === 'number' ? (kind === 'xof' ? `${nf.format(v)} FCFA` : nf.format(v)) : esc(String(v)));
  const k = d.kpis as Record<string, unknown> & { disbursedXof?: { total: number }; outstandingXof?: { total: number }; alerts?: { critical: number; warning: number } };
  const kpiRows = Object.entries(KPI_LABELS).map(([key, l]) => `<tr><td>${en ? l.en : l.fr}</td><td class="r">${fmt(k[key], l.kind)}</td></tr>`).join('');
  return `<!doctype html><html lang="${esc(locale)}"><head><meta charset="utf-8"><title>${esc(d.title)}</title><style>
@page { size: A4; margin: 16mm; } body { font-family: Arial, sans-serif; font-size: 10pt; color: #111827; }
h1 { color: #133f27; font-size: 17pt; margin: 0; } h2 { color: #23804a; font-size: 12pt; margin: 16px 0 6px; }
table { width: 100%; border-collapse: collapse; } td, th { border-bottom: 1px solid #e5e7eb; padding: 4px; text-align: left; } th { background: #f3f4f6; } .r { text-align: right; }
.cards { display: flex; gap: 10px; margin-top: 10px; } .card { flex: 1; border: 1px solid #d8f3e1; padding: 8px; } .card b { display: block; font-size: 13pt; color: #133f27; }
</style></head><body>
<h1>${esc(d.title)}</h1><p>${esc(d.orgName)} · ${esc(d.period)} · ${esc(d.generatedAt)}</p>
<div class="cards">
<div class="card">${en ? 'Disbursed' : 'Décaissé'}<b>${fmt(k.disbursedXof?.total, 'xof')}</b></div>
<div class="card">${en ? 'Outstanding' : 'Encours'}<b>${fmt(k.outstandingXof?.total, 'xof')}</b></div>
<div class="card">${en ? 'Open alerts (critical / warning)' : 'Alertes ouvertes (critiques / attention)'}<b>${k.alerts ? `${k.alerts.critical} / ${k.alerts.warning}` : '—'}</b></div>
</div>
<h2>${en ? 'Indicators' : 'Indicateurs'}</h2><table><tbody>${kpiRows}</tbody></table>
<h2>${en ? 'Detail' : 'Détail'}</h2>
<table><thead><tr><th></th>${d.header.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>
${d.rows.map((r) => `<tr><td>${esc(r.label)}</td>${r.values.map((v) => `<td>${typeof v === 'number' ? nf.format(v) : esc(v)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${d.header.length + 1}">—</td></tr>`}
</tbody></table>
</body></html>`;
}
