'use client';

import { use, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { problemMessage } from '@/lib/errors';
import { formatDateTime, kycTone } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, Field, PageHeader, Spinner, Table, Td, Textarea, Th } from '@/components/ui';

export default function AdminKycReview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations();
  const { api, hasPermission } = useSession();
  const qc = useQueryClient();
  const org = useQuery({ queryKey: ['admin-org', id], queryFn: () => unwrap(api.GET('/v1/admin/orgs/{id}', { params: { path: { id } } })) });
  const [comment, setComment] = useState('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  if (org.isLoading || !org.data) return <Spinner />;
  const o = org.data;
  const decide = async (d: 'verify' | 'reject') => {
    setMsg(null);
    try {
      if (d === 'verify') await unwrap(api.POST('/v1/admin/orgs/{id}/kyc/actions/verify', { params: { path: { id } }, body: { comment: comment || undefined } }));
      else await unwrap(api.POST('/v1/admin/orgs/{id}/kyc/actions/reject', { params: { path: { id } }, body: { comment: comment || undefined } }));
      setMsg({ tone: 'success', text: d === 'verify' ? t('admin.verified') : t('admin.rejected') });
      await qc.invalidateQueries({ queryKey: ['admin-org', id] });
      await qc.invalidateQueries({ queryKey: ['admin-orgs'] });
    } catch (e) {
      setMsg({ tone: 'error', text: problemMessage(e, t) });
    }
  };
  const open = async (fileId: string) => {
    const { url } = await unwrap(api.GET('/v1/files/{id}/signed-url', { params: { path: { id: fileId } } }));
    window.open(url, '_blank', 'noopener');
  };
  return (
    <>
      <PageHeader title={o.legalName} subtitle={<span className="flex items-center gap-2">{t(`auth.orgTypes.${o.type}` as 'auth.orgTypes.operator')} · <Badge tone={kycTone(o.kycStatus)} data-testid="admin-kyc-status">{t(`kyc.${o.kycStatus}`)}</Badge></span>} />
      {msg && <Alert tone={msg.tone} className="mb-4">{msg.text}</Alert>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>{t('admin.documents')}</CardTitle></CardHeader>
          <CardBody className="p-0">
            <Table>
              <thead><tr><Th>{t('org.docType')}</Th><Th>{t('common.status')}</Th><Th>{t('common.createdAt')}</Th><Th /></tr></thead>
              <tbody>
                {o.kycDocuments.map((d) => (
                  <tr key={d.id}>
                    <Td>{t(`org.kycDocs.${d.docType}`)}<div className="text-xs text-neutral-500">{d.filename}</div></Td>
                    <Td><Badge tone={kycTone(d.status)}>{t(`kyc.${d.status}`)}</Badge></Td>
                    <Td>{formatDateTime(d.createdAt)}</Td>
                    <Td><Button size="sm" variant="ghost" onClick={() => open(d.fileId)}>{t('common.open')}</Button></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-5 py-4 text-sm">
              <dt className="text-neutral-500">{t('org.ninea')}</dt><dd>{o.ninea ?? '—'}</dd>
              <dt className="text-neutral-500">{t('org.rccm')}</dt><dd>{o.rccm ?? '—'}</dd>
              <dt className="text-neutral-500">{t('org.region')}</dt><dd>{o.region ?? '—'}</dd>
              <dt className="text-neutral-500">{t('common.email')}</dt><dd>{o.email ?? '—'}</dd>
            </dl>
          </CardBody>
        </Card>
        {hasPermission('admin:kyc_review') && o.kycStatus !== 'verified' && (
          <Card>
            <CardBody className="space-y-3">
              <Field label={t('admin.comment')} htmlFor="comment"><Textarea id="comment" value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
              <div className="flex gap-2">
                <Button onClick={() => decide('verify')}>{t('admin.verify')}</Button>
                <Button variant="danger" onClick={() => decide('reject')}>{t('admin.reject')}</Button>
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
