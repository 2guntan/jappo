import { Secret, TOTP } from 'otpauth';

const totpFor = (secret: string, label = 'user') =>
  new TOTP({ issuer: 'Jappo', label, algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secret) });

export const newTotpSecret = (): string => new Secret({ size: 20 }).base32;
export const totpUrl = (secret: string, label: string): string => totpFor(secret, label).toString();
export const verifyTotp = (secret: string, code: string): boolean => totpFor(secret).validate({ token: code, window: 1 }) !== null;
export const generateTotp = (secret: string): string => totpFor(secret).generate();
