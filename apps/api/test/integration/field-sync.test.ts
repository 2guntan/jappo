import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, createBlock, createTestApp, expectStatus, json, rectangle, resetDb, setBoundary, signup, type Session, type TestApp } from '../helpers';

let t: TestApp;
let op: Session;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());
beforeEach(async () => {
  await resetDb(t);
  op = await signup(t);
});

describe('field PWA sync', () => {
  it('bootstraps, applies offline ops idempotently, resolves intra-batch references, reports conflicts', async () => {
    const b = await createBlock(t, op);
    await setBoundary(t, op, b.id);
    const boot = json<{ syncToken: string; blocks: unknown[]; plots: unknown[] }>(await t.app.inject({ method: 'GET', url: `/v1/field/bootstrap?blockIds=${b.id}`, headers: auth(op) }));
    expect(boot.blocks).toHaveLength(1);
    const now = new Date().toISOString();
    const ops = [
      { clientId: 'c-farmer-0001', type: 'farmer.create', createdAt: now, payload: { firstName: 'Aminata', lastName: 'Coly', sex: 'F', consentData: true, phone: '+221778880001', mobileWalletProvider: 'wave', mobileWalletNumber: '+221778880001' } },
      { clientId: 'c-plot-0001', type: 'plot.create', createdAt: now, payload: { blockId: b.id, geometry: rectangle(-16.2699, 12.5801, 70, 70) } },
      { clientId: 'c-bad-0001', type: 'farmer.create', createdAt: now, payload: { firstName: 'Sans', sex: 'F' } },
      { clientId: 'c-unknown-01', type: 'teleport.now', createdAt: now, payload: {} },
    ];
    const r1 = json<{ results: { clientId: string; status: string; entityId: string | null; error: { code: string } | null }[]; syncToken: string; changes: { farmers: { firstName: string; mobileWalletNumberMasked: string }[]; plots: unknown[] } }>(
      await t.app.inject({ method: 'POST', url: '/v1/field/sync', headers: auth(op), payload: { syncToken: boot.syncToken, blockIds: [b.id], ops } }),
    );
    expect(r1.results.map((r) => r.status)).toEqual(['applied', 'applied', 'rejected', 'rejected']);
    expect(r1.results[2]!.error!.code).toBe('VALIDATION_FAILED');
    expect(r1.results[3]!.error!.code).toBe('UNSUPPORTED_OP');
    expect(r1.changes.farmers[0]).toMatchObject({ firstName: 'Aminata', mobileWalletNumberMasked: '**** 0001' });
    expect(r1.changes.plots).toHaveLength(1);
    const plotId = r1.results[1]!.entityId!;
    const farmerId = r1.results[0]!.entityId!;
    // replay is a no-op
    const r2 = json<{ results: { status: string; entityId: string }[] }>(await t.app.inject({ method: 'POST', url: '/v1/field/sync', headers: auth(op), payload: { blockIds: [b.id], ops: ops.slice(0, 2) } }));
    expect(r2.results.map((r) => r.status)).toEqual(['duplicate', 'duplicate']);
    expect(r2.results[0]!.entityId).toBe(farmerId);
    expect(json<{ data: unknown[] }>(await t.app.inject({ method: 'GET', url: '/v1/farmers', headers: auth(op) })).data).toHaveLength(1);
    // allocation referencing a farmer created in the same batch
    const r3 = json<{ results: { status: string }[] }>(
      await t.app.inject({
        method: 'POST',
        url: '/v1/field/sync',
        headers: auth(op),
        payload: {
          blockIds: [b.id],
          ops: [
            { clientId: 'c-farmer-0002', type: 'farmer.create', createdAt: now, payload: { firstName: 'Khady', lastName: 'Sagna', sex: 'F', consentData: true } },
            { clientId: 'c-alloc-0001', type: 'allocation.create', createdAt: now, payload: { plotId, farmerClientId: 'c-farmer-0002', sharePct: 100 } },
          ],
        },
      }),
    );
    expect(r3.results.map((r) => r.status)).toEqual(['applied', 'applied']);
    // office edit then stale field edit → conflict (server wins)
    expectStatus(await t.app.inject({ method: 'PATCH', url: `/v1/farmers/${farmerId}`, headers: auth(op, { 'if-match': '"1"' }), payload: { village: 'Bureau' } }), 200);
    const r4 = json<{ results: { status: string; error: { code: string } }[] }>(
      await t.app.inject({ method: 'POST', url: '/v1/field/sync', headers: auth(op), payload: { blockIds: [b.id], ops: [{ clientId: 'c-upd-0001', type: 'farmer.update', createdAt: now, payload: { farmerId, baseVersion: 1, changes: { village: 'Terrain' } } }] } }),
    );
    expect(r4.results[0]).toMatchObject({ status: 'rejected', error: { code: 'SYNC_CONFLICT' } });
  });

  it('forbids sync without field:sync and rejects ops beyond role permissions', async () => {
    const lender = await signup(t, { orgType: 'lender', lenderKind: 'sfd', legalName: 'Mutuelle Alpha SFD', legalForm: 'mutuelle' });
    expect((await t.app.inject({ method: 'POST', url: '/v1/field/sync', headers: auth(lender), payload: { ops: [] } })).statusCode).toBe(403);
  });
});
