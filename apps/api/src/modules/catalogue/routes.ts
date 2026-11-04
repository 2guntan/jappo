import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { Crop, CropCreateBody, CropTemplate, CropTemplateCreateBody, CropTemplateUpdateBody, IdParam, MarketPrice, MarketPriceCreateBody, SERVICE_KINDS, Service, ServiceCreateBody, ServiceUpdateBody, Uuid, Zone } from '@jappo/contracts';
import type { ModuleContext } from '../../core/module';
import * as svc from './service';
import { requireIfMatch, setEtag } from '../../core/etag';

export async function catalogueRoutes(app: FastifyInstance, ctx: ModuleContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = ctx.db;
  r.get('/crops', {
    schema: { operationId: 'listCrops', tags: ['catalogue'], 'x-permission': 'catalogue:read', response: { 200: z.object({ data: z.array(Crop) }) } },
    handler: async () => ({ data: await svc.listCrops(db) }),
  });
  r.post('/admin/crops', {
    schema: { operationId: 'adminCreateCrop', tags: ['admin'], 'x-permission': 'admin:catalogue', body: CropCreateBody, response: { 201: Crop } },
    handler: async (req, reply) => {
      const c = await svc.createCrop(db, req.actor, req.body);
      return reply.status(201).send({ id: c.id, code: c.code, nameFr: c.nameFr, nameEn: c.nameEn, category: c.category, perishable: c.perishable, varieties: [] });
    },
  });
  r.get('/zones', {
    schema: { operationId: 'listZones', tags: ['catalogue'], 'x-permission': 'catalogue:read', response: { 200: z.object({ data: z.array(Zone) }) } },
    handler: async () => ({ data: await svc.listZones(db) }),
  });
  r.get('/crop-templates', {
    schema: {
      operationId: 'listCropTemplates',
      tags: ['catalogue'],
      summary: 'Effective crop templates (operator overrides replace platform defaults)',
      'x-permission': 'catalogue:read',
      querystring: z.object({ crop: Uuid.optional(), zone: z.string().optional(), irrigated: z.enum(['true', 'false']).optional() }),
      response: { 200: z.object({ data: z.array(CropTemplate) }) },
    },
    handler: async (req) => ({ data: await svc.listTemplates(db, req.actor, { cropId: req.query.crop, zone: req.query.zone, irrigated: req.query.irrigated === undefined ? undefined : req.query.irrigated === 'true' }) }),
  });
  r.post('/crop-templates', {
    schema: { operationId: 'createCropTemplate', tags: ['catalogue'], summary: 'Operator override (or platform default when called by a platform admin)', 'x-permission': 'crop_template:manage', body: CropTemplateCreateBody, response: { 201: CropTemplate } },
    handler: async (req, reply) => reply.status(201).send(await svc.templateOut(db, await svc.createTemplate(db, req.actor, req.body))),
  });
  r.patch('/crop-templates/:id', {
    schema: { operationId: 'updateCropTemplate', tags: ['catalogue'], 'x-permission': 'crop_template:manage', params: IdParam, body: CropTemplateUpdateBody, response: { 200: CropTemplate } },
    handler: async (req, reply) => {
      await svc.updateTemplate(db, req.actor, req.params.id, requireIfMatch(req), req.body);
      const t = await svc.templateOut(db, req.params.id);
      setEtag(reply, t.version);
      return t;
    },
  });
  r.get('/services', {
    schema: { operationId: 'listServices', tags: ['catalogue'], 'x-permission': 'catalogue:read', querystring: z.object({ kind: z.enum(SERVICE_KINDS).optional() }), response: { 200: z.object({ data: z.array(Service) }) } },
    handler: async (req) => ({ data: await svc.listServices(db, req.actor, req.query.kind) }),
  });
  r.post('/services', {
    schema: { operationId: 'createService', tags: ['catalogue'], 'x-permission': 'service:manage', body: ServiceCreateBody, response: { 201: Service } },
    handler: async (req, reply) => reply.status(201).send(await svc.createService(db, req.actor, req.body)),
  });
  r.patch('/services/:id', {
    schema: { operationId: 'updateService', tags: ['catalogue'], 'x-permission': 'service:manage', params: IdParam, body: ServiceUpdateBody, response: { 200: Service } },
    handler: async (req) => svc.updateService(db, req.actor, req.params.id, requireIfMatch(req), req.body),
  });
  r.get('/market-prices', {
    schema: { operationId: 'listMarketPrices', tags: ['catalogue'], 'x-permission': 'catalogue:read', querystring: z.object({ cropId: Uuid.optional() }), response: { 200: z.object({ data: z.array(MarketPrice) }) } },
    handler: async (req) => ({ data: await svc.listMarketPrices(db, req.query.cropId) }),
  });
  r.post('/admin/market-prices', {
    schema: { operationId: 'adminCreateMarketPrice', tags: ['admin'], 'x-permission': 'admin:catalogue', body: MarketPriceCreateBody, response: { 201: MarketPrice } },
    handler: async (req, reply) => reply.status(201).send(await svc.createMarketPrice(db, req.actor, req.body)),
  });
}
