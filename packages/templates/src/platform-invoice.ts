import Handlebars from 'handlebars';

export interface PlatformInvoiceRenderInput {
  ref: string;
  issuedAt: string;
  dueDate: string;
  periodStart: string;
  periodEnd: string;
  customer: { legalName: string; ninea: string | null; rccm: string | null; address: string | null };
  lines: { description: string; qty: number; unitPriceXof: number; amountXof: number }[];
  amountXof: number;
  vatBps: number;
  taxXof: number;
  totalXof: number;
}

/** Jappo platform invoice (SPEC §14.1 `platform_invoice`, OHADA mentions; issuer data from settings in a later release). */
export function renderPlatformInvoiceHtml(d: PlatformInvoiceRenderInput, locale: string): string {
  const en = locale === 'en';
  const esc = Handlebars.Utils.escapeExpression;
  const nf = new Intl.NumberFormat(en ? 'en-GB' : 'fr-SN', { maximumFractionDigits: 2 });
  const rows = d.lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="r">${nf.format(l.qty)}</td><td class="r">${nf.format(l.unitPriceXof)}</td><td class="r">${nf.format(l.amountXof)}</td></tr>`).join('');
  return `<!doctype html><html lang="${esc(locale)}"><head><meta charset="utf-8"><title>${esc(d.ref)}</title><style>
@page { size: A4; margin: 16mm; } body { font-family: Arial, sans-serif; font-size: 10pt; color: #111827; }
h1 { color: #133f27; font-size: 18pt; margin: 0; } table { width: 100%; border-collapse: collapse; margin-top: 10px; }
td, th { border-bottom: 1px solid #e5e7eb; padding: 4px; text-align: left; } th { background: #f3f4f6; } .r { text-align: right; } .box { border: 1px solid #e5e7eb; padding: 8px; margin: 12px 0; }
</style></head><body>
<h1>${en ? 'Invoice' : 'Facture'} ${esc(d.ref)}</h1>
<p>Jappo · ${en ? 'Date' : 'Date'} ${esc(d.issuedAt)} · ${en ? 'Due' : 'Échéance'} ${esc(d.dueDate)} · ${en ? 'Period' : 'Période'} ${esc(d.periodStart)} → ${esc(d.periodEnd)}</p>
<div class="box"><strong>${esc(d.customer.legalName)}</strong><br>NINEA ${esc(d.customer.ninea ?? '—')} · RCCM ${esc(d.customer.rccm ?? '—')}<br>${esc(d.customer.address ?? '')}</div>
<table><thead><tr><th>${en ? 'Description' : 'Désignation'}</th><th class="r">${en ? 'Qty' : 'Qté'}</th><th class="r">${en ? 'Unit price (XOF)' : 'Prix unitaire (FCFA)'}</th><th class="r">${en ? 'Amount (XOF)' : 'Montant (FCFA)'}</th></tr></thead><tbody>${rows}</tbody></table>
<table><tbody>
<tr><td>${en ? 'Total excl. VAT' : 'Total HT'}</td><td class="r">${nf.format(d.amountXof)}</td></tr>
<tr><td>${en ? 'VAT' : 'TVA'} ${nf.format(d.vatBps / 100)} %</td><td class="r">${nf.format(d.taxXof)}</td></tr>
<tr><td><strong>${en ? 'Total incl. VAT' : 'Total TTC'}</strong></td><td class="r"><strong>${nf.format(d.totalXof)}</strong></td></tr>
</tbody></table>
<p>${en ? 'This invoice amounts to' : 'Arrêtée la présente facture à la somme de'} ${nf.format(d.totalXof)} FCFA.</p>
</body></html>`;
}
