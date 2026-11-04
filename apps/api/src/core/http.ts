import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { canonicalJson } from '@jappo/domain';
import { and, eq, lt } from 'drizzle-orm';
import type { ActorContext } from './context';
import { principalId } from './context';
import { resolveActor } from './auth/principal';
import { hasPermission } from './authz/permissions';
import { conflict, forbidden, unauthorized, unprocessable } from './errors';
import { idempotencyKeys } from './schema';
import { sha256 } from './crypto';
import type { Db } from '../db/client';

declare module 'fastify' {
  interface FastifySchema {
    'x-permission'?: string;
  }
  interface FastifyRequest {
    actor: ActorContext;
    idempotency?: { id: string };
  }
  interface FastifyInstance {
    db: Db;
  }
}

const MFA_EXEMPT = new Set(['getMe', 'mfaEnroll', 'mfaActivate', 'logout', 'listMyNotifications']);

/** Authentication (actor resolution) and per-route permission enforcement (SPEC §6.2). */
export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('actor', null as unknown as ActorContext);

  app.addHook('onRoute', (r) => {
    if (!r.url.startsWith('/v1') || r.url.startsWith('/v1/docs')) return;
    if (!r.schema?.['x-permission']) throw new Error(`Route ${r.method} ${r.url} must declare x-permission`);
    if (!r.schema.operationId) throw new Error(`Route ${r.method} ${r.url} must declare operationId`);
  });

  app.addHook('onRequest', async (req) => {
    req.actor = await resolveActor(app.db, req);
  });

  app.addHook('preValidation', async (req) => {
    const perm = req.routeOptions.schema?.['x-permission'];
    if (!perm || perm === 'public') return;
    const a = req.actor;
    if (perm === 'farmer') {
      if (a.principal.type !== 'farmer') throw unauthorized();
      return;
    }
    if (a.principal.type !== 'user' && a.principal.type !== 'api_key') throw unauthorized();
    if (a.mfaEnrolmentRequired && !MFA_EXEMPT.has(req.routeOptions.schema?.operationId ?? '')) {
      throw forbidden('MFA_ENROLMENT_REQUIRED', 'Your role requires two-factor authentication. Enrol before continuing.');
    }
    if (perm === 'authenticated') return;
    if (!a.orgId) throw forbidden('ORG_REQUIRED', 'Select an organisation (X-Org-Id header)');
    if (a.orgSuspended && req.method !== 'GET') throw forbidden('ORG_SUSPENDED');
    if (!hasPermission(a.permissions, perm)) throw forbidden('FORBIDDEN', `Missing permission ${perm}`);
  });
});

const IDEM_TTL_MS = 24 * 3600 * 1000;

/** Idempotency-Key support for POST (SPEC §4.1): replay stored response for the same key + principal + route. */
export const idempotencyPlugin = fp(async (app: FastifyInstance) => {
  app.addHook('preHandler', async (req: FastifyRequest, reply) => {
    if (req.method !== 'POST') return;
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length === 0) return;
    if (key.length > 200) throw unprocessable('IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key too long');
    const pid = principalId(req.actor);
    const route = `${req.method} ${req.routeOptions.url}`;
    const reqHash = sha256(canonicalJson({ params: req.params, body: req.isMultipart() ? null : req.body, org: req.actor.orgId }));
    await app.db.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, new Date()));
    const inserted = await app.db
      .insert(idempotencyKeys)
      .values({ key, principalId: pid, route, requestHash: reqHash, expiresAt: new Date(Date.now() + IDEM_TTL_MS) })
      .onConflictDoNothing()
      .returning({ id: idempotencyKeys.id });
    if (inserted[0]) {
      req.idempotency = { id: inserted[0].id };
      return;
    }
    const [existing] = await app.db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.principalId, pid), eq(idempotencyKeys.route, route)));
    if (!existing) return;
    if (existing.requestHash !== reqHash) throw unprocessable('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was used with a different request');
    if (existing.responseStatus === null) throw conflict('IDEMPOTENCY_IN_PROGRESS', 'A request with this Idempotency-Key is in progress');
    reply.header('Idempotent-Replayed', 'true');
    return reply.status(existing.responseStatus).send(existing.responseBody);
  });

  app.addHook('onSend', async (req, reply, payload) => {
    if (!req.idempotency) return payload;
    const status = reply.statusCode;
    if (status >= 500) {
      await app.db.delete(idempotencyKeys).where(eq(idempotencyKeys.id, req.idempotency.id));
      return payload;
    }
    let body: unknown = null;
    if (typeof payload === 'string') {
      try {
        body = JSON.parse(payload);
      } catch {
        body = payload;
      }
    }
    await app.db.update(idempotencyKeys).set({ responseStatus: status, responseBody: body as object }).where(eq(idempotencyKeys.id, req.idempotency.id));
    return payload;
  });
});
