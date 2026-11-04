import { describe, expect, it, beforeAll } from 'vitest';
import { hasPermission, permissionsFor, ROLE_PERMISSIONS } from '../../src/core/authz/permissions';
import { sniffMime } from '../../src/core/files/sniff';
import { validateModules } from '../../src/core/module';
import { ROLES } from '@jappo/contracts';
import { resetEnvCache } from '../../src/env';

beforeAll(() => {
  Object.assign(process.env, {
    JWT_SECRET: 'unit-secret-unit-secret-unit-secret-00',
    PII_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    PII_HMAC_KEY: 'unit-hmac-key-unit-hmac',
    FILE_URL_SIGNING_KEY: 'unit-file-key-unit-file-key',
  });
  resetEnvCache();
});

describe('permissions', () => {
  it('defines permissions for every role', () => {
    for (const r of ROLES) expect(ROLE_PERMISSIONS[r].length).toBeGreaterThan(0);
  });
  it('resolves wildcard and resource wildcard', () => {
    expect(hasPermission(permissionsFor(['platform_admin']), 'anything:here')).toBe(true);
    expect(hasPermission(new Set(['bid:*']), 'bid:submit')).toBe(true);
    expect(hasPermission(permissionsFor(['credit_officer']), 'bid:submit')).toBe(false);
    expect(hasPermission(permissionsFor(['credit_committee']), 'bid:submit')).toBe(true);
    expect(hasPermission(permissionsFor(['viewer']), 'block:create')).toBe(false);
  });
});

describe('crypto', () => {
  it('encrypts PII with AES-GCM and hashes deterministically', async () => {
    const { encryptPii, decryptPii, piiHash, mask } = await import('../../src/core/crypto');
    const enc = encryptPii('1 234 567 890 12');
    expect(enc).not.toContain('1234');
    expect(decryptPii(enc)).toBe('1 234 567 890 12');
    expect(encryptPii('x')).not.toBe(encryptPii('x'));
    expect(piiHash(' ABC ')).toBe(piiHash('abc'));
    expect(mask('+221771234417')).toBe('**** 4417');
    expect(() => decryptPii('v1.bad')).toThrow();
  });
  it('signs and verifies file URLs', async () => {
    const { signFileUrl, verifyFileUrl } = await import('../../src/core/files/storage');
    const exp = Math.floor(Date.now() / 1000) + 60;
    const sig = signFileUrl('k', 'id', exp);
    expect(verifyFileUrl('k', 'id', exp, sig)).toBe(true);
    expect(verifyFileUrl('k', 'id2', exp, sig)).toBe(false);
    expect(verifyFileUrl('k', 'id', 1, signFileUrl('k', 'id', 1))).toBe(false);
  });
  it('enforces the password policy', async () => {
    const { assertPasswordPolicy } = await import('../../src/core/auth/passwords');
    expect(() => assertPasswordPolicy('short')).toThrow();
    expect(() => assertPasswordPolicy('qwertyuiop')).toThrow(/breached/);
    expect(() => assertPasswordPolicy('Kawral-Secure-Pass-2026')).not.toThrow();
  });
  it('issues and verifies access tokens', async () => {
    const { signAccessToken, verifyAccessToken } = await import('../../src/core/auth/tokens');
    const t = await signAccessToken({ sub: 'u1', typ: 'user', mfa: true });
    expect(await verifyAccessToken(t)).toMatchObject({ sub: 'u1', mfa: true, typ: 'user' });
    expect(await verifyAccessToken(t + 'x')).toBeNull();
    const { generateTotp, newTotpSecret, verifyTotp } = await import('../../src/core/auth/totp');
    const s = newTotpSecret();
    expect(verifyTotp(s, generateTotp(s))).toBe(true);
  });
});

describe('MIME sniffing', () => {
  it('detects by magic bytes and refuses mismatches', () => {
    expect(sniffMime(Buffer.from('%PDF-1.7'), 'a.pdf')).toBe('application/pdf');
    expect(sniffMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'x.png')).toBe('image/png');
    expect(sniffMime(Buffer.from([0x50, 0x4b, 0x03, 0x04]), 'a.xlsx')).toContain('spreadsheetml');
    expect(sniffMime(Buffer.from('{"type":"FeatureCollection"}'), 'b.geojson')).toBe('application/geo+json');
    expect(sniffMime(Buffer.from('a,b\n1,2'), 'c.csv')).toBe('text/csv');
    expect(sniffMime(Buffer.from('<kml/>'), 'd.kml')).toContain('kml');
    expect(sniffMime(Buffer.from([0x4d, 0x5a, 0x00]), 'e.pdf')).toBeNull();
    expect(sniffMime(Buffer.from('hello'), 'f.txt')).toBeNull();
  });
});

describe('module registry', () => {
  it('orders by dependency and rejects cycles / missing / core→extension', () => {
    const order = validateModules([
      { name: 'b', version: '1', dependsOn: ['a'] },
      { name: 'a', version: '1' },
    ]);
    expect(order.map((m) => m.name)).toEqual(['a', 'b']);
    expect(() => validateModules([{ name: 'a', version: '1', dependsOn: ['b'] }, { name: 'b', version: '1', dependsOn: ['a'] }])).toThrow(/cycle/);
    expect(() => validateModules([{ name: 'a', version: '1', dependsOn: ['x'] }])).toThrow(/missing/);
    expect(() => validateModules([{ name: 'a', version: '1', core: true, dependsOn: ['e'] }, { name: 'e', version: '1' }])).toThrow(/Core/);
  });
});
