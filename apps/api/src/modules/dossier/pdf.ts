import { eq, inArray } from 'drizzle-orm';
import { renderDossierHtml } from '@jappo/templates';
import type { ModuleContext } from '../../core/module';
import { dossiers } from './schema';
import { organizations } from '../identity/schema';
import { systemActor } from '../../core/context';
import { storeFile } from '../files/service';
import { audit } from '../../core/audit';
import { pdfRenderer } from '../../core/adapters/pdf';
import { files } from '../../core/schema';

/** Render and store the dossier PDF (worker job on `dossier.frozen`). Idempotent. */
export async function renderDossierPdf(ctx: ModuleContext, dossierId: string): Promise<string> {
  const [d] = await ctx.db.select().from(dossiers).where(eq(dossiers.id, dossierId));
  if (!d) throw new Error(`dossier ${dossierId} not found`);
  if (d.pdfFileId && d.pdfStatus === 'ready') return d.pdfFileId;
  const [org] = await ctx.db.select({ locale: organizations.locale }).from(organizations).where(eq(organizations.id, d.ownerOrgId));
  const manifest = d.dataRoomManifest;
  const fileRows = manifest.length ? await ctx.db.select({ id: files.id, filename: files.filename }).from(files).where(inArray(files.id, manifest.map((m) => m.fileId))) : [];
  const html = renderDossierHtml(
    {
      ref: d.ref,
      version: d.dossierVersion,
      frozenAt: d.frozenAt?.toISOString().slice(0, 16).replace('T', ' ') ?? '',
      grade: d.grade,
      score: d.readinessScore,
      contentSha256: d.contentSha256,
      gates: d.gates as { code: string; pass: boolean }[],
      breakdown: d.scoreBreakdown as Record<string, number>,
      dataRoom: manifest.map((m) => ({ ...m, filename: fileRows.find((f) => f.id === m.fileId)?.filename })),
      snapshot: d.snapshot as never,
    },
    org?.locale ?? 'fr',
  );
  const pdf = await pdfRenderer().render(html);
  const actor = { ...systemActor('pdf'), orgId: d.ownerOrgId };
  return ctx.db.transaction(async (tx) => {
    const f = await storeFile(ctx, tx, actor, { filename: `${d.ref}.pdf`, declaredMime: 'application/pdf', buffer: pdf }, { linkedType: 'dossier', linkedId: d.id, ownerOrgId: d.ownerOrgId });
    await tx.update(dossiers).set({ pdfFileId: f.id, pdfStatus: 'ready' }).where(eq(dossiers.id, d.id));
    await audit(tx, actor, { action: 'dossier.pdf_rendered', resourceType: 'dossier', resourceId: d.id, after: { fileId: f.id, bytes: pdf.length } });
    return f.id;
  });
}
