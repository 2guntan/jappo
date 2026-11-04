import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { adminSession, auth, awardedScenario, createTestApp, expectStatus, json, readyScenario, resetDb, verifiedLender, verifiedOrg, type TestApp } from '../helpers';
import { dispatchOutbox } from '../../src/jobs';
import { deliverWebhooks, runBilling } from '../../src/modules/billing/service';
import { plantings } from '../../src/modules/planning/schema';
import { pdfRenderer } from '../../src/core/adapters/pdf';

let t: TestApp;
let server: Server;
let port = 0;
const received: { headers: Record<string, string | string[] | undefined>; body: string }[] = [];
let failNext = 0;
beforeAll(async () => {
  t = await createTestApp();
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.statusCode = failNext > 0 ? (failNext--, 500) : 200;
      res.end('ok');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as { port: number }).port;
});
afterAll(async () => {
  server.close();
  await pdfRenderer().close();
  await t.close();
});
beforeEach(async () => {
  received.length = 0;
  failNext = 0;
  await resetDb(t);
});

type Invoice = { id: string; ref: string; amountXof: number; taxXof: number; totalXof: number; status: string; dueDate: string; hasPdf: boolean; lines: { description: string }[] };
const invoices = async (s: Parameters<typeof auth>[0]) => json<{ data: Invoice[] }>(await t.app.inject({ method: 'GET', url: '/v1/billing/invoices', headers: auth(s) })).data;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

describe('billing (P10)', () => {
  it('a new operator subscribes and is invoiced per hectare at season start; overdue invoices restrict writes', async () => {
    const plans = json<{ data: { code: string; unitPriceXof: number }[] }>(await t.app.inject({ method: 'GET', url: '/v1/billing/plans' }));
    expect(plans.data.map((p) => p.code).sort()).toEqual(['free_partner', 'lender_monitoring', 'operator_pro', 'operator_starter']);
    const s = await readyScenario(t);
    expect(json<{ subscription: unknown }>(await t.app.inject({ method: 'GET', url: '/v1/billing/subscription', headers: auth(s.op) })).subscription).toBeNull();
    expect((await t.app.inject({ method: 'POST', url: '/v1/billing/subscription', headers: auth(s.op), payload: { planCode: 'lender_monitoring' } })).json().code).toBe('PLAN_NOT_FOR_ORG_TYPE');
    const sub = json<{ subscription: { plan: { code: string } } }>(await t.app.inject({ method: 'POST', url: '/v1/billing/subscription', headers: auth(s.op), payload: { planCode: 'operator_pro' } }));
    expect(sub.subscription.plan.code).toBe('operator_pro');

    // Season start (self-financed) → 3 ha × 4 000 = 12 000 + VAT 18 % = 14 160.
    await t.ctx.db.update(plantings).set({ areaHa: '1' }).where(eq(plantings.seasonId, s.seasonId));
    const season = json<{ version: number }>(await t.app.inject({ method: 'GET', url: `/v1/seasons/${s.seasonId}`, headers: auth(s.op) }));
    expectStatus(await t.app.inject({ method: 'POST', url: `/v1/seasons/${s.seasonId}/actions/start`, headers: auth(s.op, { 'if-match': `"${season.version}"` }), payload: { selfFinanced: true } }), 200);
    await dispatchOutbox(t.ctx);
    await dispatchOutbox(t.ctx); // at-least-once delivery must not duplicate the invoice
    const inv = await invoices(s.op);
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ amountXof: 12_000, taxXof: 2_160, totalXof: 14_160, status: 'issued', hasPdf: true });
    expect(inv[0]!.lines[0]!.description).toContain('3 ha');
    expectStatus(await t.app.inject({ method: 'GET', url: `/v1/billing/invoices/${inv[0]!.id}/pdf`, headers: auth(s.op) }), 200);
    expect((await t.app.inject({ method: 'GET', url: `/v1/billing/invoices/${inv[0]!.id}/pdf`, headers: auth(s.buyer) })).statusCode).toBe(404);

    // > 60 days overdue → read-only (writes 403, reads and billing still allowed); paying lifts it.
    await runBilling(t.ctx, addDays(inv[0]!.dueDate, 31));
    let me = json<{ memberships: { billingStatus: string }[] }>(await t.app.inject({ method: 'GET', url: '/v1/me', headers: auth(s.op) }));
    expect(me.memberships[0]!.billingStatus).toBe('overdue');
    await runBilling(t.ctx, addDays(inv[0]!.dueDate, 61));
    me = json(await t.app.inject({ method: 'GET', url: '/v1/me', headers: auth(s.op) }));
    expect(me.memberships[0]!.billingStatus).toBe('restricted');
    expect((await t.app.inject({ method: 'POST', url: '/v1/blocks', headers: auth(s.op), payload: { name: 'Bloc 2', region: 'Ziguinchor', tenureType: 'bail' } })).json().code).toBe('ORG_BILLING_RESTRICTED');
    expectStatus(await t.app.inject({ method: 'GET', url: `/v1/blocks/${s.blockId}`, headers: auth(s.op) }), 200);
    const admin = await adminSession(t);
    expect((await t.app.inject({ method: 'POST', url: `/v1/admin/invoices/${inv[0]!.id}/actions/mark-paid`, headers: auth(s.op), payload: { reference: 'x' } })).statusCode).toBe(403);
    expect((await t.app.inject({ method: 'POST', url: `/v1/admin/invoices/${inv[0]!.id}/actions/mark-paid`, headers: auth(admin), payload: {} })).statusCode).toBe(400);
    expect(json<Invoice>(await t.app.inject({ method: 'POST', url: `/v1/admin/invoices/${inv[0]!.id}/actions/mark-paid`, headers: auth(admin), payload: { reference: 'VIR-JAPPO-0001' } })).status).toBe('paid');
    expectStatus(await t.app.inject({ method: 'POST', url: '/v1/blocks', headers: auth(s.op), payload: { name: 'Bloc 2', region: 'Ziguinchor', tenureType: 'bail' } }), 201);
    expect(json<{ data: Invoice[] }>(await t.app.inject({ method: 'GET', url: '/v1/admin/invoices', headers: auth(admin) })).data).toHaveLength(1);
    const plan = json<{ data: { id: string; code: string }[] }>(await t.app.inject({ method: 'GET', url: '/v1/admin/plans', headers: auth(admin) })).data.find((p) => p.code === 'operator_starter')!;
    expect(json<{ unitPriceXof: number }>(await t.app.inject({ method: 'PATCH', url: `/v1/admin/plans/${plan.id}`, headers: auth(admin), payload: { unitPriceXof: 5500 } })).unitPriceXof).toBe(5500);
  });

  it('invoices the structuring fee on award acceptance and the lender licence at subscription', async () => {
    const s = await awardedScenario(t);
    await dispatchOutbox(t.ctx);
    // No explicit plan → operator_starter (100 bps of 3 000 000 = 30 000 + 5 400 VAT).
    expect((await invoices(s.op)).map((i) => [i.amountXof, i.totalXof])).toEqual([[30_000, 35_400]]);
    expect(json<{ subscription: { plan: { code: string } } }>(await t.app.inject({ method: 'GET', url: '/v1/billing/subscription', headers: auth(s.op) })).subscription.plan.code).toBe('operator_starter');
    const lender = await verifiedLender(t, 'Banque Beta SA', 'bank');
    expectStatus(await t.app.inject({ method: 'POST', url: '/v1/billing/subscription', headers: auth(lender), payload: { planCode: 'lender_monitoring' } }), 200);
    expect((await invoices(lender)).map((i) => i.totalXof)).toEqual([1_416_000]);
    await runBilling(t.ctx); // same year: no duplicate licence invoice
    expect(await invoices(lender)).toHaveLength(1);
  });
});

describe('webhooks & events (P10)', () => {
  it('signs deliveries, retries with backoff, exposes the delivery log and the event feed', async () => {
    const op = await verifiedOrg(t);
    const created = await t.app.inject({ method: 'POST', url: '/v1/webhooks', headers: auth(op), payload: { url: `http://127.0.0.1:${port}/hook`, eventTypes: ['block.created'] } });
    expectStatus(created, 201);
    const { id, secret } = created.json() as { id: string; secret: string };
    expect(secret).toMatch(/^whsec_/);
    expect(json<{ data: { id: string }[] }>(await t.app.inject({ method: 'GET', url: '/v1/webhooks', headers: auth(op) })).data[0]).not.toHaveProperty('secret');

    expectStatus(await t.app.inject({ method: 'POST', url: '/v1/blocks', headers: auth(op), payload: { name: 'Bloc Webhook', region: 'Ziguinchor', tenureType: 'bail' } }), 201);
    await dispatchOutbox(t.ctx);
    expect(await deliverWebhooks(t.ctx)).toMatchObject({ attempted: 1, sent: 1 });
    expect(received).toHaveLength(1);
    const sig = String(received[0]!.headers['jappo-signature']);
    const [, ts, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(sig)!;
    expect(createHmac('sha256', secret).update(`${ts}.${received[0]!.body}`).digest('hex')).toBe(v1);
    expect(JSON.parse(received[0]!.body)).toMatchObject({ type: 'block.created', orgId: op.orgId });

    // Failing endpoint: retried with backoff, then failed after the last step.
    failNext = 100;
    expectStatus(await t.app.inject({ method: 'POST', url: '/v1/blocks', headers: auth(op), payload: { name: 'Bloc Echec', region: 'Ziguinchor', tenureType: 'bail' } }), 201);
    await dispatchOutbox(t.ctx);
    let now = new Date();
    for (let i = 0; i < 7; i++) {
      await deliverWebhooks(t.ctx, now);
      now = new Date(now.getTime() + 25 * 3600_000);
    }
    const log = json<{ data: { status: string; attempts: number; lastStatusCode: number | null }[] }>(await t.app.inject({ method: 'GET', url: `/v1/webhooks/${id}/deliveries`, headers: auth(op) })).data;
    expect(log.map((d) => [d.status, d.attempts])).toEqual(expect.arrayContaining([['delivered', 1], ['failed', 7]]));
    failNext = 0;
    const test = json<{ data: { eventType: string; status: string }[] }>(await t.app.inject({ method: 'POST', url: `/v1/webhooks/${id}/actions/test`, headers: auth(op) }));
    expect(test.data.find((d) => d.eventType === 'webhook.test')!.status).toBe('delivered');

    // Isolation and event feed.
    const other = await verifiedOrg(t, { email: `o${Date.now()}@other.test`, legalName: 'Ferme Autre SARL' });
    expect((await t.app.inject({ method: 'GET', url: `/v1/webhooks/${id}/deliveries`, headers: auth(other) })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'DELETE', url: `/v1/webhooks/${id}`, headers: auth(other) })).statusCode).toBe(404);
    const feed = json<{ data: { type: string; orgId: string }[] }>(await t.app.inject({ method: 'GET', url: '/v1/events', headers: auth(op) })).data;
    expect(feed.map((e) => e.type)).toEqual(expect.arrayContaining(['block.created']));
    expect(feed.every((e) => e.orgId === op.orgId)).toBe(true);
    expect(json<{ data: unknown[] }>(await t.app.inject({ method: 'GET', url: '/v1/events', headers: auth(other) })).data.every((e) => (e as { orgId: string }).orgId === other.orgId)).toBe(true);
    expectStatus(await t.app.inject({ method: 'DELETE', url: `/v1/webhooks/${id}`, headers: auth(op) }), 200);
  });
});
