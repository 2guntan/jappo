/**
 * Authorisation negative suite (SPEC §6.4): for every get/list route, a user from an unrelated
 * organisation receives 404 (not 403) and empty lists. Each phase appends its resources here.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PDF_BYTES, auth, createTestApp, expectStatus, json, multipartBody, resetDb, signup, type Session, type TestApp } from '../helpers';

let t: TestApp;
let owner: Session;
let stranger: Session;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());
beforeEach(async () => {
  await resetDb(t);
  owner = await signup(t, { legalName: 'Ferme Commune Kawral SARL' });
  stranger = await signup(t, { legalName: 'Ferme Etrangère SARL' });
});

describe('authz: files', () => {
  it('hides another org file (404) and its download', async () => {
    const mp = multipartBody({}, { name: 'a.pdf', content: PDF_BYTES });
    const f = json<{ id: string }>(await t.app.inject({ method: 'POST', url: '/v1/files', headers: { ...auth(owner), ...mp.headers }, payload: mp.payload }));
    expectStatus(await t.app.inject({ method: 'GET', url: `/v1/files/${f.id}`, headers: auth(owner) }), 200);
    expect((await t.app.inject({ method: 'GET', url: `/v1/files/${f.id}`, headers: auth(stranger) })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: `/v1/files/${f.id}/download`, headers: auth(stranger) })).statusCode).toBe(404);
  });
});

describe('authz: organisation scope', () => {
  it('lists only own members, invitations, KYC documents and API keys', async () => {
    await t.app.inject({ method: 'POST', url: '/v1/orgs/current/invitations', headers: auth(owner), payload: { email: 'a@b.test', roles: ['viewer'] } });
    await t.app.inject({ method: 'POST', url: '/v1/orgs/current/api-keys', headers: auth(owner), payload: { name: 'key one', roles: ['viewer'] } });
    const mp = multipartBody({ docType: 'ninea' }, { name: 'n.pdf', content: PDF_BYTES });
    await t.app.inject({ method: 'POST', url: '/v1/orgs/current/kyc-documents', headers: { ...auth(owner), ...mp.headers }, payload: mp.payload });
    for (const url of ['/v1/orgs/current/invitations', '/v1/orgs/current/api-keys', '/v1/orgs/current/kyc-documents']) {
      expect(json<{ data: unknown[] }>(await t.app.inject({ method: 'GET', url, headers: auth(stranger) })).data).toHaveLength(0);
    }
    const members = json<{ data: { fullName: string }[] }>(await t.app.inject({ method: 'GET', url: '/v1/orgs/current/members', headers: auth(stranger) }));
    expect(members.data).toHaveLength(1);
  });

  it('cannot act on another org membership, invitation or key (404)', async () => {
    const inv = json<{ id: string }>(await t.app.inject({ method: 'POST', url: '/v1/orgs/current/invitations', headers: auth(owner), payload: { email: 'z@b.test', roles: ['viewer'] } }));
    const key = json<{ id: string }>(await t.app.inject({ method: 'POST', url: '/v1/orgs/current/api-keys', headers: auth(owner), payload: { name: 'key one', roles: ['viewer'] } }));
    const me = json<{ user: { id: string } }>(await t.app.inject({ method: 'GET', url: '/v1/me', headers: auth(owner) }));
    const d = await t.app.inject({ method: 'DELETE', url: `/v1/orgs/current/invitations/${inv.id}`, headers: auth(stranger) });
    expect(d.statusCode, d.body).toBe(404);
    expect((await t.app.inject({ method: 'DELETE', url: `/v1/orgs/current/api-keys/${key.id}`, headers: auth(stranger) })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'PATCH', url: `/v1/orgs/current/members/${me.user.id}`, headers: auth(stranger), payload: { roles: ['viewer'] } })).statusCode).toBe(404);
  });

  it('cannot read another user notifications', async () => {
    const list = json<{ data: { id: string }[] }>(await t.app.inject({ method: 'GET', url: '/v1/notifications', headers: auth(stranger) }));
    expect(list.data).toHaveLength(0);
    expect((await t.app.inject({ method: 'POST', url: '/v1/notifications/0190a000-0000-7000-8000-000000000000/actions/read', headers: auth(stranger) })).statusCode).toBe(404);
  });

  it('non-admins get 403 on admin routes', async () => {
    for (const url of ['/v1/admin/orgs', `/v1/admin/orgs/${owner.orgId}`, '/v1/admin/audit']) {
      expect((await t.app.inject({ method: 'GET', url, headers: auth(stranger) })).statusCode).toBe(403);
    }
  });
});

describe('authz: land & farmers (P2)', () => {
  it('stranger operator gets 404 on blocks, plots, documents, farmers and empty lists', async () => {
    const { createBlock, createFarmer, setBoundary, rectangle } = await import('../helpers');
    const b = await createBlock(t, owner);
    await setBoundary(t, owner, b.id);
    const p = json<{ id: string }>(await t.app.inject({ method: 'POST', url: `/v1/blocks/${b.id}/plots`, headers: auth(owner), payload: { geometry: rectangle(-16.2699, 12.5801, 50, 50) } }));
    const f = await createFarmer(t, owner);
    const a = json<{ id: string }>(await t.app.inject({ method: 'POST', url: `/v1/plots/${p.id}/allocations`, headers: auth(owner), payload: { farmerId: f.id } }));
    for (const url of [`/v1/blocks/${b.id}`, `/v1/blocks/${b.id}/map`, `/v1/blocks/${b.id}/plots`, `/v1/blocks/${b.id}/land-documents`, `/v1/blocks/${b.id}/assets`, `/v1/blocks/${b.id}/grievances`, `/v1/plots/${p.id}`, `/v1/plots/${p.id}/allocations`, `/v1/farmers/${f.id}`, `/v1/farmers/${f.id}/history`]) {
      const r = await t.app.inject({ method: 'GET', url, headers: auth(stranger) });
      expect(r.statusCode, url).toBe(404);
    }
    expect(json<{ data: unknown[] }>(await t.app.inject({ method: 'GET', url: '/v1/blocks', headers: auth(stranger) })).data).toHaveLength(0);
    expect(json<{ data: unknown[] }>(await t.app.inject({ method: 'GET', url: '/v1/farmers', headers: auth(stranger) })).data).toHaveLength(0);
    const writes = [
      { method: 'PATCH' as const, url: `/v1/blocks/${b.id}`, payload: { name: 'Bloc X' }, headers: { 'if-match': '"1"' } },
      { method: 'POST' as const, url: `/v1/blocks/${b.id}/plots`, payload: { geometry: rectangle() } },
      { method: 'POST' as const, url: `/v1/plots/${p.id}/allocations`, payload: { farmerId: f.id } },
      { method: 'POST' as const, url: `/v1/allocations/${a.id}/actions/end`, payload: {} },
      { method: 'PATCH' as const, url: `/v1/farmers/${f.id}`, payload: { village: 'x' }, headers: { 'if-match': '"1"' } },
    ];
    for (const w of writes) {
      const r = await t.app.inject({ method: w.method, url: w.url, headers: { ...auth(stranger), ...(w.headers ?? {}) }, payload: w.payload });
      expect(r.statusCode, w.url).toBe(404);
    }
  });

  it('a block grant gives read access to the block, its plots and allocated farmers', async () => {
    const { createBlock, createFarmer, setBoundary, rectangle } = await import('../helpers');
    const { grant } = await import('../../src/core/authz/visibility');
    const b = await createBlock(t, owner);
    await setBoundary(t, owner, b.id);
    const p = json<{ id: string }>(await t.app.inject({ method: 'POST', url: `/v1/blocks/${b.id}/plots`, headers: auth(owner), payload: { geometry: rectangle(-16.2699, 12.5801, 50, 50) } }));
    const f = await createFarmer(t, owner, { phone: '+221771112233' });
    await t.app.inject({ method: 'POST', url: `/v1/plots/${p.id}/allocations`, headers: auth(owner), payload: { farmerId: f.id } });
    const lender = await signup(t, { orgType: 'lender', lenderKind: 'sfd', legalName: 'Mutuelle Alpha SFD', legalForm: 'mutuelle' });
    await t.ctx.db.transaction((tx) => grant(tx, { resourceType: 'block', resourceId: b.id, granteeOrgId: lender.orgId!, scope: 'read', grantedByEvent: 'test' }));
    expectStatus(await t.app.inject({ method: 'GET', url: `/v1/blocks/${b.id}`, headers: auth(lender) }), 200);
    expect(json<{ data: unknown[] }>(await t.app.inject({ method: 'GET', url: `/v1/blocks/${b.id}/plots`, headers: auth(lender) })).data).toHaveLength(1);
    const lf = json<{ phone: string; allowedActions: string[] }>(await t.app.inject({ method: 'GET', url: `/v1/farmers/${f.id}`, headers: auth(lender) }));
    expect(lf.phone).toBe('**** 2233');
    expect(lf.allowedActions).toEqual([]);
    expect((await t.app.inject({ method: 'PATCH', url: `/v1/blocks/${b.id}`, headers: auth(lender, { 'if-match': '"1"' }), payload: { name: 'Bloc X' } })).statusCode).toBe(403);
  });
});
