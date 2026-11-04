import Handlebars from 'handlebars';
import fr from '../fr/notifications.json';
import en from '../en/notifications.json';

export type TemplateLocale = 'fr' | 'en';
export interface NotificationTemplate {
  title: string;
  subject?: string;
  body?: string;
  sms?: string;
}

const CATALOG: Record<TemplateLocale, Record<string, NotificationTemplate>> = { fr, en };
const hb = Handlebars.create();
const cache = new Map<string, HandlebarsTemplateDelegate>();

const compile = (src: string): HandlebarsTemplateDelegate => {
  let t = cache.get(src);
  if (!t) {
    t = hb.compile(src, { noEscape: true, strict: false });
    cache.set(src, t);
  }
  return t;
};

export const notificationCodes = (): string[] => Object.keys(CATALOG.fr);

export interface RenderedNotification {
  title: string;
  subject: string;
  body: string;
  sms: string;
}

/** Render a notification template (fr default; unknown locales such as `wo` fall back to fr). */
export function renderNotification(code: string, locale: string, data: Record<string, unknown>): RenderedNotification {
  const loc: TemplateLocale = locale === 'en' ? 'en' : 'fr';
  const t = CATALOG[loc][code] ?? CATALOG.fr[code];
  if (!t) throw new Error(`Unknown notification template ${code}`);
  const title = compile(t.title)(data);
  const body = t.body ? compile(t.body)(data) : t.sms ? compile(t.sms)(data) : title;
  return {
    title,
    subject: t.subject ? compile(t.subject)(data) : title,
    body,
    sms: t.sms ? compile(t.sms)(data) : body.slice(0, 300),
  };
}

/** Render an arbitrary Handlebars template string (contracts, PDFs). */
export function renderString(src: string, data: unknown): string {
  return hb.compile(src, { strict: false })(data);
}
export { renderDossierHtml, type DossierRenderInput } from './dossier';
export { svgMap, svgBars, svgLine } from './svg';
export { renderContractBody, renderContractHtml, type ContractSignatureView } from './contract';
export { CONTRACT_CODES, CONTRACT_TEMPLATE_SEEDS, type ContractCode, type ContractTemplateSeed } from './contract-seeds';
export { renderBuyerInvoiceHtml, type BuyerInvoiceRenderInput } from './invoice';
export { renderFarmerStatementHtml, type FarmerStatementInput } from './statement';
export { renderReportHtml, type ReportRenderInput } from './report';
