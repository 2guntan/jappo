import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { activeSeasonScenario, auth, createTestApp, flushNotifications, json, resetDb, settleSeason, signup, verifiedLender, verifiedOrg, wf1Harvest, type TestApp } from '../helpers';
import { notifications } from '../../src/modules/notifications/schema';
import { pdfRenderer } from '../../src/core/adapters/pdf';

/** P11 hardening (SPEC §18.1): rate limits, OTP brute force, code redaction, IDOR sweep. */
describe('rate limits', () => {
  let t: TestApp;
  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = 'true';
    t = await createTestApp();
    await resetDb(t);
  });
  afterAll(async () => {
    await t.close();
    process.env.RATE_LIMIT_ENABLED = 'false';
  });

  it('limits auth to 10 requests per minute per IP and authenticated traffic to 300 per minute per token', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'nobody@kawral.test', password: 'Wrong-Password-123' }, remoteAddress: '10.0.0.7' })).statusCode);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
    // Another IP is not affected.
    expect((await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'nobody@kawral.test', password: 'Wrong-Password-123' }, remoteAddress: '10.0.0.8' })).statusCode).toBe(401);
    const s = await signup(t);
    let last = 0;
    for (let i = 0; i < 301; i++) last = (await t.app.inject({ method: 'GET', url: '/v1/me', headers: auth(s) })).statusCode;
    expect(last).toBe(429);
  });
});

describe('OTP protections and IDOR sweep', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
    await resetDb(t);
  });
  afterAll(async () => {
    await pdfRenderer().close();
    await t.close();
  });

  it('limits OTP requests per phone, locks a code after 5 wrong attempts and redacts delivered codes', async () => {
    const op = await verifiedOrg(t);
    const f = json<{ id: string }>(await t.app.inject({ method: 'POST', url: '/v1/farmers', headers: auth(op), payload: { firstName: 'Awa', lastName: 'Diatta', sex: 'F', phone: '+221773334455', consentData: true, consentCreditBureau: true } }));
    expect(f.id).toBeTruthy();
    const req = () => t.app.inject({ method: 'POST', url: '/v1/auth/farmer/otp/request', payload: { phone: '+221773334455' } });
    expect([(await req()).statusCode, (await req()).statusCode, (await req()).statusCode]).toEqual([202, 202, 202]);
    expect((await req()).statusCode).toBe(429); // 3 per 10 minutes per phone
    const tries: number[] = [];
    for (let i = 0; i < 6; i++) tries.push((await t.app.inject({ method: 'POST', url: '/v1/auth/farmer/otp/verify', payload: { phone: '+221773334455', code: String(100000 + i) } })).statusCode);
    expect(tries.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(tries[5]).toBe(429); // locked after 5 attempts: the right code no longer works either
    await flushNotifications(t);
    const rows = await t.ctx.db.select().from(notifications).where(eq(notifications.destination, '+221773334455'));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect((r.data as Record<string, unknown>).code).toBeUndefined();
      expect(r.body ?? '').not.toMatch(/\d{6}/);
    }
  });

  it('answers 404 to an unrelated organisation on every resource of a settled season', async () => {
    await resetDb(t);
    const s = await activeSeasonScenario(t);
    await wf1Harvest(t, s);
    const runId = await settleSeason(t, s);
    const get = async (url: string) => (await t.app.inject({ method: 'GET', url, headers: auth(s.op) })).json() as { data?: { id: string }[] } & Record<string, unknown>;
    const contracts = (await get(`/v1/contracts?seasonId=${s.seasonId}`)).data!;
    const tickets = (await get(`/v1/seasons/${s.seasonId}/harvest-deliveries`)).data!;
    const invoices = (await get(`/v1/buyer-invoices?seasonId=${s.seasonId}`)).data!;
    const dispatches = (await get(`/v1/seasons/${s.seasonId}/dispatches`)).data!;
    const statements = (await get(`/v1/settlement-runs/${runId}/statements`)).data!;
    const urls = [
      `/v1/blocks/${s.blockId}`,
      `/v1/blocks/${s.blockId}/plots`,
      `/v1/plots/${s.plots[0]!.id}/visits`,
      `/v1/farmers/${s.farmers[0]!.id}`,
      `/v1/farmers/${s.farmers[0]!.id}/arrears`,
      `/v1/seasons/${s.seasonId}`,
      `/v1/seasons/${s.seasonId}/budget-lines`,
      `/v1/seasons/${s.seasonId}/service-deliveries`,
      `/v1/seasons/${s.seasonId}/harvest-deliveries`,
      `/v1/seasons/${s.seasonId}/settlement-runs`,
      `/v1/financing-requests/${s.frId}`,
      `/v1/rfps/${s.rfpId}`,
      `/v1/facilities/${s.facilityId}`,
      `/v1/facilities/${s.facilityId}/disbursements`,
      `/v1/facilities/${s.facilityId}/repayments`,
      `/v1/contracts/${contracts[0]!.id}`,
      `/v1/contracts/${contracts[0]!.id}/pdf`,
      `/v1/buyer-invoices/${invoices[0]!.id}/pdf`,
      `/v1/settlement-runs/${runId}`,
      `/v1/settlement-runs/${runId}/instructions`,
      `/v1/farmer-statements/${statements[0]!.id}/pdf`,
      `/v1/blocks/${s.blockId}/alerts`,
      `/v1/dashboards/block/${s.blockId}`,
      `/v1/kpis?scopeType=block&scopeId=${s.blockId}`,
    ];
    expect(tickets.length + dispatches.length).toBeGreaterThan(0);
    const strangerOp = await verifiedOrg(t, { email: `stranger${Date.now()}@other.test`, legalName: 'Ferme Etrangère SARL' });
    const strangerLender = await verifiedLender(t, 'Banque Beta SA', 'bank');
    const strangerBuyer = await verifiedOrg(t, { orgType: 'buyer', legalName: 'Négoce Omega SA', legalForm: 'SA', email: `omega${Date.now()}@omega.test` });
    for (const who of [strangerOp, strangerLender, strangerBuyer]) {
      for (const url of urls) {
        const r = await t.app.inject({ method: 'GET', url, headers: auth(who) });
        expect([403, 404], `${url} → ${r.statusCode}`).toContain(r.statusCode);
      }
    }
    // Writes are refused the same way.
    for (const [method, url] of [['POST', `/v1/seasons/${s.seasonId}/settlement-runs`], ['POST', `/v1/facilities/${s.facilityId}/disbursements`], ['POST', `/v1/plots/${s.plots[0]!.id}/visits`]] as const) {
      const r = await t.app.inject({ method, url, headers: auth(strangerOp), payload: { amountXof: 1, purpose: 'Intrants', beneficiaryType: 'operator', cropStage: 'sowing', healthScore: 3 } });
      expect([403, 404], `${method} ${url} → ${r.statusCode}`).toContain(r.statusCode);
    }
  });
});
