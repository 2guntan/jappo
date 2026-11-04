import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminSession, auth, createTestApp, expectStatus, json, resetDb, verifiedOrg, type TestApp } from '../helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());
beforeEach(async () => resetDb(t));

describe('admin console (P10)', () => {
  it('edits settings and holidays, previews templates, monitors webhook deliveries; non-admins are refused', async () => {
    const admin = await adminSession(t);
    const op = await verifiedOrg(t);
    const st = json<{ data: { key: string; value: unknown }[] }>(await t.app.inject({ method: 'GET', url: '/v1/admin/settings', headers: auth(admin) })).data;
    expect(st.find((s) => s.key === 'billing.vat_bps')!.value).toBe(1800);
    expect((await t.app.inject({ method: 'PUT', url: '/v1/admin/settings/billing.vat_bps', headers: auth(admin), payload: { value: 'x' } })).statusCode).toBe(400);
    expect((await t.app.inject({ method: 'PUT', url: '/v1/admin/settings/billing.vat_bps', headers: auth(op), payload: { value: 1000 } })).statusCode).toBe(403);
    expect(json<{ value: number }>(await t.app.inject({ method: 'PUT', url: '/v1/admin/settings/billing.vat_bps', headers: auth(admin), payload: { value: 1800 } })).value).toBe(1800);
    expect((await t.app.inject({ method: 'PUT', url: '/v1/admin/settings/unknown.key', headers: auth(admin), payload: { value: 1 } })).statusCode).toBe(404);

    const h = await t.app.inject({ method: 'POST', url: '/v1/admin/holidays', headers: auth(admin), payload: { date: '2027-03-20', name: 'Korité' } });
    expectStatus(h, 201);
    expect(json<{ data: { name: string }[] }>(await t.app.inject({ method: 'GET', url: '/v1/admin/holidays', headers: auth(admin) })).data.map((x) => x.name)).toContain('Korité');
    expectStatus(await t.app.inject({ method: 'DELETE', url: `/v1/admin/holidays/${h.json().id}`, headers: auth(admin) }), 200);

    const pv = json<{ html: string }>(await t.app.inject({ method: 'POST', url: '/v1/admin/contract-templates/preview', headers: auth(admin), payload: { bodyHbs: '<p>{{operator.legalName}} — {{block.ref}}</p>', locale: 'fr' } }));
    expect(pv.html).toContain('Ferme Commune Kawral SARL — BLK-2026-0001');
    expect((await t.app.inject({ method: 'POST', url: '/v1/admin/contract-templates/preview', headers: auth(admin), payload: { bodyHbs: '{{#if}}' } })).json().code).toBe('TEMPLATE_INVALID');
    expect((await t.app.inject({ method: 'POST', url: '/v1/admin/contract-templates/preview', headers: auth(op), payload: { bodyHbs: 'x' } })).statusCode).toBe(403);
    expectStatus(await t.app.inject({ method: 'GET', url: '/v1/admin/webhook-deliveries', headers: auth(admin) }), 200);
    expect((await t.app.inject({ method: 'GET', url: '/v1/admin/webhook-deliveries', headers: auth(op) })).statusCode).toBe(403);
  });
});
