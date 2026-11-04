import { expect, type Page } from '@playwright/test';
import pg from 'pg';
import { Secret, TOTP } from 'otpauth';

const PG = process.env.E2E_PG_URL ?? 'postgres://jappo:jappo@localhost:5432';
export const ADMIN = { email: 'admin@jappo.local', password: 'Jappo-Admin-2026!', totp: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP' };
export const PASSWORD = 'Kawral-Secure-Pass-2026';

export const totp = (secret: string) => new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30 }).generate();

/** Query the e2e database (to read links that would arrive by email/SMS). */
export async function dbQuery<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: `${PG}/jappo_e2e` });
  await c.connect();
  try {
    return (await c.query(text, params)).rows as T[];
  } finally {
    await c.end();
  }
}

export async function latestLinkToken(destination: string, template: string): Promise<string> {
  const rows = await dbQuery<{ body: string }>(
    'select body from notifications where destination = $1 and template_code = $2 order by id desc limit 1',
    [destination, template],
  );
  const m = /token=([A-Za-z0-9_-]+)/.exec(rows[0]?.body ?? '');
  if (!m) throw new Error(`no ${template} link for ${destination}`);
  return m[1]!;
}

export async function login(page: Page, email: string, password: string, totpSecret?: string) {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('form button[type=submit]').click();
  if (totpSecret) {
    await expect(page.locator('#totp')).toBeVisible();
    await page.locator('#totp').fill(totp(totpSecret));
    await page.locator('form button[type=submit]').click();
  }
  await page.waitForURL(/\/app/);
}

export async function logout(page: Page) {
  await page.getByRole('button', { name: /déconnecter|log out/i }).click();
  await page.waitForURL(/\/login/);
}

export const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n') });

export async function signupOperator(page: Page, email: string, legalName = 'Ferme Commune Kawral SARL') {
  await page.goto('/signup?type=operator');
  await page.locator('#legalName').fill(legalName);
  await page.locator('#fullName').fill('Awa Diallo');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('form button[type=submit]').click();
  await page.waitForURL('**/app');
}

/** ~10 ha rectangle near Ziguinchor (500 m × 200 m) as a GeoJSON FeatureCollection file. */
export function boundaryFile(lon = -16.27, lat = 12.58, widthM = 500, heightM = 200) {
  const dLon = widthM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const dLat = heightM / 110_600;
  const geometry = { type: 'Polygon', coordinates: [[[lon, lat], [lon + dLon, lat], [lon + dLon, lat + dLat], [lon, lat + dLat], [lon, lat]]] };
  return { name: 'bloc.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry }] })) };
}

export function farmersCsv(n: number, phonePrefix = '+22177100') {
  const header = 'first_name,last_name,sex,birth_year,phone,village,national_id_number,mobile_wallet_provider,mobile_wallet_number,consent_data,consent_credit_bureau';
  const first = ['Awa', 'Fatou', 'Mariama', 'Aminata', 'Khady', 'Ndeye', 'Aïssatou', 'Seynabou', 'Coumba', 'Binta'];
  const last = ['Diatta', 'Sané', 'Badji', 'Coly', 'Sagna', 'Manga', 'Bassène', 'Diédhiou', 'Goudiaby', 'Tendeng'];
  const rows = Array.from({ length: n }, (_, i) => {
    const phone = `${phonePrefix}${String(i + 1).padStart(4, '0')}`;
    return `${first[i % 10]},${last[Math.floor(i / 2) % 10]},F,${1975 + i},${phone},Niaguis,17511990${String(i + 1).padStart(5, '0')},wave,${phone},oui,oui`;
  });
  return { name: 'farmers.csv', mimeType: 'text/csv', buffer: Buffer.from([header, ...rows].join('\n')) };
}

export const API = 'http://localhost:4100';
import type { APIRequestContext } from '@playwright/test';

/** Thin API client for e2e setup steps (the UI under test is exercised separately). */
export class E2eApi {
  constructor(
    private request: APIRequestContext,
    public token = '',
    public orgId = '',
  ) {}
  private headers(extra: Record<string, string> = {}) {
    return { ...(this.token ? { authorization: `Bearer ${this.token}` } : {}), ...(this.orgId ? { 'x-org-id': this.orgId } : {}), ...extra };
  }
  async call<T = Record<string, unknown>>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, data?: unknown, extra: Record<string, string> = {}): Promise<T> {
    const r = await this.request.fetch(`${API}${path}`, { method, data: data as never, headers: this.headers(extra) });
    if (!r.ok()) throw new Error(`${method} ${path} → ${r.status()} ${await r.text()}`);
    return (await r.json()) as T;
  }
  async upload(path: string, fields: Record<string, string>, file: { name: string; mimeType: string; buffer: Buffer }) {
    const r = await this.request.fetch(`${API}${path}`, { method: 'POST', headers: this.headers(), multipart: { ...fields, file } });
    if (!r.ok()) throw new Error(`upload ${path} → ${r.status()} ${await r.text()}`);
    return (await r.json()) as { id: string };
  }
  async me() {
    const m = await this.call<{ activeOrgId: string }>('GET', '/v1/me');
    this.orgId = m.activeOrgId;
    return m;
  }
  static async signup(request: APIRequestContext, body: Record<string, unknown>) {
    const a = new E2eApi(request);
    const r = await a.call<{ accessToken: string }>('POST', '/v1/auth/signup', { legalForm: 'SARL', fullName: 'Demo User', password: PASSWORD, locale: 'fr', ...body });
    a.token = r.accessToken;
    await a.me();
    return a;
  }
  static async login(request: APIRequestContext, email: string, password: string, totpSecret?: string) {
    const a = new E2eApi(request);
    const r = await a.call<{ accessToken: string }>('POST', '/v1/auth/login', { email, password, ...(totpSecret ? { totp: totp(totpSecret) } : {}) });
    a.token = r.accessToken;
    await a.me();
    return a;
  }
}

/** Sign up an org through the API and get it KYC-verified by the platform admin. */
export async function verifiedOrgViaApi(request: APIRequestContext, body: Record<string, unknown>) {
  const a = await E2eApi.signup(request, body);
  const docs = body.orgType === 'lender' ? ['ninea', 'rccm', 'approval_bceao'] : ['ninea', 'rccm'];
  for (const d of docs) await a.upload('/v1/orgs/current/kyc-documents', { docType: d }, pdf(`${d}.pdf`));
  await a.call('POST', '/v1/orgs/current/actions/submit-kyc');
  const admin = await E2eApi.login(request, ADMIN.email, ADMIN.password, ADMIN.totp);
  await admin.call('POST', `/v1/admin/orgs/${a.orgId}/kyc/actions/verify`, {});
  return a;
}
