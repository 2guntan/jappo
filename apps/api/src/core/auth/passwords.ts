import { hash, verify } from '@node-rs/argon2';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { badRequest } from '../errors';

// Argon2id parameters (OWASP: m=19 MiB, t=2, p=1).
const OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1, algorithm: 2 } as const;

export const hashPassword = (pw: string): Promise<string> => hash(pw, OPTS);
export const verifyPassword = async (h: string, pw: string): Promise<boolean> => {
  try {
    return await verify(h, pw);
  } catch {
    return false;
  }
};

let breached: Set<string> | undefined;
function breachedSet(): Set<string> {
  if (!breached) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(here, '../../../assets/breached-passwords.txt.gz'),
      path.resolve(here, '../assets/breached-passwords.txt.gz'),
      path.resolve(process.cwd(), 'assets/breached-passwords.txt.gz'),
      path.resolve(process.cwd(), 'apps/api/assets/breached-passwords.txt.gz'),
    ];
    for (const c of candidates) {
      try {
        const txt = gunzipSync(readFileSync(c)).toString('utf8');
        breached = new Set(txt.split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter(Boolean));
        break;
      } catch {
        /* try next */
      }
    }
    if (!breached) throw new Error('breached-passwords list not found');
  }
  return breached;
}

/** SPEC §18.1: min 10 chars and not in local top-100k breached list. */
export function assertPasswordPolicy(pw: string): void {
  if (pw.length < 10) throw badRequest('PASSWORD_TOO_SHORT', 'Password must be at least 10 characters', [{ path: 'body.password', message: 'min 10 characters' }]);
  if (breachedSet().has(pw.toLowerCase())) {
    throw badRequest('PASSWORD_BREACHED', 'This password appears in a list of breached passwords', [{ path: 'body.password', message: 'breached password' }]);
  }
}
