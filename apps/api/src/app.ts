import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { jsonSchemaTransform, jsonSchemaTransformObject, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import client from 'prom-client';
import type { ModuleContext } from './core/module';
import { MODULES } from './modules';
import { errorHandler, notFound, sendProblem } from './core/errors';
import { authPlugin, idempotencyPlugin } from './core/http';
import { MAX_UPLOAD_BYTES } from './core/files/sniff';
import { principalId } from './core/context';
import { VERSION, readinessChecks } from './modules/system/routes';

export interface BuildOptions {
  ctx: ModuleContext;
  logger?: FastifyServerOptions['logger'];
}

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });
const httpDuration = new client.Histogram({
  name: 'jappo_http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.01, 0.05, 0.1, 0.3, 1, 3],
  registers: [registry],
});

export async function buildApp({ ctx, logger }: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: logger ?? { level: ctx.env.LOG_LEVEL, redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]'] },
    genReqId: (req) => (typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'].slice(0, 100) : randomUUID()),
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler((req, reply) => sendProblem(reply, req, notFound('Route')));
  app.decorate('db', ctx.db);

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Request-Id', req.id);
    return payload;
  });
  app.addHook('onResponse', async (req, reply) => {
    httpDuration.observe({ method: req.method, route: req.routeOptions.url ?? 'unknown', status: String(reply.statusCode) }, reply.elapsedTime / 1000);
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: ctx.env.WEB_ORIGIN.split(','), credentials: true, exposedHeaders: ['ETag', 'X-Request-Id', 'Idempotent-Replayed'] });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES } });
  await app.register(authPlugin);
  if (ctx.env.RATE_LIMIT_ENABLED) {
    await app.register(rateLimit, {
      global: true,
      max: 300,
      timeWindow: '1 minute',
      hook: 'preHandler',
      keyGenerator: (req) => (req.actor && req.actor.principal.type !== 'anonymous' ? principalId(req.actor) : req.ip),
    });
  }
  await app.register(idempotencyPlugin);

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: 'Jappo API', version: VERSION, description: 'Block farm finance platform — public API (SPEC §10).' },
      servers: [{ url: '/' }],
      components: {
        securitySchemes: {
          bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          apiKey: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
        },
      },
      security: [{ bearer: [] }, { apiKey: [] }],
    },
    transform: jsonSchemaTransform,
    // Component `$id`s from Zod (`#/components/schemas/X`) are not valid JSON-Schema ids for OAS 3.1 linters (Spectral).
    transformObject: (doc) => {
      const out = jsonSchemaTransformObject(doc) as { components?: { schemas?: Record<string, Record<string, unknown>> }; paths?: Record<string, Record<string, { tags?: string[] }>>; tags?: { name: string }[] };
      for (const s of Object.values(out.components?.schemas ?? {})) delete s.$id;
      const tags = new Set<string>();
      for (const ops of Object.values(out.paths ?? {})) for (const op of Object.values(ops)) for (const t of op.tags ?? []) tags.add(t);
      out.tags = [...tags].sort().map((name) => ({ name }));
      return out as ReturnType<typeof jsonSchemaTransformObject>;
    },
  });
  await app.register(swaggerUi, { routePrefix: '/v1/docs' });

  // Probes outside /v1 for container orchestration; /metrics is meant for the internal network only.
  app.get('/health', { schema: { hide: true } }, async () => ({ status: 'ok', version: VERSION }));
  app.get('/ready', { schema: { hide: true } }, async (_req, reply) => {
    const checks = await readinessChecks(ctx);
    return reply.status(Object.values(checks).every(Boolean) ? 200 : 503).send({ checks });
  });
  app.get('/metrics', { schema: { hide: true } }, async (_req, reply) => reply.type(registry.contentType).send(await registry.metrics()));

  await app.register(
    async (v1) => {
      v1.get('/openapi.json', { schema: { hide: true, operationId: 'openapi', 'x-permission': 'public' } }, async () => app.swagger());
      for (const m of MODULES) if (m.routes) await m.routes(v1, ctx);
    },
    { prefix: '/v1' },
  );
  return app;
}
