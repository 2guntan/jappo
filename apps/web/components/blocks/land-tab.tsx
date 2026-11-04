'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { LAND_DOC_TYPES } from '@jappo/contracts';
import { useSession } from '@/lib/session';
import { ifMatch, uploadFile, useAction } from '@/lib/hooks';
import { formatDate, statusTone } from '@/lib/utils';
import { BlockMap } from '@/components/map';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, Field, Input, Select, Table, Td, Th } from '@/components/ui';
import type { BlockT } from './types';

export function LandTab({ block }: { block: BlockT }) {
  const t = useTranslations();
  const { api, authedFetch } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const [drawing, setDrawing] = useState(false);
  const docs = useQuery({ queryKey: ['land-docs', block.id], queryFn: () => unwrap(api.GET('/v1/blocks/{id}/land-documents', { params: { path: { id: block.id } } })) });
  const map = useQuery({ queryKey: ['block-map', block.id], queryFn: () => unwrap(api.GET('/v1/blocks/{id}/map', { params: { path: { id: block.id } } })) });
  const [doc, setDoc] = useState({ docType: 'deliberation', number: '', issuedBy: '', issueDate: '', expiryDate: '' });
  const [docFile, setDocFile] = useState<File | null>(null);
  const canEdit = block.allowedActions.includes('set_boundary');
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['block', block.id] }), qc.invalidateQueries({ queryKey: ['block-map', block.id] }), qc.invalidateQueries({ queryKey: ['land-docs', block.id] })]);

  const saveBoundary = (body: { geometry: { type: 'Polygon'; coordinates: number[][][] } } | { fileId: string }) =>
    run('boundary', async () => {
      await unwrap(api.PUT('/v1/blocks/{id}/boundary', { params: { path: { id: block.id } }, headers: ifMatch(block.version), body: body as never }));
      setDrawing(false);
      await refresh();
    }, t('blocks.boundarySaved'));

  return (
    <div className="space-y-6">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t('blocks.boundary')} {block.areaHa !== null && <span className="font-normal text-neutral-500">· {block.areaHa.toFixed(4)} ha</span>}</CardTitle>
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant={drawing ? 'danger' : 'secondary'} onClick={() => setDrawing(!drawing)}>{drawing ? t('blocks.cancelDraw') : t('blocks.drawBoundary')}</Button>
              <label className="cursor-pointer rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100">
                {t('blocks.importBoundary')}
                <input
                  type="file"
                  className="sr-only"
                  accept=".geojson,.json,.kml"
                  data-testid="boundary-file"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void run('boundary', async () => saveBoundary({ fileId: await uploadFile(authedFetch, f) }));
                  }}
                />
              </label>
            </div>
          )}
        </CardHeader>
        <CardBody className="space-y-2">
          {!block.boundary && <p className="text-sm text-neutral-600">{t('blocks.noBoundary')}</p>}
          {drawing && <p className="text-sm text-brand-700">{t('blocks.drawHint')}</p>}
          <BlockMap features={(map.data?.features ?? []) as never} drawMode={drawing} onDrawn={(g) => saveBoundary({ geometry: g })} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t('blocks.landDocs')}</CardTitle></CardHeader>
        <CardBody className="space-y-4 p-0">
          {docs.data?.data.length ? (
            <Table>
              <thead><tr><Th>{t('org.docType')}</Th><Th>{t('blocks.docNumber')}</Th><Th>{t('blocks.issuedBy')}</Th><Th>{t('blocks.issueDate')}</Th><Th>{t('blocks.expiryDate')}</Th><Th>{t('common.status')}</Th></tr></thead>
              <tbody>
                {docs.data.data.map((d) => (
                  <tr key={d.id}>
                    <Td>{t(`enum.landDocType.${d.docType}`)}</Td>
                    <Td>{d.number ?? '—'}</Td>
                    <Td>{d.issuedBy ?? '—'}</Td>
                    <Td>{formatDate(d.issueDate)}</Td>
                    <Td>{formatDate(d.expiryDate)}</Td>
                    <Td><Badge tone={statusTone(d.status)}>{t(`enum.landDocStatus.${d.status}`)}</Badge>{d.comment && <div className="text-xs text-neutral-500">{d.comment}</div>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="px-5 pt-4 text-sm text-neutral-500">{t('blocks.noDocs')}</p>
          )}
          {block.allowedActions.includes('add_land_document') && (
            <form
              className="grid gap-3 border-t border-neutral-100 px-5 py-4 sm:grid-cols-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!docFile) return;
                void run('doc', async () => {
                  const fileId = await uploadFile(authedFetch, docFile);
                  await unwrap(api.POST('/v1/blocks/{id}/land-documents', { params: { path: { id: block.id } }, body: { docType: doc.docType as 'deliberation', fileId, number: doc.number || null, issuedBy: doc.issuedBy || null, issueDate: doc.issueDate || null, expiryDate: doc.expiryDate || null } }));
                  setDocFile(null);
                  (e.target as HTMLFormElement).reset();
                  await refresh();
                });
              }}
            >
              <Field label={t('org.docType')} htmlFor="ld-type"><Select id="ld-type" value={doc.docType} onChange={(e) => setDoc({ ...doc, docType: e.target.value })}>{LAND_DOC_TYPES.map((d) => <option key={d} value={d}>{t(`enum.landDocType.${d}`)}</option>)}</Select></Field>
              <Field label={t('blocks.docNumber')} htmlFor="ld-number"><Input id="ld-number" value={doc.number} onChange={(e) => setDoc({ ...doc, number: e.target.value })} /></Field>
              <Field label={t('blocks.issuedBy')} htmlFor="ld-issuer"><Input id="ld-issuer" value={doc.issuedBy} onChange={(e) => setDoc({ ...doc, issuedBy: e.target.value })} /></Field>
              <Field label={t('blocks.issueDate')} htmlFor="ld-issue"><Input id="ld-issue" type="date" value={doc.issueDate} onChange={(e) => setDoc({ ...doc, issueDate: e.target.value })} /></Field>
              <Field label={t('blocks.expiryDate')} htmlFor="ld-expiry"><Input id="ld-expiry" type="date" value={doc.expiryDate} onChange={(e) => setDoc({ ...doc, expiryDate: e.target.value })} /></Field>
              <Field label={t('org.file')} htmlFor="ld-file"><Input id="ld-file" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setDocFile(e.target.files?.[0] ?? null)} /></Field>
              <div className="sm:col-span-3"><Button type="submit" disabled={!docFile} loading={busy === 'doc'}>{t('blocks.addDoc')}</Button></div>
            </form>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
