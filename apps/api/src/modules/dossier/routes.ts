import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CheckReadinessBody, DataRoomItem, Dossier, IdParam, Readiness, RiskCover, RiskCoverCreateBody, RiskCoverUpdateBody } from '@jappo/contracts';
import type { ModuleContext } from '../../core/module';
import * as svc from './service';
import { requireIfMatch } from '../../core/etag';
import { conflict } from '../../core/errors';
import { getVisibleFile } from '../files/service';
import { audit } from '../../core/audit';
import { eq } from 'drizzle-orm';
import { organizations } from '../identity/schema';
import { watermarkedUrl } from '../../core/files/storage';
import { watermarkText } from '../../core/files/watermark';

export async function dossierRoutes(app: FastifyInstance, ctx: ModuleContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = ctx.db;
  r.get('/seasons/:id/readiness', {
    schema: { operationId: 'getReadiness', tags: ['dossier'], summary: 'Hard gates and readiness score (SPEC §9.2)', 'x-permission': 'readiness:read', params: IdParam, response: { 200: Readiness } },
    handler: async (req) => svc.readiness(db, req.actor, req.params.id),
  });
  r.post('/blocks/:id/actions/check-readiness', {
    schema: { operationId: 'checkBlockReadiness', tags: ['land'], summary: 'Move the block documenting ↔ ready from a season readiness', 'x-permission': 'block:update', params: IdParam, body: CheckReadinessBody, response: { 200: Readiness } },
    handler: async (req) => svc.checkBlockReadiness(db, req.actor, req.params.id, req.body.seasonId),
  });
  r.get('/seasons/:id/dossiers', {
    schema: { operationId: 'listDossiers', tags: ['dossier'], 'x-permission': 'dossier:read', params: IdParam, response: { 200: z.object({ data: z.array(Dossier) }) } },
    handler: async (req) => ({ data: await svc.listDossiers(db, req.actor, req.params.id) }),
  });
  r.post('/seasons/:id/dossiers', {
    schema: { operationId: 'freezeDossier', tags: ['dossier'], summary: 'Freeze a dossier version (all gates must pass); PDF rendered asynchronously', 'x-permission': 'dossier:freeze', params: IdParam, response: { 201: Dossier } },
    handler: async (req, reply) => reply.status(201).send(await svc.dossierDto(db, req.actor, await svc.freezeDossier(db, req.actor, req.params.id))),
  });
  r.get('/dossiers/:id', {
    schema: { operationId: 'getDossier', tags: ['dossier'], 'x-permission': 'dossier:read', params: IdParam, response: { 200: Dossier } },
    handler: async (req) => svc.dossierDto(db, req.actor, await svc.getDossier(db, req.actor, req.params.id)),
  });
  r.get('/dossiers/:id/pdf', {
    schema: { operationId: 'getDossierPdf', tags: ['dossier'], summary: 'Signed URL of the dossier PDF (409 while rendering)', 'x-permission': 'dossier:read', params: IdParam, response: { 200: z.object({ url: z.string(), fileId: z.string() }) } },
    handler: async (req) => {
      const d = await svc.getDossier(db, req.actor, req.params.id);
      if (!d.pdfFileId) throw conflict('PDF_PENDING', 'The dossier PDF is being generated');
      const f = await getVisibleFile(db, req.actor, d.pdfFileId);
      if (f.ownerOrgId !== req.actor.orgId) await db.transaction((tx) => audit(tx, req.actor, { action: 'dossier.pdf_downloaded', resourceType: 'dossier', resourceId: d.id }));
      if (f.ownerOrgId !== req.actor.orgId && req.actor.orgId) {
        const [o] = await db.select({ name: organizations.legalName }).from(organizations).where(eq(organizations.id, req.actor.orgId));
        return { url: watermarkedUrl(ctx.env.FILE_URL_SIGNING_KEY, ctx.env.API_PUBLIC_URL, f.id, watermarkText(o?.name ?? '')), fileId: f.id };
      }
      return { url: await ctx.storage.signedUrl(f.objectKey, f.filename, f.id, 300), fileId: f.id };
    },
  });
  r.get('/dossiers/:id/data-room', {
    schema: { operationId: 'getDossierDataRoom', tags: ['dossier'], 'x-permission': 'dossier:read', params: IdParam, response: { 200: z.object({ data: z.array(DataRoomItem) }) } },
    handler: async (req) => {
      const d = await svc.getDossier(db, req.actor, req.params.id);
      return { data: (await svc.dossierDto(db, req.actor, d)).dataRoom };
    },
  });
  r.get('/blocks/:id/risk-covers', {
    schema: { operationId: 'listRiskCovers', tags: ['dossier'], 'x-permission': 'risk_cover:read', params: IdParam, response: { 200: z.object({ data: z.array(RiskCover) }) } },
    handler: async (req) => ({ data: await svc.listCovers(db, req.actor, req.params.id) }),
  });
  r.post('/blocks/:id/risk-covers', {
    schema: { operationId: 'createRiskCover', tags: ['dossier'], 'x-permission': 'risk_cover:manage', params: IdParam, body: RiskCoverCreateBody, response: { 201: RiskCover } },
    handler: async (req, reply) => reply.status(201).send(await svc.createCover(db, req.actor, req.params.id, req.body)),
  });
  r.patch('/risk-covers/:id', {
    schema: { operationId: 'updateRiskCover', tags: ['dossier'], 'x-permission': 'risk_cover:manage', params: IdParam, body: RiskCoverUpdateBody, response: { 200: RiskCover } },
    handler: async (req) => svc.updateCover(db, req.actor, req.params.id, requireIfMatch(req), req.body),
  });
}
