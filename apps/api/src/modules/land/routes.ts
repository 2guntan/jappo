import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  Allocation, AllocationCreateBody, AllocationEndBody, AutoGridBody, BLOCK_STATUSES, Block, BlockAsset, BlockAssetCreateBody, BlockCreateBody, BlockUpdateBody,
  BoundaryBody, FeatureCollection, Grievance, GrievanceCreateBody, GrievanceUpdateBody, IdParam, LAND_DOC_STATUSES, LandDocReviewBody, LandDocument,
  LandDocumentCreateBody, Ok, PageQuery, Plot, PlotCreateBody, PlotUpdateBody, page,
} from '@jappo/contracts';
import type { ModuleContext } from '../../core/module';
import * as svc from './service';
import { requireIfMatch, setEtag } from '../../core/etag';

export async function landRoutes(app: FastifyInstance, ctx: ModuleContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = ctx.db;
  const list = <T>(data: T[]) => ({ data });

  // ---------------------------------------------------------- blocks
  r.get('/blocks', {
    schema: { operationId: 'listBlocks', tags: ['land'], 'x-permission': 'block:read', querystring: PageQuery.extend({ 'filter[status]': z.enum(BLOCK_STATUSES).optional() }), response: { 200: page(Block) } },
    handler: async (req) => svc.listBlocks(db, req.actor, { limit: req.query.limit, cursor: req.query.cursor, q: req.query.q, status: req.query['filter[status]'] }),
  });
  r.post('/blocks', {
    schema: { operationId: 'createBlock', tags: ['land'], 'x-permission': 'block:create', body: BlockCreateBody, response: { 201: Block } },
    handler: async (req, reply) => {
      const id = await svc.createBlock(db, req.actor, req.body);
      const b = await svc.blockOut(db, req.actor, id);
      setEtag(reply, b.version);
      return reply.status(201).send(b);
    },
  });
  r.get('/blocks/:id', {
    schema: { operationId: 'getBlock', tags: ['land'], 'x-permission': 'block:read', params: IdParam, response: { 200: Block } },
    handler: async (req, reply) => {
      const b = await svc.blockOut(db, req.actor, req.params.id);
      setEtag(reply, b.version);
      return b;
    },
  });
  r.patch('/blocks/:id', {
    schema: { operationId: 'updateBlock', tags: ['land'], 'x-permission': 'block:update', params: IdParam, body: BlockUpdateBody, response: { 200: Block } },
    handler: async (req, reply) => {
      await svc.updateBlock(db, req.actor, req.params.id, requireIfMatch(req), req.body);
      const b = await svc.blockOut(db, req.actor, req.params.id);
      setEtag(reply, b.version);
      return b;
    },
  });
  r.put('/blocks/:id/boundary', {
    schema: { operationId: 'setBlockBoundary', tags: ['land'], summary: 'Set boundary from GeoJSON (Polygon/MultiPolygon) or an uploaded GeoJSON/KML file', 'x-permission': 'block:update', params: IdParam, body: BoundaryBody, response: { 200: Block } },
    handler: async (req, reply) => {
      await svc.setBoundary(ctx, req.actor, req.params.id, requireIfMatch(req), req.body);
      const b = await svc.blockOut(db, req.actor, req.params.id);
      setEtag(reply, b.version);
      return b;
    },
  });
  r.get('/blocks/:id/map', {
    schema: { operationId: 'getBlockMap', tags: ['land'], 'x-permission': 'block:read', params: IdParam, response: { 200: FeatureCollection } },
    handler: async (req) => svc.blockMap(db, req.actor, req.params.id),
  });
  r.post('/blocks/:id/actions/archive', {
    schema: { operationId: 'archiveBlock', tags: ['land'], 'x-permission': 'block:archive', params: IdParam, response: { 200: Block } },
    handler: async (req) => {
      await svc.archiveBlock(db, req.actor, req.params.id, requireIfMatch(req));
      return svc.blockOut(db, req.actor, req.params.id);
    },
  });

  // ---------------------------------------------------------- land documents
  r.get('/blocks/:id/land-documents', {
    schema: { operationId: 'listLandDocuments', tags: ['land'], 'x-permission': 'land_document:read', params: IdParam, response: { 200: z.object({ data: z.array(LandDocument) }) } },
    handler: async (req) => list(await svc.listLandDocs(db, req.actor, req.params.id)),
  });
  r.post('/blocks/:id/land-documents', {
    schema: { operationId: 'createLandDocument', tags: ['land'], summary: 'Register a land document (file uploaded via POST /files)', 'x-permission': 'land_document:create', params: IdParam, body: LandDocumentCreateBody, response: { 201: LandDocument } },
    handler: async (req, reply) => reply.status(201).send(await svc.addLandDoc(db, req.actor, req.params.id, req.body)),
  });
  r.get('/admin/land-documents', {
    schema: { operationId: 'adminListLandDocuments', tags: ['admin'], 'x-permission': 'admin:read', querystring: PageQuery.extend({ 'filter[status]': z.enum(LAND_DOC_STATUSES).optional() }), response: { 200: page(LandDocument) } },
    handler: async (req) => svc.listLandDocQueue(db, req.query['filter[status]'], req.query.limit, req.query.cursor),
  });
  for (const decision of ['verify', 'reject'] as const) {
    r.post(`/admin/land-documents/:id/actions/${decision}`, {
      schema: { operationId: decision === 'verify' ? 'adminVerifyLandDocument' : 'adminRejectLandDocument', tags: ['admin'], 'x-permission': 'land_document:verify', params: IdParam, body: LandDocReviewBody, response: { 200: LandDocument } },
      handler: async (req) => svc.reviewLandDoc(db, req.actor, req.params.id, decision, req.body.comment),
    });
  }

  // ---------------------------------------------------------- plots
  r.get('/blocks/:id/plots', {
    schema: { operationId: 'listPlots', tags: ['land'], 'x-permission': 'plot:read', params: IdParam, response: { 200: z.object({ data: z.array(Plot) }) } },
    handler: async (req) => list(await svc.listPlots(db, req.actor, req.params.id)),
  });
  r.post('/blocks/:id/plots', {
    schema: { operationId: 'createPlot', tags: ['land'], 'x-permission': 'plot:create', params: IdParam, body: PlotCreateBody, response: { 201: Plot } },
    handler: async (req, reply) => {
      const id = await db.transaction((tx) => svc.createPlot(tx, req.actor, req.params.id, req.body));
      return reply.status(201).send(await svc.plotOut(db, req.actor, id));
    },
  });
  r.post('/blocks/:id/plots/actions/auto-grid', {
    schema: { operationId: 'autoGridPlots', tags: ['land'], summary: 'Split the boundary into N equal-area plots along the longest axis', 'x-permission': 'plot:create', params: IdParam, body: AutoGridBody, response: { 201: z.object({ data: z.array(Plot) }) } },
    handler: async (req, reply) => {
      await svc.autoGrid(db, req.actor, req.params.id, req.body);
      return reply.status(201).send(list(await svc.listPlots(db, req.actor, req.params.id)));
    },
  });
  r.get('/plots/:id', {
    schema: { operationId: 'getPlot', tags: ['land'], 'x-permission': 'plot:read', params: IdParam, response: { 200: Plot } },
    handler: async (req, reply) => {
      const p = await svc.plotOut(db, req.actor, req.params.id);
      setEtag(reply, p.version);
      return p;
    },
  });
  r.patch('/plots/:id', {
    schema: { operationId: 'updatePlot', tags: ['land'], 'x-permission': 'plot:update', params: IdParam, body: PlotUpdateBody, response: { 200: Plot } },
    handler: async (req, reply) => {
      await db.transaction((tx) => svc.updatePlot(tx, req.actor, req.params.id, requireIfMatch(req), req.body));
      const p = await svc.plotOut(db, req.actor, req.params.id);
      setEtag(reply, p.version);
      return p;
    },
  });
  r.delete('/plots/:id', {
    schema: { operationId: 'archivePlot', tags: ['land'], summary: 'Archive a plot (soft delete)', 'x-permission': 'plot:update', params: IdParam, response: { 200: Ok } },
    handler: async (req) => {
      await svc.archivePlot(db, req.actor, req.params.id);
      return { ok: true as const };
    },
  });

  // ---------------------------------------------------------- allocations
  r.get('/plots/:id/allocations', {
    schema: { operationId: 'listAllocations', tags: ['land'], 'x-permission': 'plot:read', params: IdParam, response: { 200: z.object({ data: z.array(Allocation) }) } },
    handler: async (req) => list(await svc.listAllocations(db, req.actor, req.params.id)),
  });
  r.post('/plots/:id/allocations', {
    schema: { operationId: 'createAllocation', tags: ['land'], 'x-permission': 'allocation:manage', params: IdParam, body: AllocationCreateBody, response: { 201: Allocation } },
    handler: async (req, reply) => reply.status(201).send(await db.transaction((tx) => svc.allocate(tx, req.actor, req.params.id, req.body))),
  });
  r.post('/allocations/:id/actions/end', {
    schema: { operationId: 'endAllocation', tags: ['land'], 'x-permission': 'allocation:manage', params: IdParam, body: AllocationEndBody, response: { 200: Allocation } },
    handler: async (req) => svc.endAllocation(db, req.actor, req.params.id, req.body.endDate),
  });

  // ---------------------------------------------------------- assets & grievances
  r.get('/blocks/:id/assets', {
    schema: { operationId: 'listBlockAssets', tags: ['land'], 'x-permission': 'block:read', params: IdParam, response: { 200: z.object({ data: z.array(BlockAsset) }) } },
    handler: async (req) => list(await svc.listAssets(db, req.actor, req.params.id)),
  });
  r.post('/blocks/:id/assets', {
    schema: { operationId: 'createBlockAsset', tags: ['land'], 'x-permission': 'asset:manage', params: IdParam, body: BlockAssetCreateBody, response: { 201: BlockAsset } },
    handler: async (req, reply) => reply.status(201).send(await svc.addAsset(db, req.actor, req.params.id, req.body)),
  });
  r.get('/blocks/:id/grievances', {
    schema: { operationId: 'listGrievances', tags: ['land'], 'x-permission': 'block:read', params: IdParam, response: { 200: z.object({ data: z.array(Grievance) }) } },
    handler: async (req) => list(await svc.listGrievances(db, req.actor, req.params.id)),
  });
  r.post('/blocks/:id/grievances', {
    schema: { operationId: 'createGrievance', tags: ['land'], 'x-permission': 'grievance:manage', params: IdParam, body: GrievanceCreateBody, response: { 201: Grievance } },
    handler: async (req, reply) => reply.status(201).send(await svc.addGrievance(db, req.actor, req.params.id, req.body)),
  });
  r.patch('/grievances/:id', {
    schema: { operationId: 'updateGrievance', tags: ['land'], 'x-permission': 'grievance:manage', params: IdParam, body: GrievanceUpdateBody, response: { 200: Grievance } },
    handler: async (req) => svc.updateGrievance(db, req.actor, req.params.id, requireIfMatch(req), req.body),
  });
}
