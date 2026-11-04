import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { FileMeta, IdParam } from '@jappo/contracts';
import type { ModuleContext } from '../../core/module';
import { readMultipart } from '../../core/multipart';
import { fileDto, getVisibleFile, storeFile } from './service';
import { files } from '../../core/schema';
import { verifyFileUrl } from '../../core/files/storage';
import { notFound } from '../../core/errors';
import { audit } from '../../core/audit';

export async function fileRoutes(app: FastifyInstance, ctx: ModuleContext) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const db = ctx.db;

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
      const url = await ctx.storage.signedUrl(f.objectKey, f.filename, f.id, 300);
      return reply.redirect(url, 302);
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
      querystring: z.object({ exp: z.coerce.number().int(), sig: z.string() }),
    },
    handler: async (req, reply) => {
      if (!verifyFileUrl(ctx.env.FILE_URL_SIGNING_KEY, req.params.id, req.query.exp, req.query.sig)) throw notFound('File');
      const [f] = await db.select().from(files).where(eq(files.id, req.params.id));
      if (!f) throw notFound('File');
      const buf = await ctx.storage.get(f.objectKey);
      return reply.header('content-type', f.mime).header('content-disposition', `attachment; filename="${f.filename}"`).send(buf);
    },
  });
}
