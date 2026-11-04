'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { ifMatch, useAction } from '@/lib/hooks';
import { formatXof } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Field, Input, PageHeader, Table, Td, Th } from '@/components/ui';

function Preview({ id }: { id: string }) {
  const t = useTranslations('lender');
  const { api } = useSession();
  const q = useQuery({ queryKey: ['profile-preview', id], queryFn: () => unwrap(api.GET('/v1/lender-profiles/{id}/preview', { params: { path: { id } } })) });
  return <span className="text-xs text-neutral-500">{q.data ? t('preview', { match: q.data.matchingRequests, open: q.data.openRequests }) : ''}</span>;
}

export default function ProfilesPage() {
  const t = useTranslations();
  const { api } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const q = useQuery({ queryKey: ['lender-profiles'], queryFn: () => unwrap(api.GET('/v1/lender-profiles')) });
  const [f, setF] = useState({ name: '', seasonal: true, investment: false, minTicketXof: '500000', maxTicketXof: '50000000', minReadinessScore: '50', maxTenorMonths: '12', regions: '', requiresGuarantee: false, minGuaranteePct: '0', requiresInsurance: false });
  const rows = q.data?.data ?? [];
  return (
    <>
      <PageHeader title={t('lender.profiles')} />
      {msg && <Alert tone={msg.tone} className="mb-4">{msg.text}</Alert>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {rows.length === 0 ? <EmptyState title={t('lender.profiles')} description={t('lender.noOpportunities')} /> : (
            <Card>
              <CardBody className="p-0">
                <Table>
                  <thead><tr><Th>{t('lender.name')}</Th><Th>{t('lender.trancheTypes')}</Th><Th>{t('lender.minTicket')} – {t('lender.maxTicket')}</Th><Th>{t('lender.minScore')}</Th><Th>{t('lender.active')}</Th></tr></thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.id}>
                        <Td><div className="font-medium">{p.name}</div><Preview id={p.id} /></Td>
                        <Td>{p.trancheTypes.map((x) => t(`fin.trancheTypes.${x}`)).join(', ')}</Td>
                        <Td>{formatXof(p.minTicketXof)} – {formatXof(p.maxTicketXof)}</Td>
                        <Td>{p.minReadinessScore}</Td>
                        <Td><Button size="sm" variant="ghost" onClick={() => run('t', async () => { await unwrap(api.PATCH('/v1/lender-profiles/{id}', { params: { path: { id: p.id } }, headers: ifMatch(p.version), body: { active: !p.active } })); await qc.invalidateQueries({ queryKey: ['lender-profiles'] }); })}>{p.active ? <Badge tone="green">✓</Badge> : <Badge>—</Badge>}</Button></Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </CardBody>
            </Card>
          )}
        </div>
        <Card>
          <CardHeader><CardTitle>{t('lender.newProfile')}</CardTitle></CardHeader>
          <CardBody>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run('c', async () => { await unwrap(api.POST('/v1/lender-profiles', { body: { name: f.name, trancheTypes: [...(f.seasonal ? ['seasonal' as const] : []), ...(f.investment ? ['investment' as const] : [])], minTicketXof: Number(f.minTicketXof), maxTicketXof: Number(f.maxTicketXof), minReadinessScore: Number(f.minReadinessScore), maxTenorMonths: Number(f.maxTenorMonths), regions: f.regions.split(',').map((x) => x.trim()).filter((x) => x.length >= 2), requiresGuarantee: f.requiresGuarantee, minGuaranteePct: Number(f.minGuaranteePct), requiresInsurance: f.requiresInsurance } })); setF({ ...f, name: '' }); await qc.invalidateQueries({ queryKey: ['lender-profiles'] }); }); }}>
              <Field label={t('lender.name')} htmlFor="lp-name"><Input id="lp-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <fieldset className="flex gap-4 text-sm"><label className="flex items-center gap-1"><input type="checkbox" checked={f.seasonal} onChange={(e) => setF({ ...f, seasonal: e.target.checked })} />{t('fin.trancheTypes.seasonal')}</label><label className="flex items-center gap-1"><input type="checkbox" checked={f.investment} onChange={(e) => setF({ ...f, investment: e.target.checked })} />{t('fin.trancheTypes.investment')}</label></fieldset>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('lender.minTicket')} htmlFor="lp-min"><Input id="lp-min" type="number" value={f.minTicketXof} onChange={(e) => setF({ ...f, minTicketXof: e.target.value })} /></Field>
                <Field label={t('lender.maxTicket')} htmlFor="lp-max"><Input id="lp-max" type="number" value={f.maxTicketXof} onChange={(e) => setF({ ...f, maxTicketXof: e.target.value })} /></Field>
                <Field label={t('lender.minScore')} htmlFor="lp-score"><Input id="lp-score" type="number" min={0} max={100} value={f.minReadinessScore} onChange={(e) => setF({ ...f, minReadinessScore: e.target.value })} /></Field>
                <Field label={t('lender.maxTenor')} htmlFor="lp-tenor"><Input id="lp-tenor" type="number" value={f.maxTenorMonths} onChange={(e) => setF({ ...f, maxTenorMonths: e.target.value })} /></Field>
              </div>
              <Field label={t('lender.regions')} htmlFor="lp-regions"><Input id="lp-regions" value={f.regions} onChange={(e) => setF({ ...f, regions: e.target.value })} /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.requiresGuarantee} onChange={(e) => setF({ ...f, requiresGuarantee: e.target.checked })} />{t('lender.requiresGuarantee')}</label>
              {f.requiresGuarantee && <Field label={t('lender.minGuarantee')} htmlFor="lp-guar"><Input id="lp-guar" type="number" value={f.minGuaranteePct} onChange={(e) => setF({ ...f, minGuaranteePct: e.target.value })} /></Field>}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.requiresInsurance} onChange={(e) => setF({ ...f, requiresInsurance: e.target.checked })} />{t('lender.requiresInsurance')}</label>
              <Button type="submit" loading={busy === 'c'} disabled={!f.seasonal && !f.investment}>{t('lender.newProfile')}</Button>
            </form>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
