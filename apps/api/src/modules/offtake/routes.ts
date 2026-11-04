import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { IdParam, OFFTAKE_STATUSES, OfftakeActionBody, OfftakeContract, OfftakeCreateBody, OfftakeUpdateBody, Uuid } from '@jappo/contracts';
import type { ModuleContext } from '../../core/module';
import * as svc from './service';
import { requireIfMatch, setEtag } from '../../core/etag';

export async function offtakeRoutes(app: FastifyInstance, ctx: ModuleContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = ctx.db;
  r.get('/offtake-contracts', {
    schema: { operationId: 'listOfftakeContracts', tags: ['offtake'], 'x-permission': 'offtake:read', querystring: z.object({ blockId: Uuid.optional(), 'filter[status]': z.enum(OFFTAKE_STATUSES).optional() }), response: { 200: z.object({ data: z.array(OfftakeContract) }) } },
    handler: async (req) => ({ data: await svc.listContracts(db, req.actor, { blockId: req.query.blockId, status: req.query['filter[status]'] }) }),
  });
  r.post('/offtake-contracts', {
    schema: { operationId: 'createOfftakeContract', tags: ['offtake'], 'x-permission': 'offtake:manage', body: OfftakeCreateBody, response: { 201: OfftakeContract } },
    handler: async (req, reply) => reply.status(201).send(await svc.getContract(db, req.actor, await svc.createContract(db, req.actor, req.body))),
  });
  r.get('/offtake-contracts/:id', {
    schema: { operationId: 'getOfftakeContract', tags: ['offtake'], 'x-permission': 'offtake:read', params: IdParam, response: { 200: OfftakeContract } },
    handler: async (req, reply) => {
      const c = await svc.getContract(db, req.actor, req.params.id);
      setEtag(reply, c.version);
      return c;
    },
  });
  r.patch('/offtake-contracts/:id', {
    schema: { operationId: 'updateOfftakeContract', tags: ['offtake'], 'x-permission': 'offtake:manage', params: IdParam, body: OfftakeUpdateBody, response: { 200: OfftakeContract } },
    handler: async (req) => {
      await svc.updateContract(db, req.actor, req.params.id, requireIfMatch(req), req.body);
      return svc.getContract(db, req.actor, req.params.id);
    },
  });
  for (const action of ['mark-loi', 'mark-signed', 'terminate'] as const) {
    r.post(`/offtake-contracts/:id/actions/${action}`, {
      schema: { operationId: { 'mark-loi': 'markOfftakeLoi', 'mark-signed': 'markOfftakeSigned', terminate: 'terminateOfftake' }[action], tags: ['offtake'], 'x-permission': 'offtake:manage', params: IdParam, body: OfftakeActionBody, response: { 200: OfftakeContract } },
      handler: async (req) => {
        await svc.transitionContract(db, req.actor, req.params.id, requireIfMatch(req), action, req.body);
        return svc.getContract(db, req.actor, req.params.id);
      },
    });
  }
  r.get('/buyer/contracts', {
    schema: { operationId: 'listBuyerContracts', tags: ['buyer'], summary: 'Offtake contracts where the current organisation is the buyer', 'x-permission': 'offtake:read', response: { 200: z.object({ data: z.array(OfftakeContract) }) } },
    handler: async (req) => ({ data: await svc.listContracts(db, req.actor, { buyerOnly: true }) }),
  });
}
