import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { FileMeta, IdParam } from '@jappo/contracts';
import type { ModuleContext } from '../../core/module';
import { readMultipart } from '../../core/multipart';
import { fileDto, getVisibleFile, storeFile } from './service';
import { files } from '../../core/schema';
import { verifyFileUrl, watermarkedUrl } from '../../core/files/storage';
import { watermarkPdf, watermarkText } from '../../core/files/watermark';
import { organizations } from '../identity/schema';
import type { ActorContext } from '../../core/context';
import type { FileRow } from './service';
import { notFound } from '../../core/errors';
import { audit } from '../../core/audit';

export async function fileRoutes(app: FastifyInstance, ctx: ModuleContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = ctx.db;
  /** Owners get a storage URL; other orgs get a watermarked, API-served URL for PDFs (SPEC §14.1). */
  const urlFor = async (actor: ActorContext, f: FileRow) => {
    if (f.ownerOrgId !== actor.orgId && f.mime === 'application/pdf' && actor.orgId) {
      const [o] = await db.select({ name: organizations.legalName }).from(organizations).where(eq(organizations.id, actor.orgId));
      return watermarkedUrl(ctx.env.FILE_URL_SIGNING_KEY, ctx.env.API_PUBLIC_URL, f.id, watermarkText(o?.name ?? actor.orgId));
    }
    return ctx.storage.signedUrl(f.objectKey, f.filename, f.id, 300);
  };

  r.post('/files', {
    schema: {
      operationId: 'uploadFile',
      tags: ['files'],
      summary: 'Upload a file (multipart: file, optional linkedType/linkedId). ≤ 25 MB, MIME allow-list.',
      consumes: ['multipart/form-data'],
      'x-permission': 'file:create',
      response: { 201: FileMeta },
    },
    handler: async (req, reply) => {
      const { file } = await readMultipart(req);
      const row = await db.transaction((tx) => storeFile(ctx, tx, req.actor, file));
      return reply.status(201).send(fileDto(row));
    },
  });

  r.get('/files/:id', {
    schema: { operationId: 'getFile', tags: ['files'], 'x-permission': 'file:read', params: IdParam, response: { 200: FileMeta } },
    handler: async (req) => fileDto(await getVisibleFile(db, req.actor, req.params.id)),
  });

  r.get('/files/:id/download', {
    schema: { operationId: 'downloadFile', tags: ['files'], summary: '302 redirect to a 5-minute signed URL', 'x-permission': 'file:read', params: IdParam, response: { 302: z.null() } },
    handler: async (req, reply) => {
      const f = await getVisibleFile(db, req.actor, req.params.id);
      if (f.ownerOrgId !== req.actor.orgId) {
        await db.transaction((tx) => audit(tx, req.actor, { action: 'file.downloaded', resourceType: 'file', resourceId: f.id }));
      }
      return reply.redirect(await urlFor(req.actor, f), 302);
    },
  });

  r.get('/files/:id/signed-url', {
    schema: {
      operationId: 'getFileSignedUrl',
      tags: ['files'],
      summary: 'Signed download URL (5 minutes) for browser clients that cannot follow an authenticated redirect',
      'x-permission': 'file:read',
      params: IdParam,
      response: { 200: z.object({ url: z.string(), expiresAt: z.string() }) },
    },
    handler: async (req) => {
      const f = await getVisibleFile(db, req.actor, req.params.id);
      if (f.ownerOrgId !== req.actor.orgId) {
        await db.transaction((tx) => audit(tx, req.actor, { action: 'file.downloaded', resourceType: 'file', resourceId: f.id }));
      }
      return { url: await urlFor(req.actor, f), expiresAt: new Date(Date.now() + 300_000).toISOString() };
    },
  });

  r.get('/files/:id/raw', {
    schema: {
      operationId: 'rawFile',
      tags: ['files'],
      summary: 'Serve a file via signed URL (filesystem storage driver)',
      hide: true,
      'x-permission': 'public',
      params: IdParam,
      querystring: z.object({ exp: z.coerce.number().int(), sig: z.string(), wm: z.string().max(400).optional() }),
    },
    handler: async (req, reply) => {
      if (!verifyFileUrl(ctx.env.FILE_URL_SIGNING_KEY, req.params.id, req.query.exp, req.query.sig, req.query.wm ?? '')) throw notFound('File');
      const [f] = await db.select().from(files).where(eq(files.id, req.params.id));
      if (!f) throw notFound('File');
      let buf = await ctx.storage.get(f.objectKey);
      if (req.query.wm && f.mime === 'application/pdf') buf = await watermarkPdf(buf, Buffer.from(req.query.wm, 'base64url').toString('utf8'));
      return reply.header('content-type', f.mime).header('content-disposition', `attachment; filename="${f.filename}"`).send(buf);
    },
  });
}
