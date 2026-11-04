import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { FieldBootstrap, SyncBody, SyncResult } from '@jappo/contracts';
import type { ModuleContext } from '../../core/module';
import * as svc from './service';

export async function fieldRoutes(app: FastifyInstance, ctx: ModuleContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get('/field/bootstrap', {
    schema: {
      operationId: 'fieldBootstrap',
      tags: ['field'],
      summary: 'Offline dataset for the field PWA (masked PII) with a sync token',
      'x-permission': 'field:sync',
      querystring: z.object({ blockIds: z.string().optional() }),
      response: { 200: FieldBootstrap },
    },
    handler: async (req) => svc.bootstrap(ctx.db, req.actor, (req.query.blockIds ?? '').split(',').filter((s) => /^[0-9a-f-]{36}$/i.test(s))),
  });
  r.post('/field/sync', {
    schema: { operationId: 'fieldSync', tags: ['field'], summary: 'Apply offline operations (idempotent by clientId) and return server changes', 'x-permission': 'field:sync', body: SyncBody, response: { 200: SyncResult } },
    handler: async (req) => svc.sync(ctx.db, req.actor, req.body),
  });
}
