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

export interface ReadyScenario {
  op: Session;
  admin: Session;
  buyer: Session;
  blockId: string;
  seasonId: string;
  plots: { id: string; code: string; areaHa: number }[];
  farmers: { id: string; code: string }[];
  offtakeId: string;
}

/**
 * A block whose season passes every readiness gate (P4+): verified operator & buyer, verified
 * deliberation + prefect approval + community agreement, 3 plots / 3 KYC-verified farmers,
 * maize with credits 1 200 000 / 1 000 000 / 800 000, fees 100 000/ha + 50 000/farmer,
 * signed escrow offtake at 250 XOF/kg, seasonal tranche assumption 18 % flat 6 months bullet.
 */
export async function readyScenario(t: TestApp, opts: { yieldBase?: number; yieldStress?: number } = {}): Promise<ReadyScenario> {
  const op = await verifiedOrg(t, { email: `op${Math.random().toString(36).slice(2, 7)}@kawral.test` });
  const buyer = await verifiedOrg(t, { orgType: 'buyer', legalName: 'Agro-Négoce Zeta SA', legalForm: 'SA', email: `buyer${Math.random().toString(36).slice(2, 7)}@zeta.test` });
  const admin = await adminSession(t);
  const block = await createBlock(t, op, { irrigationType: 'drip', waterSource: 'borehole' });
  await setBoundary(t, op, block.id);
  for (const docType of ['deliberation', 'approval_prefect', 'community_agreement']) {
    const mp = multipartBody({}, { name: `${docType}.pdf`, content: PDF_BYTES });
    const f = json<{ id: string }>(await t.app.inject({ method: 'POST', url: '/v1/files', headers: { ...auth(op), ...mp.headers }, payload: mp.payload }));
    const d = await t.app.inject({ method: 'POST', url: `/v1/blocks/${block.id}/land-documents`, headers: auth(op), payload: { docType, fileId: f.id, number: `${docType}-1` } });
    expectStatus(d, 201);
    expectStatus(await t.app.inject({ method: 'POST', url: `/v1/admin/land-documents/${d.json().id}/actions/verify`, headers: auth(admin), payload: {} }), 200);
  }
  const plots: ReadyScenario['plots'] = [];
  for (let i = 0; i < 3; i++) {
    const p = await t.app.inject({ method: 'POST', url: `/v1/blocks/${block.id}/plots`, headers: auth(op), payload: { geometry: rectangle(-16.2699 + i * 0.001, 12.5801, 100, 100), soilType: 'sablo-argileux' } });
    expectStatus(p, 201);
    plots.push(p.json());
  }
  const farmers: ReadyScenario['farmers'] = [];
  for (let i = 0; i < 3; i++) {
    const f = await createFarmer(t, op, { firstName: ['Awa', 'Fatou', 'Mariama'][i], phone: `+2217720000${i}0`, nationalIdType: 'cni', nationalIdNumber: `17511990000${i}0`, mobileWalletProvider: 'wave', mobileWalletNumber: `+2217720000${i}0` });
    expectStatus(await t.app.inject({ method: 'POST', url: `/v1/farmers/${f.id}/actions/verify-kyc`, headers: auth(op, { 'if-match': '"1"' }) }), 200);
    expectStatus(await t.app.inject({ method: 'POST', url: `/v1/plots/${plots[i]!.id}/allocations`, headers: auth(op), payload: { farmerId: f.id } }), 201);
    farmers.push(f);
  }
  const season = json<{ id: string }>(await t.app.inject({ method: 'POST', url: `/v1/blocks/${block.id}/seasons`, headers: auth(op), payload: { name: 'Contre-saison 2026-27', kind: 'cold_dry', startDate: '2026-11-15', endDate: '2027-04-30' } }));
  const crops = json<{ data: { id: string; code: string }[] }>(await t.app.inject({ method: 'GET', url: '/v1/crops', headers: auth(op) })).data;
  const maize = crops.find((c) => c.code === 'maize')!;
  expectStatus(await t.app.inject({ method: 'POST', url: `/v1/seasons/${season.id}/plantings/actions/bulk-assign`, headers: auth(op), payload: { cropId: maize.id, plotIds: plots.map((p) => p.id), plannedHarvestDate: '2027-03-15' } }), 201);
  if (opts.yieldBase !== undefined) {
    const pl = json<{ data: { id: string; version: number }[] }>(await t.app.inject({ method: 'GET', url: `/v1/seasons/${season.id}/plantings`, headers: auth(op) })).data;
    for (const p of pl) expectStatus(await t.app.inject({ method: 'PATCH', url: `/v1/plantings/${p.id}`, headers: auth(op, { 'if-match': `"${p.version}"` }), payload: { yieldBaseTHa: opts.yieldBase, yieldStressTHa: opts.yieldStress ?? opts.yieldBase * 0.8 } }), 200);
  }
  const svc = json<{ data: { id: string; code: string }[] }>(await t.app.inject({ method: 'GET', url: '/v1/services', headers: auth(op) })).data.find((s) => s.code === 'npk_15_15_15')!;
  for (const [i, amount] of [1_200_000, 1_000_000, 800_000].entries()) {
    expectStatus(await t.app.inject({ method: 'POST', url: `/v1/seasons/${season.id}/budget-lines`, headers: auth(op), payload: { scope: 'plot', plotId: plots[i]!.id, serviceId: svc.id, qty: 1, unitPriceXof: amount, payer: 'farmer_credit' } }), 201);
  }
  expectStatus(await t.app.inject({ method: 'PUT', url: `/v1/blocks/${block.id}/fee-policy`, headers: auth(op), payload: { operatorServiceFeeXofPerFarmerSeason: 50000, landFeeXofPerHaSeason: 0, investmentRecoveryFeeXofPerHaSeason: 100000 } }), 200);
  const o = await t.app.inject({ method: 'POST', url: '/v1/offtake-contracts', headers: auth(op), payload: { blockId: block.id, buyerOrgId: buyer.orgId, cropId: maize.id, minVolumeKg: 15000, maxVolumeKg: 25000, priceType: 'fixed', priceXofPerKg: 250, paymentTermsDays: 30, paysIntoEscrow: true } });
  expectStatus(o, 201);
  expectStatus(await t.app.inject({ method: 'POST', url: `/v1/offtake-contracts/${o.json().id}/actions/mark-signed`, headers: auth(op, { 'if-match': '"1"' }), payload: {} }), 200);
  expectStatus(await t.app.inject({ method: 'PUT', url: `/v1/seasons/${season.id}/model-assumptions`, headers: auth(op), payload: { seasonal: { rateBps: 1800, rateMethod: 'flat', upfrontFeeBps: 100, tenorMonths: 6, repaymentProfile: 'bullet', feesChargedTo: 'operator', borrowerType: 'farmers' }, investment: null } }), 200);
  return { op, admin, buyer, blockId: block.id, seasonId: season.id, plots, farmers, offtakeId: o.json().id };
}

/**
 * A KYC-verified lender whose user holds org_admin + credit_officer + credit_committee (MFA enrolled).
 * Returns the session (MFA token) and the TOTP secret.
 */
export async function verifiedLender(t: TestApp, name: string, kind: 'sfd' | 'bank' | 'dfi' | 'fund' = 'sfd') {
  const email = `${name.toLowerCase().replace(/[^a-z]/g, '')}${Math.random().toString(36).slice(2, 6)}@lender.test`;
  const s = await verifiedOrg(t, { orgType: 'lender', lenderKind: kind, legalName: name, legalForm: kind === 'bank' ? 'SA' : 'mutuelle', email });
  const me = json<{ user: { id: string } }>(await t.app.inject({ method: 'GET', url: '/v1/me', headers: auth(s) }));
  expectStatus(await t.app.inject({ method: 'PATCH', url: `/v1/orgs/current/members/${me.user.id}`, headers: auth(s), payload: { roles: ['org_admin', 'credit_officer', 'credit_committee'] } }), 200);
  const enrol = json<{ secret: string }>(await t.app.inject({ method: 'POST', url: '/v1/auth/mfa/enroll', headers: auth(s) }));
  const act = await t.app.inject({ method: 'POST', url: '/v1/auth/mfa/activate', headers: auth(s), payload: { code: generateTotp(enrol.secret) } });
  expectStatus(act, 200);
  return { ...s, token: act.json().accessToken as string, totpSecret: enrol.secret, email };
}

export async function lenderProfile(t: TestApp, s: Session, body: Record<string, unknown>) {
  const r = await t.app.inject({ method: 'POST', url: '/v1/lender-profiles', headers: auth(s), payload: { name: 'Profil', minTicketXof: 500_000, maxTicketXof: 50_000_000, maxTenorMonths: 12, trancheTypes: ['seasonal'], ...body } });
  expectStatus(r, 201);
  return json<{ id: string }>(r);
}

/** Minimal PNG (signature + IHDR) accepted by the MIME sniffer, used as signing-photo evidence. */
export const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b10000000049454e44ae426082', 'hex');

/** Invite a member into the session's organisation and log them in. */
export async function inviteMember(t: TestApp, s: Session, roles: string[], name = 'Second Membre') {
  const email = `m${Math.random().toString(36).slice(2, 8)}@member.test`;
  expectStatus(await t.app.inject({ method: 'POST', url: '/v1/orgs/current/invitations', headers: auth(s), payload: { email, roles } }), 201);
  await flushNotifications(t);
  const mail = t.email.outbox.find((m) => m.to === email)!;
  const token = /token=([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
  expectStatus(await t.app.inject({ method: 'POST', url: '/v1/invitations/accept', payload: { token, fullName: name, password: PASSWORD } }), 200);
  return { ...(await login(t, email, PASSWORD)), email };
}

/** Latest 6-digit code sent to an email address or phone number (after delivering pending notifications). */
export async function lastCode(t: TestApp, to: string): Promise<string> {
  await flushNotifications(t);
  const texts = [...t.email.outbox.filter((m) => m.to === to).map((m) => m.text), ...t.sms.sent.filter((m) => m.to === to).map((m) => m.text)];
  const code = /(\d{6})/.exec(texts.at(-1) ?? '')?.[1];
  if (!code) throw new Error(`no code sent to ${to}`);
  return code;
}

/**
 * readyScenario + model run + frozen dossier + tender won by "Mutuelle Alpha SFD" (3 000 000 XOF, 18 % flat, 1 % fee,
 * 6 months bullet) and accepted → facility pending_cp.
 */
export async function awardedScenario(t: TestApp) {
  const s = await readyScenario(t, { yieldBase: 7, yieldStress: 6 });
  expectStatus(await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/model-runs`, headers: auth(s.op) }), 201);
  const dossier = json<{ id: string }>(await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/dossiers`, headers: auth(s.op) }));
  const alpha = await verifiedLender(t, 'Mutuelle Alpha SFD', 'sfd');
  await lenderProfile(t, alpha, { name: 'Campagne', minReadinessScore: 40 });
  const fr = json<{ id: string; tranches: { id: string }[] }>(await t.app.inject({ method: 'POST', url: '/v1/financing-requests', headers: auth(s.op), payload: { dossierId: dossier.id } }));
  expectStatus(await t.app.inject({ method: 'POST', url: `/v1/financing-requests/${fr.id}/actions/submit`, headers: auth(s.op, { 'if-match': '"1"' }) }), 200);
  const rfp = json<{ id: string }>(await t.app.inject({ method: 'POST', url: '/v1/rfps', headers: auth(s.op), payload: { financingRequestId: fr.id } }));
  expectStatus(await t.app.inject({ method: 'POST', url: `/v1/rfps/${rfp.id}/actions/open`, headers: auth(s.op, { 'if-match': '"1"' }), payload: {} }), 200);
  const bid = json<{ id: string }>(
    await t.app.inject({
      method: 'POST',
      url: `/v1/rfps/${rfp.id}/bids`,
      headers: auth(alpha),
      payload: { trancheId: fr.tranches[0]!.id, amountXof: 3_000_000, rateBps: 1800, rateMethod: 'flat', upfrontFeeBps: 100, tenorMonths: 6, graceMonths: 0, graceType: 'interest_only', repaymentProfile: 'bullet', securityRequirements: ['escrow_domiciliation'], cashCollateralPct: 0, conditionsPrecedent: ['Signature de la convention-cadre'], daysToDisbursement: 10, validUntil: '2027-06-30', acceptsPartial: true },
    }),
  );
  expectStatus(await t.app.inject({ method: 'POST', url: `/v1/bids/${bid.id}/actions/submit`, headers: auth(alpha, { 'if-match': '"1"' }) }), 200);
  expectStatus(await t.app.inject({ method: 'POST', url: `/v1/rfps/${rfp.id}/actions/close-early`, headers: auth(s.op, { 'if-match': '"2"' }), payload: {} }), 200);
  const closed = json<{ version: number }>(await t.app.inject({ method: 'GET', url: `/v1/rfps/${rfp.id}`, headers: auth(s.op) }));
  expectStatus(await t.app.inject({ method: 'POST', url: `/v1/rfps/${rfp.id}/actions/award`, headers: auth(s.op, { 'if-match': `"${closed.version}"` }), payload: { awards: [{ bidId: bid.id, amountXof: 3_000_000 }] } }), 200);
  const aw = json<{ data: { id: string }[] }>(await t.app.inject({ method: 'GET', url: '/v1/lender/awards', headers: auth(alpha) }));
  expectStatus(await t.app.inject({ method: 'POST', url: `/v1/awards/${aw.data[0]!.id}/actions/accept`, headers: auth(alpha), payload: {} }), 200);
  const facs = json<{ data: { id: string }[] }>(await t.app.inject({ method: 'GET', url: `/v1/facilities?blockId=${s.blockId}`, headers: auth(alpha) }));
  return { ...s, alpha, frId: fr.id, rfpId: rfp.id, facilityId: facs.data[0]!.id };
}
