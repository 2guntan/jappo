import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { FARMER_KYC_STATUSES, Farmer, FarmerCreateBody, FarmerHistory, FarmerImportResult, FarmerPii, FarmerUpdateBody, IdParam, Ok, PageQuery, Uuid, WalletConfirmBody, page } from '@jappo/contracts';
import type { ModuleContext } from '../../core/module';
import * as svc from './service';
import { requireIfMatch, setEtag } from '../../core/etag';
import { readMultipart } from '../../core/multipart';
import { badRequest } from '../../core/errors';

export async function farmerRoutes(app: FastifyInstance, ctx: ModuleContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = ctx.db;

  r.get('/farmers', {
    schema: {
      operationId: 'listFarmers',
      tags: ['farmers'],
      'x-permission': 'farmer:read',
      querystring: PageQuery.extend({ blockId: Uuid.optional(), 'filter[kycStatus]': z.enum(FARMER_KYC_STATUSES).optional(), 'filter[status]': z.enum(['active', 'inactive']).optional() }),
      response: { 200: page(Farmer) },
    },
    handler: async (req) =>
      svc.listFarmers(db, req.actor, { limit: req.query.limit, cursor: req.query.cursor, q: req.query.q, blockId: req.query.blockId, kycStatus: req.query['filter[kycStatus]'], status: req.query['filter[status]'] }),
  });

  r.post('/farmers', {
    schema: { operationId: 'createFarmer', tags: ['farmers'], 'x-permission': 'farmer:create', body: FarmerCreateBody, response: { 201: Farmer } },
    handler: async (req, reply) => {
      const id = await db.transaction((tx) => svc.createFarmer(tx, req.actor, req.body));
      const f = await svc.farmerOut(db, req.actor, id);
      setEtag(reply, f.version);
      return reply.status(201).send(f);
    },
  });

  r.get('/farmers/import-template', {
    schema: { operationId: 'farmerImportTemplate', tags: ['farmers'], summary: 'CSV template for bulk import', 'x-permission': 'farmer:import', produces: ['text/csv'] } as never,
    handler: async (_req, reply) => reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="farmers-import-template.csv"').send(svc.importTemplateCsv()),
  });

  r.post('/farmers/import', {
    schema: {
      operationId: 'importFarmers',
      tags: ['farmers'],
      summary: 'Bulk import farmers from CSV (multipart `file`), idempotent by phone / national id',
      consumes: ['multipart/form-data'],
      'x-permission': 'farmer:import',
      response: { 200: FarmerImportResult },
    },
    handler: async (req) => {
      const { file } = await readMultipart(req);
      if (file.buffer.includes(0)) throw badRequest('CSV_INVALID', 'File is not a text CSV');
      return svc.importFarmers(db, req.actor, file.buffer.toString('utf8'));
    },
  });

  r.get('/farmers/:id', {
    schema: { operationId: 'getFarmer', tags: ['farmers'], 'x-permission': 'farmer:read', params: IdParam, response: { 200: Farmer } },
    handler: async (req, reply) => {
      const f = await svc.farmerOut(db, req.actor, req.params.id);
      setEtag(reply, f.version);
      return f;
    },
  });

  r.patch('/farmers/:id', {
    schema: { operationId: 'updateFarmer', tags: ['farmers'], 'x-permission': 'farmer:update', params: IdParam, body: FarmerUpdateBody, response: { 200: Farmer } },
    handler: async (req, reply) => {
      await db.transaction((tx) => svc.updateFarmer(tx, req.actor, req.params.id, requireIfMatch(req), req.body));
      const f = await svc.farmerOut(db, req.actor, req.params.id);
      setEtag(reply, f.version);
      return f;
    },
  });

  r.post('/farmers/:id/actions/verify-kyc', {
    schema: { operationId: 'verifyFarmerKyc', tags: ['farmers'], 'x-permission': 'farmer:verify_kyc', params: IdParam, response: { 200: Farmer } },
    handler: async (req, reply) => {
      await svc.verifyFarmerKyc(db, req.actor, req.params.id, requireIfMatch(req));
      const f = await svc.farmerOut(db, req.actor, req.params.id);
      setEtag(reply, f.version);
      return f;
    },
  });

  r.post('/farmers/:id/actions/verify-wallet', {
    schema: { operationId: 'startFarmerWalletVerification', tags: ['farmers'], summary: 'Send an OTP to the wallet phone number', 'x-permission': 'farmer:verify_wallet', params: IdParam, response: { 202: Ok } },
    handler: async (req, reply) => {
      await svc.startWalletVerification(db, req.actor, req.params.id);
      return reply.status(202).send({ ok: true as const });
    },
  });

  r.post('/farmers/:id/actions/confirm-wallet', {
    schema: { operationId: 'confirmFarmerWallet', tags: ['farmers'], 'x-permission': 'farmer:verify_wallet', params: IdParam, body: WalletConfirmBody, response: { 200: Farmer } },
    handler: async (req) => {
      await svc.confirmWallet(db, req.actor, req.params.id, req.body.code);
      return svc.farmerOut(db, req.actor, req.params.id);
    },
  });

  r.get('/farmers/:id/pii', {
    schema: {
      operationId: 'revealFarmerPii',
      tags: ['farmers'],
      summary: 'Full national id and wallet number (audited with reason)',
      'x-permission': 'farmer:pii_read',
      params: IdParam,
      querystring: z.object({ reason: z.string().min(5).max(500) }),
      response: { 200: FarmerPii },
    },
    handler: async (req) => svc.revealPii(db, req.actor, req.params.id, req.query.reason),
  });

  r.get('/farmers/:id/history', {
    schema: { operationId: 'getFarmerHistory', tags: ['farmers'], 'x-permission': 'farmer:read', params: IdParam, response: { 200: FarmerHistory } },
    handler: async (req) => svc.farmerHistory(db, req.actor, req.params.id),
  });
}
