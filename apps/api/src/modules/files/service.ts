import { and, eq } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client';
import { files } from '../../core/schema';
import type { ActorContext } from '../../core/context';
import { actorUserId, isPlatformStaff, requireOrg } from '../../core/context';
import type { ModuleContext } from '../../core/module';
import type { UploadedFile } from '../../core/multipart';
import { ALLOWED_MIME, scanForMalware, sniffMime } from '../../core/files/sniff';
import { badRequest, notFound, unprocessable } from '../../core/errors';
import { sha256 } from '../../core/crypto';
import { newId } from '../../db/columns';
import { hasGrant } from '../../core/authz/visibility';
import { audit } from '../../core/audit';

export type FileRow = typeof files.$inferSelect;

export const fileDto = (f: FileRow) => ({
  id: f.id,
  ownerOrgId: f.ownerOrgId,
  filename: f.filename,
  mime: f.mime,
  sizeBytes: f.sizeBytes,
  sha256: f.sha256,
  visibility: f.visibility,
  linkedType: f.linkedType,
  linkedId: f.linkedId,
  createdAt: f.createdAt.toISOString(),
});

/** Store an uploaded file after MIME sniffing and AV hook (SPEC §10.2). */
export async function storeFile(
  ctx: ModuleContext,
  tx: DbOrTx,
  actor: ActorContext,
  up: UploadedFile,
  link: { linkedType?: string | null; linkedId?: string | null; ownerOrgId?: string } = {},
): Promise<FileRow> {
  const mime = sniffMime(up.buffer, up.filename);
  if (!mime || !ALLOWED_MIME.has(mime)) {
    throw unprocessable('FILE_TYPE_NOT_ALLOWED', 'Allowed: pdf, jpg, png, webp, docx, xlsx, csv, geojson, kml, zip');
  }
  const scan = await scanForMalware(up.buffer);
  if (!scan.clean) throw unprocessable('FILE_REJECTED', 'File failed the malware scan');
  const ownerOrgId = link.ownerOrgId ?? requireOrg(actor);
  const id = newId();
  const safeName = up.filename.replace(/[^\w.\- ]+/g, '_').slice(0, 200) || 'file';
  const objectKey = `${ownerOrgId}/${id.slice(0, 8)}/${id}/${safeName}`;
  await ctx.storage.put(objectKey, up.buffer, mime);
  const [row] = await tx
    .insert(files)
    .values({
      id,
      ownerOrgId,
      bucket: ctx.storage.bucket,
      objectKey,
      filename: safeName,
      mime,
      sizeBytes: up.buffer.length,
      sha256: sha256(up.buffer),
      linkedType: link.linkedType ?? null,
      linkedId: link.linkedId ?? null,
      uploadedBy: actorUserId(actor),
      createdBy: actorUserId(actor),
    })
    .returning();
  await audit(tx, actor, { action: 'file.uploaded', resourceType: 'file', resourceId: id, after: { filename: safeName, mime, size: up.buffer.length } });
  return row!;
}

/** Visible iff owner org, platform staff, grant on the file, or grant on the linked resource. */
export async function getVisibleFile(db: DbOrTx, actor: ActorContext, id: string): Promise<FileRow> {
  const [f] = await db.select().from(files).where(eq(files.id, id));
  if (!f) throw notFound('File');
  if (f.ownerOrgId === actor.orgId || isPlatformStaff(actor)) return f;
  if (await hasGrant(db, actor, 'file', f.id)) return f;
  if (f.linkedType && f.linkedId && (await hasGrant(db, actor, f.linkedType, f.linkedId))) return f;
  throw notFound('File');
}

export async function linkFile(tx: DbOrTx, actor: ActorContext, fileId: string, linkedType: string, linkedId: string): Promise<FileRow> {
  const [f] = await tx
    .update(files)
    .set({ linkedType, linkedId })
    .where(and(eq(files.id, fileId), eq(files.ownerOrgId, requireOrg(actor))))
    .returning();
  if (!f) throw badRequest('FILE_NOT_FOUND', 'File not found in your organisation', [{ path: 'body.fileId', message: 'unknown file' }]);
  return f;
}
