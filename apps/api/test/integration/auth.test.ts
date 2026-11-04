import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_TOTP, PASSWORD, auth, createTestApp, expectStatus, flushNotifications, generateTotp, json, login, resetDb, signup, type TestApp } from '../helpers';
import { users } from '../../src/modules/identity/schema';
import { notifications } from '../../src/modules/notifications/schema';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());
beforeEach(async () => resetDb(t));

const tokenFromLink = (body: string) => /token=([A-Za-z0-9_-]+)/.exec(body)![1]!;

describe('signup and login', () => {
  it('signs up an operator with org_admin + operator_manager and pending KYC', async () => {
    const s = await signup(t, { email: 'awa@kawral.test' });
    const me = json<{ roles: string[]; memberships: { kycStatus: string; orgType: string }[]; user: { emailVerified: boolean } }>(
      await t.app.inject({ method: 'GET', url: '/v1/me', headers: auth(s) }),
    );
    expect(me.roles.sort()).toEqual(['operator_manager', 'org_admin']);
    expect(me.memberships[0]).toMatchObject({ kycStatus: 'pending', orgType: 'operator' });
    expect(me.user.emailVerified).toBe(false);
    // verification email
    expect(await flushNotifications(t)).toBeGreaterThan(0);
    const mail = t.email.outbox.find((m) => m.to === 'awa@kawral.test')!;
    expect(mail.subject).toContain('confirmez');
    const v = await t.app.inject({ method: 'POST', url: '/v1/auth/verify-email', payload: { token: tokenFromLink(mail.text) } });
    expectStatus(v, 200);
    const again = await t.app.inject({ method: 'POST', url: '/v1/auth/verify-email', payload: { token: tokenFromLink(mail.text) } });
    expect(again.json().code).toBe('TOKEN_INVALID');
  });

  it('rejects duplicate email, short and breached passwords, missing lenderKind', async () => {
    await signup(t, { email: 'dup@kawral.test' });
    const dup = await t.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { orgType: 'operator', legalName: 'X SARL', legalForm: 'SARL', fullName: 'X Y', email: 'dup@kawral.test', password: PASSWORD } });
    expect(dup.statusCode).toBe(409);
    const breached = await t.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { orgType: 'operator', legalName: 'X SARL', legalForm: 'SARL', fullName: 'X Y', email: 'b@kawral.test', password: 'password123' } });
    expect(breached.statusCode).toBe(400);
    expect(breached.json().code).toBe('PASSWORD_BREACHED');
    const short = await t.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { orgType: 'operator', legalName: 'X SARL', legalForm: 'SARL', fullName: 'X Y', email: 'c@kawral.test', password: 'short' } });
    expect(short.statusCode).toBe(400);
    expect(short.headers['content-type']).toContain('application/problem+json');
    expect(short.json()).toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    const lender = await t.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { orgType: 'lender', legalName: 'Banque X', legalForm: 'SA', fullName: 'X Y', email: 'l@kawral.test', password: PASSWORD } });
    expect(lender.json().errors[0].path).toBe('body.lenderKind');
  });

  it('logs in, locks after 10 failures', async () => {
    await signup(t, { email: 'lock@kawral.test' });
    expectStatus(await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'lock@kawral.test', password: PASSWORD } }), 200);
    for (let i = 0; i < 10; i++) {
      const r = await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'lock@kawral.test', password: 'wrong-password!' } });
      expect(r.statusCode).toBe(401);
    }
    const locked = await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'lock@kawral.test', password: PASSWORD } });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().code).toBe('ACCOUNT_LOCKED');
    const unknown = await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'nobody@kawral.test', password: PASSWORD } });
    expect(unknown.json().code).toBe('INVALID_CREDENTIALS');
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const s = await signup(t);
    const noCsrf = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: s.cookies });
    expect(noCsrf.json().code).toBe('CSRF_FAILED');
    const r1 = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: s.cookies, headers: { 'x-csrf-token': s.csrf } });
    expectStatus(r1, 200);
    const newCookies = Object.fromEntries(r1.cookies.map((c) => [c.name, c.value]));
    expect(newCookies.jappo_rt).not.toBe(s.cookies.jappo_rt);
    // reuse the old token → family revoked
    const reuse = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: s.cookies, headers: { 'x-csrf-token': s.csrf } });
    expect(reuse.json().code).toBe('REFRESH_TOKEN_REUSED');
    const after = await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: newCookies, headers: { 'x-csrf-token': newCookies.jappo_csrf! } });
    expect(after.statusCode).toBe(401);
  });

  it('logs out and resets password', async () => {
    const s = await signup(t, { email: 'reset@kawral.test' });
    const lo = await t.app.inject({ method: 'POST', url: '/v1/auth/logout', cookies: s.cookies, headers: { 'x-csrf-token': s.csrf } });
    expectStatus(lo, 200);
    expect((await t.app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: s.cookies, headers: { 'x-csrf-token': s.csrf } })).statusCode).toBe(401);
    expectStatus(await t.app.inject({ method: 'POST', url: '/v1/auth/password/forgot', payload: { email: 'reset@kawral.test' } }), 202);
    expectStatus(await t.app.inject({ method: 'POST', url: '/v1/auth/password/forgot', payload: { email: 'unknown@kawral.test' } }), 202);
    await flushNotifications(t);
    const mail = t.email.outbox.find((m) => m.subject.includes('mot de passe'))!;
    expectStatus(await t.app.inject({ method: 'POST', url: '/v1/auth/password/reset', payload: { token: tokenFromLink(mail.text), password: 'Another-Strong-Pass-99' } }), 200);
    await login(t, 'reset@kawral.test', 'Another-Strong-Pass-99');
  });

  it('rejects invalid and missing tokens with 401 problem documents', async () => {
    const r = await t.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: 'Bearer nope' } });
    expect(r.statusCode).toBe(401);
    expect(r.json().code).toBe('INVALID_TOKEN');
    expect((await t.app.inject({ method: 'GET', url: '/v1/me' })).statusCode).toBe(401);
  });
});

describe('MFA', () => {
  it('requires TOTP for the platform admin', async () => {
    const no = await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    expect(no.json().code).toBe('MFA_REQUIRED');
    const bad = await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, totp: '000000' } });
    expect(bad.json().code).toBe('MFA_INVALID');
    await login(t, ADMIN_EMAIL, ADMIN_PASSWORD, generateTotp(ADMIN_TOTP));
  });

  it('forces enrolment for a credit_committee member, then works', async () => {
    const s = await signup(t, { orgType: 'lender', lenderKind: 'sfd', legalName: 'Mutuelle Alpha SFD', legalForm: 'mutuelle', email: 'cc@alpha.test' });
    // promote self to credit_committee
    const me = json<{ user: { id: string } }>(await t.app.inject({ method: 'GET', url: '/v1/me', headers: auth(s) }));
    expectStatus(await t.app.inject({ method: 'PATCH', url: `/v1/orgs/current/members/${me.user.id}`, headers: auth(s), payload: { roles: ['org_admin', 'credit_committee'] } }), 200);
    const blocked = await t.app.inject({ method: 'GET', url: '/v1/orgs/current', headers: auth(s) });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe('MFA_ENROLMENT_REQUIRED');
    const meNow = json<{ mfaEnrolmentRequired: boolean }>(await t.app.inject({ method: 'GET', url: '/v1/me', headers: auth(s) }));
    expect(meNow.mfaEnrolmentRequired).toBe(true);
    const enrol = json<{ secret: string; otpauthUrl: string }>(await t.app.inject({ method: 'POST', url: '/v1/auth/mfa/enroll', headers: auth(s) }));
    expect(enrol.otpauthUrl).toContain('otpauth://totp/');
    const act = await t.app.inject({ method: 'POST', url: '/v1/auth/mfa/activate', headers: auth(s), payload: { code: generateTotp(enrol.secret) } });
    expectStatus(act, 200);
    expect(act.json().mfaEnrolmentRequired).toBe(false);
    expectStatus(await t.app.inject({ method: 'GET', url: '/v1/orgs/current', headers: { authorization: `Bearer ${act.json().accessToken}` } }), 200);
    expect((await t.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'cc@alpha.test', password: PASSWORD } })).json().code).toBe('MFA_REQUIRED');
  });
});

describe('phone OTP', () => {
  it('logs in by SMS code, limits requests and attempts', async () => {
    const s = await signup(t, { email: 'otp@kawral.test' });
    await t.ctx.db.update(users).set({ phone: '+221771234567' }).where(eq(users.email, 'otp@kawral.test'));
    expectStatus(await t.app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone: '+221771234567' } }), 202);
    // unknown phone: same response, nothing sent
    expectStatus(await t.app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone: '+221770000000' } }), 202);
    await flushNotifications(t);
    expect(t.sms.sent).toHaveLength(1);
    const code = /(\d{6})/.exec(t.sms.sent[0]!.text)![1]!;
    const wrong = await t.app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { phone: '+221771234567', code: code === '111111' ? '222222' : '111111' } });
    expect(wrong.json().code).toBe('OTP_INVALID');
    const ok = await t.app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { phone: '+221771234567', code } });
    expectStatus(ok, 200);
    expect(s.orgId).toBeTruthy();
    // 3 per 10 minutes
    await t.app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone: '+221771234567' } });
    await t.app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone: '+221771234567' } });
    const limited = await t.app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone: '+221771234567' } });
    expect(limited.json().code).toBe('OTP_RATE_LIMITED');
    // brute force: 5 attempts then locked
    for (let i = 0; i < 5; i++) await t.app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { phone: '+221771234567', code: '000000' } });
    const locked = await t.app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { phone: '+221771234567', code: '000000' } });
    expect(locked.json().code).toBe('OTP_LOCKED');
    const rows = await t.ctx.db.select().from(notifications).where(eq(notifications.channel, 'sms'));
    expect(rows.every((r) => r.body?.includes('Jappo'))).toBe(true);
  });
});
