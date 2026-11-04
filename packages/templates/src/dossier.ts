import Handlebars from 'handlebars';
import frLabels from '../fr/dossier.json';
import enLabels from '../en/dossier.json';
import { svgBars, svgLine, svgMap } from './svg';

const hb = Handlebars.create();
const fmt = (n: unknown, locale: string) => (typeof n === 'number' ? new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'fr-SN', { maximumFractionDigits: 2 }).format(n) : '—');
hb.registerHelper('num', (n: unknown, opts: { data: { root: { locale: string } } }) => fmt(n, opts.data.root.locale));
hb.registerHelper('xof', (n: unknown, opts: { data: { root: { locale: string } } }) => (typeof n === 'number' ? `${fmt(n, opts.data.root.locale)} FCFA` : '—'));
hb.registerHelper('lookupLabel', (obj: Record<string, string>, key: string) => obj?.[key] ?? key);
hb.registerHelper('cropName', (c: { fr: string; en: string } | undefined, opts: { data: { root: { locale: string } } }) => (c ? (opts.data.root.locale === 'en' ? c.en : c.fr) : '—'));

const TEMPLATE = `<!doctype html><html lang="{{locale}}"><head><meta charset="utf-8"><title>{{d.ref}}</title>
<style>
@page { size: A4; margin: 16mm 14mm 18mm; }
body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 10pt; color: #1f2937; }
h1 { color: #133f27; font-size: 20pt; margin: 0 0 4pt; } h2 { color: #23804a; font-size: 13pt; border-bottom: 1px solid #d8f3e1; padding-bottom: 3pt; margin: 16pt 0 6pt; }
table { width: 100%; border-collapse: collapse; margin: 4pt 0; } th, td { text-align: left; padding: 3pt 4pt; border-bottom: 1px solid #e5e7eb; font-size: 9pt; } th { background: #f3f4f6; }
.cover { display: flex; justify-content: space-between; align-items: flex-start; } .grade { font-size: 36pt; font-weight: bold; color: #23804a; text-align: center; }
.muted { color: #6b7280; font-size: 8pt; } .ok { color: #15803d; } .ko { color: #b91c1c; } .page { page-break-before: always; }
</style></head><body>
<div class="cover"><div><h1>{{L.title}}</h1><div>{{d.ref}} · {{L.version}} {{d.version}} · {{L.frozen}} {{d.frozenAt}}</div><div><strong>{{s.block.name}}</strong> ({{s.block.ref}}) — {{s.season.name}}</div></div>
<div><div class="grade">{{d.grade}}</div><div>{{L.score}} : <strong>{{d.score}}/100</strong></div></div></div>
<h2>{{L.summary}}</h2>
<table><tr><th>{{L.region}}</th><td>{{s.block.village}} {{s.block.commune}} — {{s.block.region}}</td><th>{{L.area}}</th><td>{{num s.block.areaHa}} ha</td></tr>
<tr><th>{{L.tenure}}</th><td>{{s.block.tenureType}}</td><th>{{L.irrigation}}</th><td>{{s.block.irrigationType}} / {{s.block.waterSource}}</td></tr>
<tr><th>{{L.farmers}}</th><td>{{s.farmers.count}} ({{L.women}} {{s.farmers.women}}, {{L.youth}} {{s.farmers.youth}})</td><th>{{L.wallets}}</th><td>{{s.farmers.walletVerified}} / {{s.farmers.count}}</td></tr></table>
<h2>{{L.map}}</h2>{{{mapSvg}}}
<h2>{{L.plan}}</h2><table><tr><th>{{L.crop}}</th><th>ha</th><th>{{L.yieldBase}}</th><th>{{L.yieldStress}}</th><th>{{L.priceBase}}</th><th>{{L.priceStress}}</th></tr>
{{#each s.plan}}<tr><td>{{cropName crop}}</td><td>{{num areaHa}}</td><td>{{num yieldBaseTHa}}</td><td>{{num yieldStressTHa}}</td><td>{{xof priceXofPerKgBase}}</td><td>{{xof priceXofPerKgStress}}</td></tr>{{/each}}</table>
<h2>{{L.budget}}</h2><table><tr><th>{{L.farmerCredit}}</th><th>{{L.farmerCash}}</th><th>{{L.operator}}</th><th>{{L.grant}}</th><th>{{L.perHa}}</th><th>{{L.quoted}}</th></tr>
<tr><td>{{xof s.budget.totals.farmer_credit}}</td><td>{{xof s.budget.totals.farmer_cash}}</td><td>{{xof s.budget.totals.operator}}</td><td>{{xof s.budget.totals.grant}}</td><td>{{xof s.budget.perHaXof}}</td><td>{{num s.budget.quotedSharePct}} %</td></tr></table>
<h2>{{L.offtake}}</h2><table><tr><th>Ref</th><th>{{L.buyer}}</th><th>{{L.crop}}</th><th>{{L.minVolume}}</th><th>{{L.price}}</th><th>{{L.status}}</th><th>{{L.escrow}}</th></tr>
{{#each s.offtake}}<tr><td>{{ref}}</td><td>{{buyer}}</td><td>{{cropName crop}}</td><td>{{num minVolumeKg}} kg</td><td>{{xof priceXofPerKg}}</td><td>{{status}}</td><td>{{#if paysIntoEscrow}}✔{{else}}—{{/if}}</td></tr>{{/each}}</table>
<div class="page"></div><h2>{{L.model}}</h2><table><tr><th>{{L.scenario}}</th><th>{{L.revenue}}</th><th>{{L.debt}}</th><th>{{L.hcr}}</th><th>{{L.dscr}}</th><th>{{L.npv}}</th></tr>
{{#each scenarioRows}}<tr><td>{{label}}</td><td>{{xof b.grossRevenueXof}}</td><td>{{xof b.seasonalDebtDueXof}}</td><td>{{num b.hcr}}</td><td>{{num b.minDscr}}</td><td>{{xof b.operatorNpvXof}}</td></tr>{{/each}}</table>
{{{barsSvg}}}
<p>{{L.breakeven}} : {{#each s.model.breakevenYieldByCrop}}{{cropName crop}} {{num yieldTHa}} t/ha {{/each}}</p>
<h2>{{L.cashflow}}</h2>{{{cashSvg}}}
<h2>{{L.risk}}</h2><table><tr><th>Type</th><th>{{L.provider}}</th><th>{{L.coverage}}</th><th>{{L.status}}</th></tr>{{#each s.riskCovers}}<tr><td>{{type}}</td><td>{{providerName}}</td><td>{{num coveragePct}} %</td><td>{{status}}</td></tr>{{/each}}</table>
<h2>{{L.gates}}</h2><table>{{#each d.gates}}<tr><td>{{code}}</td><td>{{#if pass}}<span class="ok">{{../L.pass}}</span>{{else}}<span class="ko">{{../L.fail}}</span>{{/if}}</td></tr>{{/each}}</table>
<h2>{{L.breakdownTitle}}</h2><table>{{#each breakdownRows}}<tr><td>{{label}}</td><td>{{num value}}</td></tr>{{/each}}</table>
<h2>{{L.dataRoom}}</h2><table>{{#each d.dataRoom}}<tr><td>{{category}}</td><td>{{label}}</td><td>{{filename}}</td></tr>{{/each}}</table>
<p class="muted">{{L.hash}} : {{d.contentSha256}}</p><p class="muted">{{L.disclaimer}}</p>
</body></html>`;

const compiled = hb.compile(TEMPLATE);

export interface DossierRenderInput {
  ref: string;
  version: number;
  frozenAt: string;
  grade: string;
  score: number;
  contentSha256: string;
  gates: { code: string; pass: boolean }[];
  breakdown: Record<string, number>;
  dataRoom: { label: string; category: string; filename?: string }[];
  snapshot: Record<string, unknown> & {
    block: { boundary: unknown; plots: { code: string; geometry: unknown }[] };
    model: { scenarios: Record<string, { grossRevenueXof: number; seasonalDebtDueXof: number }>; cashflow: { cumulativeXof: number }[] };
  };
}

/** Render the dossier PDF HTML (SPEC §14.1) in fr or en. */
export function renderDossierHtml(d: DossierRenderInput, locale: string): string {
  const L = locale === 'en' ? enLabels : frLabels;
  const s = d.snapshot;
  const scenarioRows = Object.entries(s.model.scenarios).map(([k, b]) => ({ label: (L.scenarios as Record<string, string>)[k] ?? k, b }));
  return compiled({
    locale: locale === 'en' ? 'en' : 'fr',
    L,
    d,
    s,
    mapSvg: svgMap(s.block.boundary as never, s.block.plots as never),
    barsSvg: svgBars(scenarioRows.map((r) => ({ label: r.label, a: r.b.grossRevenueXof, b: r.b.seasonalDebtDueXof })), [L.revenue, L.debt]),
    cashSvg: svgLine(s.model.cashflow.map((c) => c.cumulativeXof)),
    scenarioRows,
    breakdownRows: Object.entries(d.breakdown).map(([k, v]) => ({ label: (L.components as Record<string, string>)[k] ?? k, value: v })),
  });
}
