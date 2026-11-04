'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { ifMatch, useAction } from '@/lib/hooks';
import { contractTone, formatDateTime } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, Field, Input, PageHeader, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { InPersonSign, OtpSign } from '@/components/contracts/sign-panel';

export default function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations();
  const { api } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const [clauses, setClauses] = useState<Record<string, string> | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const q = useQuery({ queryKey: ['contract', id], queryFn: () => unwrap(api.GET('/v1/contracts/{id}', { params: { path: { id } } })) });
  if (q.isLoading || !q.data) return <Spinner />;
  const c = q.data;
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['contract', id] }), qc.invalidateQueries({ queryKey: ['contracts'] })]);
  const edit = clauses ?? c.clauses;
  const openPdf = () =>
    run('pdf', async () => {
      const r = await unwrap(api.GET('/v1/contracts/{id}/pdf', { params: { path: { id } } }));
      window.open(r.url, '_blank', 'noopener');
    });

  return (
    <>
      <PageHeader
        title={`${c.ref} · ${c.title}`}
        subtitle={`${c.blockRef} · ${c.blockName}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {(c.hasPdf || c.hasSignedPdf) && <Button variant="secondary" loading={busy === 'pdf'} onClick={openPdf}>{c.hasSignedPdf ? t('contracts.signedPdf') : t('contracts.pdf')}</Button>}
            {c.allowedActions.includes('send') && (
              <Button loading={busy === 'send'} data-testid="send-contract" onClick={() => run('send', async () => { await unwrap(api.POST('/v1/contracts/{id}/actions/send', { params: { path: { id } }, headers: ifMatch(c.version) })); await refresh(); })}>
                {t('contracts.send')}
              </Button>
            )}
          </div>
        }
      />
      {msg && <Alert tone={msg.tone} className="mb-4">{msg.text}</Alert>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>{t('contracts.signatories')}</CardTitle>
              <Badge tone={contractTone(c.status)} data-testid="contract-status">{t(`contracts.status.${c.status}`)}</Badge>
            </CardHeader>
            <CardBody className="p-0">
              <Table>
                <thead><tr><Th>#</Th><Th>{t('contracts.party')}</Th><Th>{t('contracts.signer')}</Th><Th>{t('contracts.signedAt')}</Th><Th /></tr></thead>
                <tbody>
                  {c.parties.map((p) => (
                    <tr key={p.id} data-testid={`party-${p.partyType}-${p.signOrder}`}>
                      <Td>{p.signOrder}</Td>
                      <Td><span className="font-medium">{p.name}</span><span className="block text-xs text-neutral-500">{p.roleLabel}</span></Td>
                      <Td>{p.signerName ? <>{p.signerName}<span className="block text-xs text-neutral-500">{t(`contracts.methods.${p.signatureMethod}`)}</span></> : '—'}</Td>
                      <Td>{formatDateTime(p.signedAt)}</Td>
                      <Td className="min-w-64">
                        {p.canSign && p.partyType === 'org' && <OtpSign contract={c} party={p} onSigned={refresh} />}
                        {p.canSign && p.partyType === 'farmer' && (
                          <div className="space-y-3">
                            <InPersonSign contract={c} party={p} onSigned={refresh} />
                            <OtpSign contract={c} party={p} onSigned={refresh} />
                          </div>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </CardBody>
          </Card>
          {c.allowedActions.includes('edit') && c.editableClauses.length > 0 && (
            <Card>
              <CardHeader><CardTitle>{t('contracts.clauses')}</CardTitle></CardHeader>
              <CardBody className="space-y-3">
                {c.editableClauses.map((cl) => (
                  <Field key={cl.name} label={cl.description ?? cl.name} htmlFor={`cl-${cl.name}`}>
                    <Textarea id={`cl-${cl.name}`} rows={3} value={edit[cl.name] ?? ''} onChange={(e) => setClauses({ ...edit, [cl.name]: e.target.value })} />
                  </Field>
                ))}
                <div className="flex gap-2">
                  <Button disabled={!clauses} loading={busy === 'save'} onClick={() => run('save', async () => { await unwrap(api.PATCH('/v1/contracts/{id}', { params: { path: { id } }, headers: ifMatch(c.version), body: { clauses: edit } })); setClauses(null); await refresh(); }, t('common.saved'))}>{t('common.save')}</Button>
                  <Button variant="ghost" loading={busy === 'refresh'} onClick={() => run('refresh', async () => { await unwrap(api.PATCH('/v1/contracts/{id}', { params: { path: { id } }, headers: ifMatch(c.version), body: { refresh: true } })); await refresh(); })}>{t('contracts.refreshData')}</Button>
                </div>
              </CardBody>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>{t('contracts.integrity')}</CardTitle></CardHeader>
            <CardBody className="space-y-2 text-sm">
              <p>{t('contracts.templateVersion')} : v{c.templateVersion} · {c.locale.toUpperCase()}</p>
              <p>{t('contracts.sentAt')} : {formatDateTime(c.sentAt)}</p>
              <p>{t('contracts.signedAt')} : {formatDateTime(c.signedAt)}</p>
              <p className="break-all text-xs text-neutral-600" data-testid="content-hash">SHA-256 : {c.contentSha256 ?? t('contracts.hashOnSend')}</p>
              {c.voidReason && <Alert tone="error">{t('contracts.voided')} : {c.voidReason}</Alert>}
              {c.relatedType === 'facility' && <Link className="text-brand-700 hover:underline" href={`/app/facilities/${c.relatedId}`}>{t('facility.open')}</Link>}
            </CardBody>
          </Card>
          {c.allowedActions.includes('void') && (
            <Card>
              <CardHeader><CardTitle>{t('contracts.void')}</CardTitle></CardHeader>
              <CardBody className="space-y-2">
                <Input aria-label={t('rfp.reason')} placeholder={t('rfp.reason')} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
                <Button variant="danger" disabled={voidReason.trim().length < 3} loading={busy === 'void'} onClick={() => run('void', async () => { await unwrap(api.POST('/v1/contracts/{id}/actions/void', { params: { path: { id } }, headers: ifMatch(c.version), body: { reason: voidReason } })); await refresh(); })}>{t('contracts.void')}</Button>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
