import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { adminSession, auth, createTestApp, expectStatus, json, resetDb, signup, type TestApp } from '../helpers';
import { auditLog, eventsOutbox } from '../../src/core/schema';
import { dispatchOutbox } from '../../src/jobs';
import { nextRef } from '../../src/core/refs';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());
beforeEach(async () => resetDb(t));

describe('platform core', () => {
  it('serves health, readiness, OpenAPI 3.1 with x-permission on every operation', async () => {
    expect(json(await t.app.inject({ method: 'GET', url: '/v1/health' }))).toMatchObject({ status: 'ok' });
    expect(json(await t.app.inject({ method: 'GET', url: '/v1/ready' }))).toMatchObject({ status: 'ready' });
    const doc = json<{ openapi: string; paths: Record<string, Record<string, { operationId?: string; 'x-permission'?: string }>> }>(
      await t.app.inject({ method: 'GET', url: '/v1/openapi.json' }),
    );
    expect(doc.openapi).toBe('3.1.0');
    const ops = Object.values(doc.paths).flatMap((p) => Object.values(p));
    expect(ops.length).toBeGreaterThan(30);
    for (const op of ops) {
      expect(op.operationId).toBeTruthy();
      expect(op['x-permission']).toBeTruthy();
    }
    const ids = ops.map((o) => o.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    const metrics = await t.app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.body).toContain('jappo_http_request_duration_seconds');
  });

  it('returns problem+json for unknown routes with request id', async () => {
    const r = await t.app.inject({ method: 'GET', url: '/v1/nope', headers: { 'x-request-id': 'req-123' } });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ code: 'NOT_FOUND', requestId: 'req-123', status: 404 });
    expect(r.headers['x-request-id']).toBe('req-123');
  });

  it('replays POST responses for the same Idempotency-Key and rejects reuse with a different body', async () => {
    const s = await signup(t);
    const body = { email: 'idem@kawral.test', roles: ['viewer'] };
    const h = auth(s, { 'idempotency-key': 'k-1' });
    const r1 = await t.app.inject({ method: 'POST', url: '/v1/orgs/current/invitations', headers: h, payload: body });
    const r2 = await t.app.inject({ method: 'POST', url: '/v1/orgs/current/invitations', headers: h, payload: body });
    expectStatus(r1, 201);
    expectStatus(r2, 201);
    expect(r2.headers['idempotent-replayed']).toBe('true');
    expect(r2.json().id).toBe(r1.json().id);
    const list = json<{ data: unknown[] }>(await t.app.inject({ method: 'GET', url: '/v1/orgs/current/invitations', headers: auth(s) }));
    expect(list.data).toHaveLength(1);
    const r3 = await t.app.inject({ method: 'POST', url: '/v1/orgs/current/invitations', headers: h, payload: { ...body, email: 'other@kawral.test' } });
    expect(r3.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('keeps a verifiable audit hash chain and detects tampering', async () => {
    await signup(t);
    await signup(t);
    const admin = await adminSession(t);
    const v = json<{ ok: boolean; checked: number }>(await t.app.inject({ method: 'POST', url: '/v1/admin/audit/actions/verify', headers: auth(admin) }));
    expect(v.ok).toBe(true);
    expect(v.checked).toBeGreaterThanOrEqual(3);
    const list = json<{ data: { seq: number; action: string }[]; nextCursor: string | null }>(await t.app.inject({ method: 'GET', url: '/v1/admin/audit?limit=2', headers: auth(admin) }));
    expect(list.data).toHaveLength(2);
    expect(list.nextCursor).toBeTruthy();
    const next = json<{ data: { seq: number }[] }>(await t.app.inject({ method: 'GET', url: `/v1/admin/audit?limit=2&cursor=${list.nextCursor}`, headers: auth(admin) }));
    expect(next.data[0]!.seq).toBeLessThan(list.data[1]!.seq);
    const [first] = await t.ctx.db.select().from(auditLog).orderBy(auditLog.seq).limit(1);
    await t.ctx.db.update(auditLog).set({ action: 'tampered' }).where(eq(auditLog.id, first!.id));
    const broken = json<{ ok: boolean; brokenAtSeq: number }>(await t.app.inject({ method: 'POST', url: '/v1/admin/audit/actions/verify', headers: auth(admin) }));
    expect(broken).toMatchObject({ ok: false, brokenAtSeq: first!.seq });
  });

  it('dispatches outbox events to handlers and records failures', async () => {
    await signup(t);
    const seen: string[] = [];
    const handlers = new Map([
      ['org.created', [async (e: { type: string }) => void seen.push(e.type)]],
      ['*', [async () => undefined]],
    ]);
    const n = await dispatchOutbox(t.ctx, handlers as never);
    expect(n).toBeGreaterThan(0);
    expect(seen).toEqual(['org.created']);
    const pending = await t.ctx.db.select().from(eventsOutbox).where(sql`dispatched_at is null`);
    expect(pending).toHaveLength(0);
    await signup(t);
    const failing = new Map([['org.created', [async () => Promise.reject(new Error('boom'))]]]);
    await dispatchOutbox(t.ctx, failing as never);
    const [row] = await t.ctx.db.select().from(eventsOutbox).where(sql`dispatched_at is null`);
    expect(row).toMatchObject({ attempts: 1, lastError: 'boom' });
  });

  it('allocates sequential refs per prefix and year', async () => {
    const a = await t.ctx.db.transaction((tx) => nextRef(tx, 'BLK', 2026));
    const b = await t.ctx.db.transaction((tx) => nextRef(tx, 'BLK', 2026));
    const c = await t.ctx.db.transaction((tx) => nextRef(tx, 'RFP', 2026));
    expect([a, b, c]).toEqual(['BLK-2026-0001', 'BLK-2026-0002', 'RFP-2026-0001']);
  });

  it('lists modules with navigation filtered by permission', async () => {
    const s = await signup(t);
    const mods = json<{ data: { name: string }[] }>(await t.app.inject({ method: 'GET', url: '/v1/modules', headers: auth(s) }));
    expect(mods.data.map((m) => m.name)).toContain('identity');
    expect(mods.data.map((m) => m.name)).not.toContain('admin');
    const admin = await adminSession(t);
    const am = json<{ data: { name: string }[] }>(await t.app.inject({ method: 'GET', url: '/v1/modules', headers: auth(admin) }));
    expect(am.data.map((m) => m.name)).toContain('admin');
  });
});
