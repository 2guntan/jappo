import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { IdParam, ModelAssumptions, ModelAssumptionsBody, ModelPreviewBody, ModelRun } from '@jappo/contracts';
import type { ModuleContext } from '../../core/module';
import * as svc from './service';

export async function financeRoutes(app: FastifyInstance, ctx: ModuleContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = ctx.db;
  r.get('/seasons/:id/model-assumptions', {
    schema: { operationId: 'getModelAssumptions', tags: ['finance'], 'x-permission': 'model_run:read', params: IdParam, response: { 200: ModelAssumptions } },
    handler: async (req) => svc.assumptionsOut(db, req.actor, req.params.id),
  });
  r.put('/seasons/:id/model-assumptions', {
    schema: { operationId: 'putModelAssumptions', tags: ['finance'], summary: 'Tranche terms assumed for modelling (seasonal / investment)', 'x-permission': 'model_run:create', params: IdParam, body: ModelAssumptionsBody, response: { 200: ModelAssumptions } },
    handler: async (req) => svc.putAssumptions(db, req.actor, req.params.id, req.body),
  });
  r.post('/seasons/:id/model-runs', {
    schema: { operationId: 'runModel', tags: ['finance'], summary: 'Compute and store the block financial model (SPEC §9.1)', 'x-permission': 'model_run:create', params: IdParam, response: { 201: ModelRun } },
    handler: async (req, reply) => reply.status(201).send(await svc.runModel(db, req.actor, req.params.id)),
  });
  r.post('/seasons/:id/model-runs/preview', {
    schema: { operationId: 'previewModel', tags: ['finance'], summary: 'Unsaved what-if with yield/price shocks and rate', 'x-permission': 'model_run:read', params: IdParam, body: ModelPreviewBody, response: { 200: ModelRun } },
    handler: async (req) => svc.previewModel(db, req.actor, req.params.id, req.body),
  });
  r.get('/seasons/:id/model-runs/current', {
    schema: { operationId: 'getCurrentModelRun', tags: ['finance'], 'x-permission': 'model_run:read', params: IdParam, response: { 200: ModelRun } },
    handler: async (req) => svc.currentRun(db, req.actor, req.params.id),
  });
  r.get('/model-runs/:id', {
    schema: { operationId: 'getModelRun', tags: ['finance'], 'x-permission': 'model_run:read', params: IdParam, response: { 200: ModelRun } },
    handler: async (req) => svc.getRun(db, req.actor, req.params.id),
  });
}
