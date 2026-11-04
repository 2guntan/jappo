import type { FastifyReply, FastifyRequest } from 'fastify';
import { preconditionFailed, preconditionRequired } from './errors';

export const setEtag = (reply: FastifyReply, version: number): FastifyReply => reply.header('ETag', `"${version}"`);

/** Parse If-Match (required for PATCH/PUT/transitions, SPEC §4.1). Returns the expected version. */
export function requireIfMatch(req: FastifyRequest): number {
  const h = req.headers['if-match'];
  if (!h || Array.isArray(h)) throw preconditionRequired();
  const v = Number(h.replace(/^W\//, '').replace(/"/g, ''));
  if (!Number.isInteger(v)) throw preconditionFailed('If-Match must be a quoted version number');
  return v;
}

export function assertVersion(expected: number, actual: number): void {
  if (expected !== actual) throw preconditionFailed(`Expected version ${actual}, got ${expected}`);
}
