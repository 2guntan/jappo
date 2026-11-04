'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { LAND_DOC_STATUSES } from '@jappo/contracts';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import { formatDate, statusTone } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, EmptyState, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@/components/ui';

export default function AdminLandDocs() {
  const t = useTranslations();
  const { api, hasPermission } = useSession();
  const qc = useQueryClient();
  const { msg, run } = useAction();
  const [status, setStatus] = useState('submitted');
  const [comment, setComment] = useState<Record<string, string>>({});
  const q = useQuery({ queryKey: ['admin-land', status], queryFn: () => unwrap(api.GET('/v1/admin/land-documents', { params: { query: { limit: 100, ...(status ? { 'filter[status]': status as 'submitted' } : {}) } } })) });
  const open = async (fileId: string) => window.open((await unwrap(api.GET('/v1/files/{id}/signed-url', { params: { path: { id: fileId } } }))).url, '_blank', 'noopener');
  const decide = (id: string, d: 'verify' | 'reject') =>
    run(d, async () => {
      const body = { comment: comment[id] || undefined };
      if (d === 'verify') await unwrap(api.POST('/v1/admin/land-documents/{id}/actions/verify', { params: { path: { id } }, body }));
      else await unwrap(api.POST('/v1/admin/land-documents/{id}/actions/reject', { params: { path: { id } }, body }));
      await qc.invalidateQueries({ queryKey: ['admin-land'] });
    });
  const rows = q.data?.data ?? [];
  return (
    <>
      <PageHeader title={t('adminLand.title')} />
      {msg && <Alert tone={msg.tone} className="mb-4">{msg.text}</Alert>}
      <div className="mb-4 w-48">
        <Select aria-label={t('common.status')} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('admin.all')}</option>
          {LAND_DOC_STATUSES.map((s) => <option key={s} value={s}>{t(`enum.landDocStatus.${s}`)}</option>)}
        </Select>
      </div>
      {q.isLoading ? <Spinner /> : rows.length === 0 ? <EmptyState title={t('adminLand.empty')} /> : (
        <Card>
          <CardBody className="p-0">
            <Table>
              <thead><tr><Th>{t('adminLand.block')}</Th><Th>{t('org.docType')}</Th><Th>{t('blocks.docNumber')}</Th><Th>{t('blocks.issueDate')}</Th><Th>{t('common.status')}</Th><Th /></tr></thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <Td className="font-medium">{d.blockName}</Td>
                    <Td>{t(`enum.landDocType.${d.docType}`)}</Td>
                    <Td>{d.number ?? '—'}<div className="text-xs text-neutral-500">{d.issuedBy}</div></Td>
                    <Td>{formatDate(d.issueDate)}</Td>
                    <Td><Badge tone={statusTone(d.status)}>{t(`enum.landDocStatus.${d.status}`)}</Badge></Td>
                    <Td className="space-y-1">
                      <Button size="sm" variant="ghost" onClick={() => open(d.fileId)}>{t('common.open')}</Button>
                      {d.status === 'submitted' && hasPermission('land_document:verify') && (
                        <div className="flex flex-wrap gap-1">
                          <Input className="h-8 w-40" placeholder={t('admin.comment')} aria-label={t('admin.comment')} value={comment[d.id] ?? ''} onChange={(e) => setComment({ ...comment, [d.id]: e.target.value })} />
                          <Button size="sm" onClick={() => decide(d.id, 'verify')} aria-label={`${t('admin.verify')} ${d.docType}`}>{t('enum.landDocStatus.verified')}</Button>
                          <Button size="sm" variant="danger" onClick={() => decide(d.id, 'reject')}>{t('admin.reject')}</Button>
                        </div>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}
    </>
  );
}
