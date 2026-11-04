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
