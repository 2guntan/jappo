import Handlebars from 'handlebars';

export interface BuyerInvoiceRenderInput {
  ref: string;
  issuedAt: string;
  dueDate: string;
  seller: { legalName: string; ninea: string | null; rccm: string | null; address: string | null };
  buyer: { legalName: string; ninea: string | null; rccm: string | null; address: string | null };
  product: string;
  offtakeRef: string;
  dispatchRefs: string[];
  lines: { grade: string; acceptedKg: number; adjustmentPct: number; unitPriceXof: number; amountXof: number }[];
  /** Amount excluding VAT (grade-adjusted). */
  amountXof: number;
  /** VAT rate in bps (unprocessed agricultural produce is VAT-exempt in Senegal: 0 by default). */
  vatBps: number;
  escrow: { bankName: string; accountLabel: string; accountNumberMasked: string } | null;
}

const L = {
  fr: { title: 'Facture', seller: 'Vendeur', buyer: 'Acheteur', issued: 'Date', due: 'Échéance', product: 'Produit', offtake: "Contrat d'enlèvement", dispatches: 'Expéditions', grade: 'Grade', kg: 'Quantité acceptée (kg)', adj: 'Ajustement', unit: 'Prix unitaire (FCFA/kg)', amount: 'Montant (FCFA)', ht: 'Total HT', vat: 'TVA', exempt: 'Exonéré — produits agricoles non transformés', ttc: 'Total TTC', pay: 'Paiement exclusivement sur le compte séquestre', words: 'Arrêtée la présente facture à la somme de' },
  en: { title: 'Invoice', seller: 'Seller', buyer: 'Buyer', issued: 'Date', due: 'Due date', product: 'Product', offtake: 'Offtake contract', dispatches: 'Dispatches', grade: 'Grade', kg: 'Accepted quantity (kg)', adj: 'Adjustment', unit: 'Unit price (XOF/kg)', amount: 'Amount (XOF)', ht: 'Total excl. VAT', vat: 'VAT', exempt: 'Exempt — unprocessed agricultural produce', ttc: 'Total incl. VAT', pay: 'Payment exclusively into the escrow account', words: 'This invoice amounts to' },
};

/** OHADA-style invoice (NINEA, RCCM, VAT mention) rendered to HTML for the PDF adapter. */
export function renderBuyerInvoiceHtml(d: BuyerInvoiceRenderInput, locale: string): string {
  const l = locale === 'en' ? L.en : L.fr;
  const esc = Handlebars.Utils.escapeExpression;
  const nf = new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'fr-SN', { maximumFractionDigits: 3 });
  const vat = Math.round((d.amountXof * d.vatBps) / 10000);
  const party = (p: BuyerInvoiceRenderInput['seller']) => `<strong>${esc(p.legalName)}</strong><br>NINEA ${esc(p.ninea ?? '—')} · RCCM ${esc(p.rccm ?? '—')}<br>${esc(p.address ?? '')}`;
  const rows = d.lines.map((x) => `<tr><td>${esc(x.grade)}</td><td class="r">${nf.format(x.acceptedKg)}</td><td class="r">${x.adjustmentPct > 0 ? '+' : ''}${nf.format(x.adjustmentPct)} %</td><td class="r">${nf.format(x.unitPriceXof)}</td><td class="r">${nf.format(x.amountXof)}</td></tr>`).join('');
  return `<!doctype html><html lang="${esc(locale)}"><head><meta charset="utf-8"><title>${esc(d.ref)}</title><style>
@page { size: A4; margin: 16mm; } body { font-family: Arial, sans-serif; font-size: 10pt; color: #111827; }
h1 { color: #133f27; font-size: 18pt; margin: 0; } .grid { display: flex; justify-content: space-between; gap: 24px; margin: 14px 0; } .box { border: 1px solid #e5e7eb; padding: 8px; width: 48%; }
table { width: 100%; border-collapse: collapse; margin-top: 10px; } th, td { border-bottom: 1px solid #e5e7eb; padding: 4px; text-align: left; } th { background: #f3f4f6; } .r { text-align: right; } .muted { color: #6b7280; font-size: 8.5pt; }
</style></head><body>
<h1>${l.title} ${esc(d.ref)}</h1>
<p>${l.issued} : ${esc(d.issuedAt)} · ${l.due} : ${esc(d.dueDate)}</p>
<div class="grid"><div class="box">${l.seller}<br>${party(d.seller)}</div><div class="box">${l.buyer}<br>${party(d.buyer)}</div></div>
<p>${l.product} : ${esc(d.product)} · ${l.offtake} : ${esc(d.offtakeRef)} · ${l.dispatches} : ${esc(d.dispatchRefs.join(', '))}</p>
<table><thead><tr><th>${l.grade}</th><th class="r">${l.kg}</th><th class="r">${l.adj}</th><th class="r">${l.unit}</th><th class="r">${l.amount}</th></tr></thead><tbody>${rows}</tbody></table>
<table><tbody>
<tr><td>${l.ht}</td><td class="r" data-total="ht">${nf.format(d.amountXof)}</td></tr>
<tr><td>${l.vat} ${d.vatBps ? `${nf.format(d.vatBps / 100)} %` : `(${l.exempt})`}</td><td class="r">${nf.format(vat)}</td></tr>
<tr><td><strong>${l.ttc}</strong></td><td class="r"><strong>${nf.format(d.amountXof + vat)}</strong></td></tr>
</tbody></table>
<p>${l.words} ${nf.format(d.amountXof + vat)} FCFA.</p>
${d.escrow ? `<p><strong>${l.pay}</strong> : ${esc(d.escrow.bankName)} · ${esc(d.escrow.accountLabel)} · ${esc(d.escrow.accountNumberMasked)}</p>` : ''}
<p class="muted">${esc(d.ref)}</p>
</body></html>`;
}
