import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PASSWORD, PDF_BYTES, adminSession, auth, createTestApp, expectStatus, flushNotifications, json, login, multipartBody, resetDb, signup, uploadKyc, type TestApp } from '../helpers';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());
beforeEach(async () => resetDb(t));

describe('organisation profile and KYC', () => {
  it('updates the profile with If-Match and enforces ETag', async () => {
    const s = await signup(t);
    const get = await t.app.inject({ method: 'GET', url: '/v1/orgs/current', headers: auth(s) });
    expect(get.headers.etag).toBe('"1"');
    expect(get.json().allowedActions).toEqual(['update', 'submit_kyc']);
    const noMatch = await t.app.inject({ method: 'PATCH', url: '/v1/orgs/current', headers: auth(s), payload: { region: 'Ziguinchor' } });
    expect(noMatch.statusCode).toBe(428);
    const stale = await t.app.inject({ method: 'PATCH', url: '/v1/orgs/current', headers: auth(s, { 'if-match': '"7"' }), payload: { region: 'Ziguinchor' } });
    expect(stale.statusCode).toBe(412);
    const ok = await t.app.inject({ method: 'PATCH', url: '/v1/orgs/current', headers: auth(s, { 'if-match': '"1"' }), payload: { region: 'Ziguinchor', ninea: '0123456789' } });
    expectStatus(ok, 200);
    expect(ok.headers.etag).toBe('"2"');
    expect(ok.json()).toMatchObject({ region: 'Ziguinchor', ninea: '0123456789', version: 2 });
  });

  it('runs signup → upload KYC → submit → admin verify, with notifications', async () => {
    const s = await signup(t, { legalName: 'Ferme Commune Kawral SARL' });
    const early = await t.app.inject({ method: 'POST', url: '/v1/orgs/current/actions/submit-kyc', headers: auth(s) });
    expect(early.statusCode).toBe(422);
    expect(early.json().code).toBe('KYC_DOCUMENTS_MISSING');
    const bad = multipartBody({ docType: 'ninea' }, { name: 'evil.pdf', content: Buffer.from('MZ\u0090\u0000binary'), type: 'application/pdf' });
    const rejected = await t.app.inject({ method: 'POST', url: '/v1/orgs/current/kyc-documents', headers: { ...auth(s), ...bad.headers }, payload: bad.payload });
    expect(rejected.json().code).toBe('FILE_TYPE_NOT_ALLOWED');
    await uploadKyc(t, s, 'ninea');
    await uploadKyc(t, s, 'rccm');
    const docs = json<{ data: { docType: string; status: string }[] }>(await t.app.inject({ method: 'GET', url: '/v1/orgs/current/kyc-documents', headers: auth(s) }));
    expect(docs.data.map((d) => d.docType).sort()).toEqual(['ninea', 'rccm']);
    const sub = await t.app.inject({ method: 'POST', url: '/v1/orgs/current/actions/submit-kyc', headers: auth(s) });
    expectStatus(sub, 200);
    expect(sub.json().kycStatus).toBe('submitted');

    const admin = await adminSession(t);
    const queue = json<{ data: { id: string; legalName: string }[] }>(await t.app.inject({ method: 'GET', url: '/v1/admin/orgs?filter[kycStatus]=submitted', headers: auth(admin) }));
    expect(queue.data.map((o) => o.id)).toContain(s.orgId);
    const detail = json<{ kycDocuments: unknown[] }>(await t.app.inject({ method: 'GET', url: `/v1/admin/orgs/${s.orgId}`, headers: auth(admin) }));
    expect(detail.kycDocuments).toHaveLength(2);
    const adminInbox = json<{ data: { templateCode: string }[]; unreadCount: number }>(await t.app.inject({ method: 'GET', url: '/v1/notifications', headers: auth(admin) }));
    expect(adminInbox.data[0]!.templateCode).toBe('org.kyc_submitted');

    const noComment = await t.app.inject({ method: 'POST', url: `/v1/admin/orgs/${s.orgId}/kyc/actions/reject`, headers: auth(admin), payload: {} });
    expect(noComment.json().code).toBe('COMMENT_REQUIRED');
    const verify = await t.app.inject({ method: 'POST', url: `/v1/admin/orgs/${s.orgId}/kyc/actions/verify`, headers: auth(admin), payload: { comment: 'OK' } });
    expectStatus(verify, 200);
    expect(verify.json().kycStatus).toBe('verified');
    const again = await t.app.inject({ method: 'POST', url: `/v1/admin/orgs/${s.orgId}/kyc/actions/verify`, headers: auth(admin), payload: {} });
    expect(again.json().code).toBe('INVALID_STATE_TRANSITION');
    const inbox = json<{ data: { id: string; templateCode: string }[]; unreadCount: number }>(await t.app.inject({ method: 'GET', url: '/v1/notifications', headers: auth(s) }));
    expect(inbox.data[0]!.templateCode).toBe('org.kyc_verified');
    expect(inbox.unreadCount).toBe(1);
    expectStatus(await t.app.inject({ method: 'POST', url: `/v1/notifications/${inbox.data[0]!.id}/actions/read`, headers: auth(s) }), 200);
    // locked fields
    const lockedPatch = await t.app.inject({ method: 'PATCH', url: '/v1/orgs/current', headers: auth(s, { 'if-match': `"${verify.json().version}"` }), payload: { legalName: 'Autre' } });
    expect(lockedPatch.json().code).toBe('KYC_LOCKED_FIELDS');
    await flushNotifications(t);
    expect(t.email.outbox.some((m) => m.subject.includes('vérifiée'))).toBe(true);
    // verified orgs appear in directory only for listed types
    const dir = json<{ data: unknown[] }>(await t.app.inject({ method: 'GET', url: '/v1/orgs/directory?type=lender', headers: auth(s) }));
    expect(dir.data).toHaveLength(0);
  });

  it('forbids KYC review for non-admins', async () => {
    const s = await signup(t);
    const r = await t.app.inject({ method: 'POST', url: `/v1/admin/orgs/${s.orgId}/kyc/actions/verify`, headers: auth(s), payload: {} });
    expect(r.statusCode).toBe(403);
    expect((await t.app.inject({ method: 'GET', url: '/v1/admin/orgs', headers: auth(s) })).statusCode).toBe(403);
  });
});

describe('members and invitations', () => {
  it('invites a field agent who accepts, logs in and gets scoped permissions', async () => {
    const s = await signup(t);
    const badRole = await t.app.inject({ method: 'POST', url: '/v1/orgs/current/invitations', headers: auth(s), payload: { email: 'x@kawral.test', roles: ['credit_committee'] } });
    expect(badRole.json().code).toBe('ROLE_NOT_ALLOWED');
    const inv = await t.app.inject({ method: 'POST', url: '/v1/orgs/current/invitations', headers: auth(s), payload: { email: 'Agent@Kawral.test', roles: ['field_agent'] } });
    expectStatus(inv, 201);
    expect(inv.json().email).toBe('agent@kawral.test');
    await flushNotifications(t);
    const mail = t.email.outbox.find((m) => m.to === 'agent@kawral.test')!;
    const token = /token=([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
    const look = json<{ orgName: string; existingUser: boolean }>(await t.app.inject({ method: 'GET', url: `/v1/invitations/lookup?token=${token}` }));
    expect(look).toMatchObject({ orgName: 'Ferme Commune Kawral SARL', existingUser: false });
    const missing = await t.app.inject({ method: 'POST', url: '/v1/invitations/accept', payload: { token } });
    expect(missing.statusCode).toBe(400);
    const acc = await t.app.inject({ method: 'POST', url: '/v1/invitations/accept', payload: { token, fullName: 'Moussa Sané', password: PASSWORD } });
    expectStatus(acc, 200);
    const replay = await t.app.inject({ method: 'POST', url: '/v1/invitations/accept', payload: { token, fullName: 'Moussa Sané', password: PASSWORD } });
    expect(replay.statusCode).toBe(404);
    const agent = await login(t, 'agent@kawral.test', PASSWORD);
    const me = json<{ roles: string[]; permissions: string[] }>(await t.app.inject({ method: 'GET', url: '/v1/me', headers: auth(agent) }));
    expect(me.roles).toEqual(['field_agent']);
    expect(me.permissions).toContain('field:sync');
    expect(me.permissions).not.toContain('member:manage');
    expect((await t.app.inject({ method: 'GET', url: '/v1/orgs/current/members', headers: auth(agent) })).statusCode).toBe(403);
    const members = json<{ data: { email: string }[] }>(await t.app.inject({ method: 'GET', url: '/v1/orgs/current/members', headers: auth(s) }));
    expect(members.data).toHaveLength(2);
  });

  it('adds an existing user to a second org and requires X-Org-Id', async () => {
    const a = await signup(t, { email: 'multi@kawral.test' });
    const b = await signup(t, { orgType: 'buyer', legalName: 'Agro-Négoce Zeta SA', legalForm: 'SA' });
    await t.app.inject({ method: 'POST', url: '/v1/orgs/current/invitations', headers: auth(b), payload: { email: 'multi@kawral.test', roles: ['viewer'] } });
    await flushNotifications(t);
    const token = /token=([A-Za-z0-9_-]+)/.exec(t.email.outbox.find((m) => m.to === 'multi@kawral.test' && m.subject.includes('invitation'))!.text)![1]!;
    const wrong = await t.app.inject({ method: 'POST', url: '/v1/invitations/accept', payload: { token, password: 'not-the-password' } });
    expect(wrong.statusCode).toBe(401);
    expectStatus(await t.app.inject({ method: 'POST', url: '/v1/invitations/accept', payload: { token, password: PASSWORD } }), 200);
    const s = await login(t, 'multi@kawral.test', PASSWORD);
    const noOrg = await t.app.inject({ method: 'GET', url: '/v1/orgs/current', headers: auth(s) });
    expect(noOrg.json().code).toBe('ORG_REQUIRED');
    const inB = json<{ type: string }>(await t.app.inject({ method: 'GET', url: '/v1/orgs/current', headers: { ...auth(s), 'x-org-id': b.orgId! } }));
    expect(inB.type).toBe('buyer');
    const inA = json<{ type: string }>(await t.app.inject({ method: 'GET', url: '/v1/orgs/current', headers: { ...auth(s), 'x-org-id': a.orgId! } }));
    expect(inA.type).toBe('operator');
    const other = await signup(t);
    const notMember = await t.app.inject({ method: 'GET', url: '/v1/orgs/current', headers: { ...auth(s), 'x-org-id': other.orgId! } });
    expect(notMember.json().code).toBe('NOT_A_MEMBER');
  });

  it('keeps at least one org_admin', async () => {
    const s = await signup(t);
    const me = json<{ user: { id: string } }>(await t.app.inject({ method: 'GET', url: '/v1/me', headers: auth(s) }));
    const r = await t.app.inject({ method: 'PATCH', url: `/v1/orgs/current/members/${me.user.id}`, headers: auth(s), payload: { roles: ['operator_manager'] } });
    expect(r.json().code).toBe('LAST_ADMIN');
  });

  it('revokes invitations', async () => {
    const s = await signup(t);
    const inv = json<{ id: string }>(await t.app.inject({ method: 'POST', url: '/v1/orgs/current/invitations', headers: auth(s), payload: { phone: '+221770001122', roles: ['field_agent'] } }));
    await flushNotifications(t);
    expect(t.sms.sent.some((m) => m.to === '+221770001122')).toBe(true);
    expectStatus(await t.app.inject({ method: 'DELETE', url: `/v1/orgs/current/invitations/${inv.id}`, headers: auth(s) }), 200);
    const list = json<{ data: unknown[] }>(await t.app.inject({ method: 'GET', url: '/v1/orgs/current/invitations', headers: auth(s) }));
    expect(list.data).toHaveLength(0);
  });
});

describe('API keys', () => {
  it('creates, uses and revokes a key; roles must fit the org type', async () => {
    const s = await signup(t);
    const wrongType = await t.app.inject({ method: 'POST', url: '/v1/orgs/current/api-keys', headers: auth(s), payload: { name: 'wrong type', roles: ['credit_committee'] } });
    expect(wrongType.json().code).toBe('ROLE_NOT_ALLOWED');
    const created = await t.app.inject({ method: 'POST', url: '/v1/orgs/current/api-keys', headers: auth(s), payload: { name: 'ERP sync', roles: ['viewer'] } });
    expectStatus(created, 201);
    const key = created.json().key as string;
    expect(key).toMatch(/^jpk_[A-Za-z0-9]{8}_/);
    const viaKey = await t.app.inject({ method: 'GET', url: '/v1/orgs/current', headers: { 'x-api-key': key } });
    expectStatus(viaKey, 200);
    const viaHeader = await t.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `ApiKey ${key}` } });
    expect(viaHeader.json().principalType).toBe('api_key');
    const forbidden = await t.app.inject({ method: 'PATCH', url: '/v1/orgs/current', headers: { 'x-api-key': key, 'if-match': '"1"' }, payload: { region: 'X' } });
    expect(forbidden.statusCode).toBe(403);
    const list = json<{ data: { key?: string }[] }>(await t.app.inject({ method: 'GET', url: '/v1/orgs/current/api-keys', headers: auth(s) }));
    expect(list.data[0]!.key).toBeUndefined();
    expectStatus(await t.app.inject({ method: 'DELETE', url: `/v1/orgs/current/api-keys/${created.json().id}`, headers: auth(s) }), 200);
    expect((await t.app.inject({ method: 'GET', url: '/v1/orgs/current', headers: { 'x-api-key': key } })).statusCode).toBe(401);
  });
});

describe('files', () => {
  it('uploads, reads metadata and downloads via signed URL', async () => {
    const s = await signup(t);
    const mp = multipartBody({}, { name: 'plan.pdf', content: PDF_BYTES });
    const up = await t.app.inject({ method: 'POST', url: '/v1/files', headers: { ...auth(s), ...mp.headers }, payload: mp.payload });
    expectStatus(up, 201);
    expect(up.json()).toMatchObject({ mime: 'application/pdf', filename: 'plan.pdf' });
    const dl = await t.app.inject({ method: 'GET', url: `/v1/files/${up.json().id}/download`, headers: auth(s) });
    expect(dl.statusCode).toBe(302);
    const url = new URL(dl.headers.location as string);
    const raw = await t.app.inject({ method: 'GET', url: url.pathname + url.search });
    expectStatus(raw, 200);
    expect(raw.rawPayload.equals(PDF_BYTES)).toBe(true);
    const tampered = await t.app.inject({ method: 'GET', url: url.pathname + url.search.replace(/sig=./, 'sig=0') });
    expect(tampered.statusCode).toBe(404);
    const noFile = multipartBody({ a: 'b' }, { name: 'x.exe', content: Buffer.from([0x4d, 0x5a, 0, 0]) });
    expect((await t.app.inject({ method: 'POST', url: '/v1/files', headers: { ...auth(s), ...noFile.headers }, payload: noFile.payload })).statusCode).toBe(422);
  });
});

