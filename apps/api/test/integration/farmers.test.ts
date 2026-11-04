import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auth, createFarmer, createTestApp, expectStatus, flushNotifications, json, multipartBody, resetDb, signup, type Session, type TestApp } from '../helpers';
import { farmers } from '../../src/modules/farmers/schema';
import { auditLog } from '../../src/core/schema';

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

describe('farmers', () => {
  it('creates a farmer with encrypted, masked PII and sequential codes', async () => {
    const a = await createFarmer(t, op, { phone: '+221771110001', nationalIdType: 'cni', nationalIdNumber: '1 751 1988 01234', mobileWalletProvider: 'wave', mobileWalletNumber: '+221771110001', homeLocation: { type: 'Point', coordinates: [-16.27, 12.58] } });
    const b = await createFarmer(t, op, { firstName: 'Fatou', phone: '+221771110002' });
    expect(a.code).toBe('F-000001');
    expect(b.code).toBe('F-000002');
    const got = json<Record<string, unknown>>(await t.app.inject({ method: 'GET', url: `/v1/farmers/${a.id}`, headers: auth(op) }));
    expect(got).toMatchObject({ nationalIdNumberMasked: '**** 1234', mobileWalletNumberMasked: '**** 0001', kycStatus: 'pending', homeLocation: { type: 'Point' } });
    expect(JSON.stringify(got)).not.toContain('175119880');
    const [row] = await t.ctx.db.select().from(farmers).where(eq(farmers.id, a.id));
    expect(row!.nationalIdNumberEnc).toMatch(/^v1\./);
    expect(row!.nationalIdNumberEnc).not.toContain('1234');
    // reveal requires reason and is audited
    expect((await t.app.inject({ method: 'GET', url: `/v1/farmers/${a.id}/pii`, headers: auth(op) })).statusCode).toBe(400);
    const pii = json<{ nationalIdNumber: string }>(await t.app.inject({ method: 'GET', url: `/v1/farmers/${a.id}/pii?reason=Contr%C3%B4le%20dossier`, headers: auth(op) }));
    expect(pii.nationalIdNumber).toBe('1751198801234');
    const audits = await t.ctx.db.select().from(auditLog).where(eq(auditLog.action, 'farmer.pii_revealed'));
    expect(audits).toHaveLength(1);
    const list = json<{ data: unknown[] }>(await t.app.inject({ method: 'GET', url: '/v1/farmers?q=Fatou', headers: auth(op) }));
    expect(list.data).toHaveLength(1);
  });

  it('enforces uniqueness per operator and flags cross-operator duplicates', async () => {
    await createFarmer(t, op, { phone: '+221771110001', nationalIdType: 'cni', nationalIdNumber: '1751198801234' });
    const dupPhone = await t.app.inject({ method: 'POST', url: '/v1/farmers', headers: auth(op), payload: { firstName: 'X', lastName: 'Y', sex: 'M', consentData: true, phone: '+221771110001' } });
    expect(dupPhone.statusCode).toBe(409);
    expect(dupPhone.json()).toMatchObject({ code: 'FARMER_DUPLICATE', field: 'phone' });
    const dupId = await t.app.inject({ method: 'POST', url: '/v1/farmers', headers: auth(op), payload: { firstName: 'X', lastName: 'Y', sex: 'M', consentData: true, nationalIdType: 'cni', nationalIdNumber: '1751 1988 01234' } });
    expect(dupId.json().code).toBe('FARMER_DUPLICATE');
    const other = await signup(t, { legalName: 'Autre Opérateur SARL' });
    const f = await createFarmer(t, other, { nationalIdType: 'cni', nationalIdNumber: '1751198801234' });
    const got = json<{ flags: { type: string }[] }>(await t.app.inject({ method: 'GET', url: `/v1/farmers/${f.id}`, headers: auth(other) }));
    expect(got.flags.map((x) => x.type)).toEqual(['duplicate_suspected']);
  });

  it('verifies KYC with If-Match, requires consent, resets on identity change', async () => {
    const noConsent = await createFarmer(t, op, { consentData: false, nationalIdType: 'cni', nationalIdNumber: '1751198809999' });
    const r1 = await t.app.inject({ method: 'POST', url: `/v1/farmers/${noConsent.id}/actions/verify-kyc`, headers: auth(op, { 'if-match': '"1"' }) });
    expect(r1.json().code).toBe('FARMER_KYC_INCOMPLETE');
    const f = await createFarmer(t, op, { nationalIdType: 'cni', nationalIdNumber: '1751198801111' });
    expect((await t.app.inject({ method: 'POST', url: `/v1/farmers/${f.id}/actions/verify-kyc`, headers: auth(op) })).statusCode).toBe(428);
    const ok = await t.app.inject({ method: 'POST', url: `/v1/farmers/${f.id}/actions/verify-kyc`, headers: auth(op, { 'if-match': '"1"' }) });
    expectStatus(ok, 200);
    expect(ok.json()).toMatchObject({ kycStatus: 'verified', version: 2 });
    const upd = await t.app.inject({ method: 'PATCH', url: `/v1/farmers/${f.id}`, headers: auth(op, { 'if-match': '"2"' }), payload: { village: 'Niaguis' } });
    expect(upd.json().kycStatus).toBe('verified');
    const idChange = await t.app.inject({ method: 'PATCH', url: `/v1/farmers/${f.id}`, headers: auth(op, { 'if-match': '"3"' }), payload: { lastName: 'Badji' } });
    expect(idChange.json().kycStatus).toBe('pending');
  });

  it('verifies a mobile wallet by OTP', async () => {
    const f = await createFarmer(t, op, { mobileWalletProvider: 'wave', mobileWalletNumber: '+221775550001' });
    expectStatus(await t.app.inject({ method: 'POST', url: `/v1/farmers/${f.id}/actions/verify-wallet`, headers: auth(op) }), 202);
    await flushNotifications(t);
    const sms = t.sms.sent.find((m) => m.to === '+221775550001')!;
    const code = /(\d{6})/.exec(sms.text)![1]!;
    const bad = await t.app.inject({ method: 'POST', url: `/v1/farmers/${f.id}/actions/confirm-wallet`, headers: auth(op), payload: { code: code === '000000' ? '111111' : '000000' } });
    expect(bad.json().code).toBe('OTP_INVALID');
    const ok = await t.app.inject({ method: 'POST', url: `/v1/farmers/${f.id}/actions/confirm-wallet`, headers: auth(op), payload: { code } });
    expectStatus(ok, 200);
    expect(ok.json().walletVerifiedAt).toBeTruthy();
    // changing the wallet number resets verification
    const changed = await t.app.inject({ method: 'PATCH', url: `/v1/farmers/${f.id}`, headers: auth(op, { 'if-match': `"${ok.json().version}"` }), payload: { mobileWalletNumber: '+221775550002' } });
    expect(changed.json().walletVerifiedAt).toBeNull();
  });

  it('imports CSV idempotently with row-level errors', async () => {
    const tpl = await t.app.inject({ method: 'GET', url: '/v1/farmers/import-template', headers: auth(op) });
    expect(tpl.headers['content-type']).toContain('text/csv');
    const csv = [
      'first_name;last_name;sex;birth_year;phone;village;national_id_number;mobile_wallet_provider;mobile_wallet_number;consent_data;consent_credit_bureau',
      'Awa;Diatta;F;1988;+221771230001;Niaguis;1751198800001;wave;+221771230001;oui;oui',
      'Mariama;Sané;F;1995;+221771230002;Niaguis;;;;oui;non',
      ';Badji;X;19x;0771230003;;;;;;',
    ].join('\n');
    const mp = multipartBody({}, { name: 'farmers.csv', content: Buffer.from(csv) });
    const r1 = json<{ created: number; updated: number; failed: number; rows: { row: number; status: string; errors: { field: string }[] }[] }>(
      await t.app.inject({ method: 'POST', url: '/v1/farmers/import', headers: { ...auth(op), ...mp.headers }, payload: mp.payload }),
    );
    expect(r1).toMatchObject({ created: 2, updated: 0, failed: 1 });
    expect(r1.rows[2]!.errors.map((e) => e.field).sort()).toEqual(['birthYear', 'first_name', 'phone', 'sex']);
    const mp2 = multipartBody({}, { name: 'farmers.csv', content: Buffer.from(csv) });
    const r2 = json<{ created: number; updated: number }>(await t.app.inject({ method: 'POST', url: '/v1/farmers/import', headers: { ...auth(op), ...mp2.headers }, payload: mp2.payload }));
    expect(r2).toMatchObject({ created: 0, updated: 2 });
    const all = json<{ data: { consentCreditBureauAt: string | null; firstName: string }[] }>(await t.app.inject({ method: 'GET', url: '/v1/farmers', headers: auth(op) }));
    expect(all.data).toHaveLength(2);
    expect(all.data.find((f) => f.firstName === 'Mariama')!.consentCreditBureauAt).toBeNull();
  });

  it('only operators manage farmers', async () => {
    const lender = await signup(t, { orgType: 'lender', lenderKind: 'bank', legalName: 'Banque Beta SA', legalForm: 'SA' });
    expect((await t.app.inject({ method: 'POST', url: '/v1/farmers', headers: auth(lender), payload: { firstName: 'A', lastName: 'B', sex: 'F', consentData: true } })).statusCode).toBe(403);
  });
});
