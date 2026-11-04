import Handlebars from 'handlebars';

const hb = Handlebars.create();
const nf = (locale: string) => new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'fr-SN', { maximumFractionDigits: 2 });
type Opts = { data: { root: { locale?: string } } };
hb.registerHelper('xof', (n: unknown, o: Opts) => (typeof n === 'number' ? `${nf(o.data.root.locale ?? 'fr').format(n)} FCFA` : '—'));
hb.registerHelper('bps', (n: unknown, o: Opts) => (typeof n === 'number' ? `${nf(o.data.root.locale ?? 'fr').format(n / 100)} %` : '—'));

export interface ContractSignatureView {
  roleLabel: string;
  partyName: string;
  signerName: string | null;
  method: string | null;
  signedAt: string | null;
  contentSha256: string | null;
}

/** Render the contract body (template text + data). HTML-escaped values; the template itself is trusted admin content. */
export function renderContractBody(bodyHbs: string, data: Record<string, unknown>, locale: string): string {
  return hb.compile(bodyHbs, { strict: false })({ ...data, locale });
}

const L = {
  fr: { signatures: 'Signatures', party: 'Partie', signer: 'Signataire', method: 'Méthode', at: 'Date', pending: 'En attente', hash: 'Empreinte SHA-256 du contenu', draft: 'PROJET — non signé' },
  en: { signatures: 'Signatures', party: 'Party', signer: 'Signer', method: 'Method', at: 'Date', pending: 'Pending', hash: 'Content SHA-256', draft: 'DRAFT — not signed' },
};

/** Full printable HTML: body, signature page (with evidence), footer with content hash. */
export function renderContractHtml(input: { ref: string; title: string; bodyHtml: string; contentSha256: string | null; status: string; signatures: ContractSignatureView[] }, locale: string): string {
  const l = locale === 'en' ? L.en : L.fr;
  const esc = Handlebars.Utils.escapeExpression;
  const rows = input.signatures
    .map((s) => `<tr><td>${esc(s.roleLabel)} — ${esc(s.partyName)}</td><td>${esc(s.signerName ?? l.pending)}</td><td>${esc(s.method ?? '—')}</td><td>${esc(s.signedAt ?? '—')}</td></tr>`)
    .join('');
  return `<!doctype html><html lang="${esc(locale)}"><head><meta charset="utf-8"><title>${esc(input.ref)}</title>
<style>
@page { size: A4; margin: 18mm 16mm 20mm; }
body { font-family: Georgia, 'Times New Roman', serif; font-size: 10.5pt; color: #111827; line-height: 1.45; }
h1 { font-size: 17pt; color: #133f27; margin: 0 0 4pt; } h2 { font-size: 11.5pt; margin: 14pt 0 4pt; color: #133f27; }
.ref { color: #6b7280; font-size: 9pt; } table { width: 100%; border-collapse: collapse; margin: 6pt 0; }
th, td { text-align: left; border-bottom: 1px solid #e5e7eb; padding: 3pt 4pt; font-size: 9pt; } th { background: #f3f4f6; }
.draft { color: #b91c1c; font-weight: bold; letter-spacing: 1px; } .sig { page-break-before: always; } footer { margin-top: 18pt; color: #6b7280; font-size: 8pt; word-break: break-all; }
</style></head><body>
${input.status === 'draft' ? `<p class="draft">${l.draft}</p>` : ''}
${input.bodyHtml}
<section class="sig"><h2>${l.signatures}</h2>
<table><thead><tr><th>${l.party}</th><th>${l.signer}</th><th>${l.method}</th><th>${l.at}</th></tr></thead><tbody>${rows}</tbody></table></section>
<footer>${esc(input.ref)} · ${l.hash}: ${esc(input.contentSha256 ?? '—')}</footer>
</body></html>`;
}
