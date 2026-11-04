import Handlebars from 'handlebars';

export interface FarmerStatementInput {
  runRef: string;
  date: string;
  operator: string;
  block: string;
  season: string;
  farmer: { name: string; code: string; village: string };
  plots: { code: string; areaHa: number; sharePct: number }[];
  tickets: { ticketNo: string; date: string; netKg: number; grade: string; status: string }[];
  line: {
    grossCreditXof: number;
    seasonalPaidXof: number;
    investmentFeePaidXof: number;
    operatorFeesPaidXof: number;
    otherDeductionsXof: number;
    solidarityContributionXof: number;
    solidarityReceivedXof: number;
    payoutXof: number;
    arrears: { seasonalDebtXof: number; investmentFeeXof: number; operatorFeesXof: number };
  };
  paymentRef: string | null;
  paymentChannel: string | null;
}

const L = {
  fr: { title: 'Relevé de campagne', farmer: 'Producteur', plots: 'Parcelles', deliveries: 'Livraisons (bons de pesée)', ticket: 'Bon', date: 'Date', kg: 'Net (kg)', grade: 'Grade', gross: 'Crédit brut (ventes)', seasonal: 'Remboursement crédit de campagne', invest: "Frais de recouvrement d'investissement", fees: 'Frais de services et foncier', other: 'Autres déductions', solidarityOut: 'Contribution de solidarité', solidarityIn: 'Solidarité reçue', payout: 'Montant versé', arrears: 'Arriérés reportés', arrearsSeasonal: 'Crédit de campagne', arrearsInvest: 'Investissement', arrearsFees: 'Frais', payment: 'Paiement', none: 'Aucun' },
  en: { title: 'Season statement', farmer: 'Farmer', plots: 'Plots', deliveries: 'Deliveries (weighing tickets)', ticket: 'Ticket', date: 'Date', kg: 'Net (kg)', grade: 'Grade', gross: 'Gross credit (sales)', seasonal: 'Seasonal credit repayment', invest: 'Investment recovery fee', fees: 'Service and land fees', other: 'Other deductions', solidarityOut: 'Solidarity contribution', solidarityIn: 'Solidarity received', payout: 'Amount paid', arrears: 'Arrears carried forward', arrearsSeasonal: 'Seasonal credit', arrearsInvest: 'Investment', arrearsFees: 'Fees', payment: 'Payment', none: 'None' },
};

/** Farmer statement PDF (SPEC §14.1 `farmer_statement`). */
export function renderFarmerStatementHtml(d: FarmerStatementInput, locale: string): string {
  const l = locale === 'en' ? L.en : L.fr;
  const esc = Handlebars.Utils.escapeExpression;
  const nf = new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'fr-SN', { maximumFractionDigits: 3 });
  const x = (n: number) => `${nf.format(n)} FCFA`;
  const row = (label: string, v: number, sign = '') => `<tr><td>${label}</td><td class="r">${sign}${x(v)}</td></tr>`;
  const ar = d.line.arrears;
  const arrearsTotal = ar.seasonalDebtXof + ar.investmentFeeXof + ar.operatorFeesXof;
  return `<!doctype html><html lang="${esc(locale)}"><head><meta charset="utf-8"><title>${esc(d.runRef)} ${esc(d.farmer.code)}</title><style>
@page { size: A4; margin: 16mm; } body { font-family: Arial, sans-serif; font-size: 10.5pt; color: #111827; }
h1 { color: #133f27; font-size: 17pt; margin: 0 0 4px; } h2 { font-size: 11.5pt; color: #23804a; margin: 14px 0 4px; }
table { width: 100%; border-collapse: collapse; } td, th { border-bottom: 1px solid #e5e7eb; padding: 4px; text-align: left; } th { background: #f3f4f6; } .r { text-align: right; }
.total td { font-weight: bold; font-size: 12pt; border-top: 2px solid #133f27; } .muted { color: #6b7280; font-size: 8.5pt; }
</style></head><body>
<h1>${l.title}</h1>
<p>${esc(d.operator)} · ${esc(d.block)} · ${esc(d.season)} · ${esc(d.date)}</p>
<h2>${l.farmer}</h2><p><strong>${esc(d.farmer.name)}</strong> (${esc(d.farmer.code)}) · ${esc(d.farmer.village)}</p>
<h2>${l.plots}</h2><p>${d.plots.map((p) => `${esc(p.code)} — ${nf.format(p.areaHa)} ha (${nf.format(p.sharePct)} %)`).join(' · ') || l.none}</p>
<h2>${l.deliveries}</h2>
<table><thead><tr><th>${l.ticket}</th><th>${l.date}</th><th class="r">${l.kg}</th><th>${l.grade}</th></tr></thead><tbody>
${d.tickets.map((t) => `<tr><td>${esc(t.ticketNo)}</td><td>${esc(t.date)}</td><td class="r">${nf.format(t.netKg)}</td><td>${esc(t.grade)}</td></tr>`).join('') || `<tr><td colspan="4">${l.none}</td></tr>`}
</tbody></table>
<h2>${l.payout}</h2>
<table><tbody>
${row(l.gross, d.line.grossCreditXof)}
${row(l.seasonal, d.line.seasonalPaidXof, '− ')}
${row(l.invest, d.line.investmentFeePaidXof, '− ')}
${row(l.fees, d.line.operatorFeesPaidXof, '− ')}
${d.line.otherDeductionsXof ? row(l.other, d.line.otherDeductionsXof, '− ') : ''}
${d.line.solidarityContributionXof ? row(l.solidarityOut, d.line.solidarityContributionXof, '− ') : ''}
${d.line.solidarityReceivedXof ? row(l.solidarityIn, d.line.solidarityReceivedXof) : ''}
<tr class="total"><td>${l.payout}</td><td class="r">${x(d.line.payoutXof)}</td></tr>
</tbody></table>
<h2>${l.arrears}</h2>
<p>${arrearsTotal ? `${l.arrearsSeasonal} ${x(ar.seasonalDebtXof)} · ${l.arrearsInvest} ${x(ar.investmentFeeXof)} · ${l.arrearsFees} ${x(ar.operatorFeesXof)}` : l.none}</p>
<p>${l.payment} : ${esc(d.paymentRef ?? '—')} ${d.paymentChannel ? `· ${esc(d.paymentChannel)}` : ''}</p>
<p class="muted">${esc(d.runRef)}</p>
</body></html>`;
}
