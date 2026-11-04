import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '../env';

const key = (): Buffer => {
  const k = Buffer.from(env().PII_ENCRYPTION_KEY, 'base64');
  if (k.length !== 32) throw new Error('PII_ENCRYPTION_KEY must be 32 bytes base64');
  return k;
};

/** AES-256-GCM encryption for PII at rest (SPEC §4.2). Output: v1.<iv>.<tag>.<ciphertext> base64url. */
export function encryptPii(plain: string, k: Buffer = key()): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptPii(enc: string, k: Buffer = key()): string {
  const [v, iv, tag, ct] = enc.split('.');
  if (v !== 'v1' || !iv || !tag || ct === undefined) throw new Error('Invalid ciphertext');
  const d = createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

/** Deterministic HMAC for uniqueness / lookup of encrypted PII. */
export const piiHash = (value: string): string =>
  createHmac('sha256', env().PII_HMAC_KEY).update(value.trim().toLowerCase()).digest('hex');

export const sha256 = (v: string | Buffer): string => createHash('sha256').update(v).digest('hex');
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
export const randomDigits = (n = 6): string => Array.from({ length: n }, () => randomInt(0, 10)).join('');

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export const hmacHex = (secret: string, data: string): string => createHmac('sha256', secret).update(data).digest('hex');

/** Mask a value for display: "**** 4417". */
export const mask = (v: string | null | undefined): string | null => (v ? `**** ${v.slice(-4)}` : null);
