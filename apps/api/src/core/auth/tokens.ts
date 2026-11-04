import { SignJWT, jwtVerify } from 'jose';
import { env } from '../../env';

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_DAYS = 30;
const secret = () => new TextEncoder().encode(env().JWT_SECRET);
const ISSUER = 'jappo';

export interface AccessClaims {
  sub: string;
  typ: 'user' | 'farmer';
  mfa: boolean;
  fam?: string;
  orgs?: string[];
  org?: string;
}

export async function signAccessToken(c: AccessClaims, ttl = ACCESS_TTL_SECONDS): Promise<string> {
  return new SignJWT({ typ: c.typ, mfa: c.mfa, fam: c.fam, orgs: c.orgs, org: c.org })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(c.sub)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(secret());
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER, algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string') return null;
    return {
      sub: payload.sub,
      typ: payload.typ === 'farmer' ? 'farmer' : 'user',
      mfa: payload.mfa === true,
      fam: typeof payload.fam === 'string' ? payload.fam : undefined,
      orgs: Array.isArray(payload.orgs) ? (payload.orgs as string[]) : undefined,
      org: typeof payload.org === 'string' ? payload.org : undefined,
    };
  } catch {
    return null;
  }
}
