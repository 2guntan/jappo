import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Alert, AlertActionBody, AlertCreateBody, AlertRule, AlertRuleUpdateBody, FieldVisit, FieldVisitCreateBody, IdParam, ServiceDelivery, ServiceDeliveryCreateBody } from '@jappo/contracts';
import type { ModuleContext } from '../../core/module';
import * as svc from './service';
import { loadBlock } from '../land/service';

export async function operationsRoutes(app: FastifyInstance, ctx: ModuleContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = ctx.db;
  r.get('/seasons/:id/service-deliveries', {
    schema: { operationId: 'listServiceDeliveries', tags: ['operations'], 'x-permission': 'service_delivery:read', params: IdParam, response: { 200: z.object({ data: z.array(ServiceDelivery) }) } },
    handler: async (q) => ({ data: await svc.listServiceDeliveries(db, q.actor, q.params.id) }),
  });
  r.post('/seasons/:id/service-deliveries', {
    schema: { operationId: 'recordServiceDelivery', tags: ['operations'], summary: 'Idempotent by offlineClientId; farmer acknowledgement by SMS code or signature photo', 'x-permission': 'service_delivery:record', params: IdParam, body: ServiceDeliveryCreateBody, response: { 201: ServiceDelivery } },
    handler: async (q, reply) => reply.status(201).send(await svc.createServiceDelivery(db, q.actor, q.params.id, q.body)),
  });
  r.post('/farmers/:id/actions/request-ack-code', {
    schema: { operationId: 'requestFarmerAckCode', tags: ['operations'], summary: 'SMS code for the farmer to acknowledge a service or harvest delivery', 'x-permission': 'harvest:record', params: IdParam, response: { 202: z.object({ destination: z.string() }) } },
    handler: async (q, reply) => reply.status(202).send(await svc.requestAckCode(db, q.actor, q.params.id)),
  });
  r.get('/plots/:id/visits', {
    schema: { operationId: 'listPlotVisits', tags: ['operations'], 'x-permission': 'visit:read', params: IdParam, response: { 200: z.object({ data: z.array(FieldVisit) }) } },
    handler: async (q) => ({ data: await svc.listVisits(db, q.actor, q.params.id) }),
  });
  r.post('/plots/:id/visits', {
    schema: { operationId: 'recordPlotVisit', tags: ['operations'], summary: 'Field visit; alert rules re-evaluated for the block', 'x-permission': 'visit:record', params: IdParam, body: FieldVisitCreateBody, response: { 201: FieldVisit } },
    handler: async (q, reply) => reply.status(201).send(await svc.createVisit(db, q.actor, q.params.id, q.body)),
  });
  r.get('/blocks/:id/alerts', {
    schema: { operationId: 'listBlockAlerts', tags: ['operations'], 'x-permission': 'alert:read', params: IdParam, querystring: z.object({ status: z.enum(['open', 'acknowledged', 'resolved']).optional() }), response: { 200: z.object({ data: z.array(Alert) }) } },
    handler: async (q) => ({ data: await svc.listAlerts(db, q.actor, q.params.id, q.query.status) }),
  });
  r.post('/blocks/:id/alerts', {
    schema: { operationId: 'createManualAlert', tags: ['operations'], 'x-permission': 'alert:manage', params: IdParam, body: AlertCreateBody, response: { 201: Alert } },
    handler: async (q, reply) => reply.status(201).send(await svc.createManualAlert(db, q.actor, q.params.id, q.body)),
  });
  r.post('/blocks/:id/alerts/actions/evaluate', {
    schema: { operationId: 'evaluateBlockAlerts', tags: ['operations'], summary: 'Run the alert rules for the block now', 'x-permission': 'alert:manage', params: IdParam, response: { 200: z.object({ raised: z.number().int(), resolved: z.number().int() }) } },
    handler: async (q) => {
      await loadBlock(db, q.actor, q.params.id, true);
      return svc.runAlertsForBlock(db, q.params.id);
    },
  });
  for (const action of ['acknowledge', 'resolve'] as const) {
    r.post(`/alerts/:id/actions/${action}`, {
      schema: { operationId: action === 'acknowledge' ? 'acknowledgeAlert' : 'resolveAlert', tags: ['operations'], 'x-permission': 'alert:manage', params: IdParam, body: AlertActionBody, response: { 200: Alert } },
      handler: async (q) => svc.actOnAlert(db, q.actor, q.params.id, action, q.body.note),
    });
  }
  r.get('/alert-rules', {
    schema: { operationId: 'listAlertRules', tags: ['operations'], 'x-permission': 'alert:read', response: { 200: z.object({ data: z.array(AlertRule) }) } },
    handler: async () => ({ data: await svc.listAlertRules(db) }),
  });
  r.patch('/alert-rules/:code', {
    schema: { operationId: 'updateAlertRule', tags: ['operations'], summary: 'Platform admin: enable/disable and tune parameters', 'x-permission': 'alert_rule:manage', params: z.object({ code: z.string() }), body: AlertRuleUpdateBody, response: { 200: AlertRule } },
    handler: async (q) => svc.updateAlertRule(db, q.actor, q.params.code, q.body),
  });
}
