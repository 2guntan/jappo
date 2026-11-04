import { sql } from 'drizzle-orm';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app';
import { createContext } from '../src/context-factory';
import { loadEnv, resetEnvCache } from '../src/env';
import type { ModuleContext } from '../src/core/module';
import { runSeed } from '../src/seed';
import { generateTotp } from '../src/core/auth/totp';
import { deliverPendingNotifications } from '../src/core/notify';
import type { ConsoleSms } from '../src/core/adapters/sms';
import type { MemoryEmail } from '../src/core/adapters/email';
import type pg from 'pg';

export interface TestApp {
  app: FastifyInstance;
  ctx: ModuleContext;
  pool: pg.Pool;
  sms: ConsoleSms;
  email: MemoryEmail;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestApp> {
  resetEnvCache();
  const { ctx, pool } = createContext(loadEnv(), 5);
  const app = await buildApp({ ctx, logger: process.env.TEST_LOG ? { level: 'error' } : false });
  await app.ready();
  return {
    app,
    ctx,
    pool,
    sms: ctx.sms as ConsoleSms,
    email: ctx.email as MemoryEmail,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

/** Truncate all application tables and reseed reference data + platform admin. */
export async function resetDb(t: TestApp): Promise<void> {
  const r = await t.ctx.db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' and tablename not in ('spatial_ref_sys')`,
  );
  const names = r.rows.map((x) => `"${x.tablename}"`).join(', ');
  if (names) await t.ctx.db.execute(sql.raw(`truncate ${names} restart identity cascade`));
  t.sms.sent.length = 0;
  t.email.outbox.length = 0;
  await runSeed(t.ctx);
}

export interface Session {
  token: string;
  orgId?: string;
  cookies: Record<string, string>;
  csrf: string;
}

export const ADMIN_EMAIL = 'admin@jappo.local';
export const ADMIN_PASSWORD = 'Jappo-Admin-2026!';
export const ADMIN_TOTP = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
export const PASSWORD = 'Kawral-Secure-Pass-2026';

export function cookiesOf(res: LightMyRequestResponse): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of res.cookies) out[c.name] = c.value;
  return out;
}

export function json<T = Record<string, unknown>>(res: LightMyRequestResponse): T {
  return res.json() as T;
}

export function expectStatus(res: LightMyRequestResponse, status: number): void {
  if (res.statusCode !== status) {
    throw new Error(`Expected HTTP ${status}, got ${res.statusCode}: ${res.body}`);
  }
}

export const auth = (s: Session, extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${s.token}`,
  ...(s.orgId ? { 'x-org-id': s.orgId } : {}),
  ...extra,
});

export async function signup(t: TestApp, overrides: Record<string, unknown> = {}): Promise<Session> {
  const body = {
    orgType: 'operator',
    legalName: 'Ferme Commune Kawral SARL',
    legalForm: 'SARL',
    fullName: 'Awa Diallo',
    email: `user${Math.random().toString(36).slice(2, 8)}@kawral.test`,
    password: PASSWORD,
    locale: 'fr',
    ...overrides,
  };
  const res = await t.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: body });
  expectStatus(res, 201);
  const tok = json<{ accessToken: string; csrfToken: string }>(res);
  const me = await t.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${tok.accessToken}` } });
  const orgId = json<{ activeOrgId: string }>(me).activeOrgId;
  return { token: tok.accessToken, orgId, cookies: cookiesOf(res), csrf: tok.csrfToken };
}

export async function login(t: TestApp, email: string, password: string, totp?: string): Promise<Session> {
  const res = await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password, totp } });
  expectStatus(res, 200);
  const tok = json<{ accessToken: string; csrfToken: string }>(res);
  return { token: tok.accessToken, cookies: cookiesOf(res), csrf: tok.csrfToken };
}

export async function adminSession(t: TestApp): Promise<Session> {
  const s = await login(t, ADMIN_EMAIL, ADMIN_PASSWORD, generateTotp(ADMIN_TOTP));
  const me = await t.app.inject({ method: 'GET', url: '/v1/me', headers: auth(s) });
  s.orgId = json<{ activeOrgId: string }>(me).activeOrgId;
  return s;
}

/** Minimal valid PDF bytes for upload tests. */
export const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

export function multipartBody(fields: Record<string, string>, file: { name: string; content: Buffer; type?: string }) {
  const boundary = `----jappo${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type ?? 'application/octet-stream'}\r\n\r\n`),
    file.content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

export async function uploadKyc(t: TestApp, s: Session, docType: string) {
  const mp = multipartBody({ docType }, { name: `${docType}.pdf`, content: PDF_BYTES, type: 'application/pdf' });
  const res = await t.app.inject({ method: 'POST', url: '/v1/orgs/current/kyc-documents', headers: { ...auth(s), ...mp.headers }, payload: mp.payload });
  expectStatus(res, 201);
  return json<{ id: string; fileId: string }>(res);
}

export async function verifiedOrg(t: TestApp, overrides: Record<string, unknown> = {}): Promise<Session> {
  const s = await signup(t, overrides);
  const type = (overrides.orgType as string) ?? 'operator';
  for (const d of type === 'lender' ? ['ninea', 'rccm', 'approval_bceao'] : ['ninea', 'rccm']) await uploadKyc(t, s, d);
  expectStatus(await t.app.inject({ method: 'POST', url: '/v1/orgs/current/actions/submit-kyc', headers: auth(s) }), 200);
  const admin = await adminSession(t);
  expectStatus(await t.app.inject({ method: 'POST', url: `/v1/admin/orgs/${s.orgId}/kyc/actions/verify`, headers: auth(admin), payload: {} }), 200);
  return s;
}

export const flushNotifications = (t: TestApp) => deliverPendingNotifications(t.ctx);
export { generateTotp };

/** ~10 ha rectangle near Ziguinchor (500 m × 200 m). */
export function rectangle(lon = -16.27, lat = 12.58, widthM = 500, heightM = 200) {
  const dLon = widthM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const dLat = heightM / 110_600;
  return {
    type: 'Polygon' as const,
    coordinates: [[[lon, lat], [lon + dLon, lat], [lon + dLon, lat + dLat], [lon, lat + dLat], [lon, lat]]],
  };
}

export async function createBlock(t: TestApp, s: Session, overrides: Record<string, unknown> = {}) {
  const res = await t.app.inject({ method: 'POST', url: '/v1/blocks', headers: auth(s), payload: { name: 'Bloc de Niaguis', region: 'Ziguinchor', commune: 'Niaguis', tenureType: 'deliberation', ...overrides } });
  expectStatus(res, 201);
  return json<{ id: string; ref: string; version: number; status: string }>(res);
}

export async function setBoundary(t: TestApp, s: Session, blockId: string, geometry = rectangle()) {
  const cur = await t.app.inject({ method: 'GET', url: `/v1/blocks/${blockId}`, headers: auth(s) });
  const res = await t.app.inject({ method: 'PUT', url: `/v1/blocks/${blockId}/boundary`, headers: auth(s, { 'if-match': cur.headers.etag as string }), payload: { geometry } });
  expectStatus(res, 200);
  return json<{ areaHa: number; version: number }>(res);
}

export async function createFarmer(t: TestApp, s: Session, overrides: Record<string, unknown> = {}) {
  const res = await t.app.inject({
    method: 'POST',
    url: '/v1/farmers',
    headers: auth(s),
    payload: { firstName: 'Awa', lastName: 'Diatta', sex: 'F', consentData: true, consentCreditBureau: true, ...overrides },
  });
  expectStatus(res, 201);
  return json<{ id: string; code: string; version: number }>(res);
}
