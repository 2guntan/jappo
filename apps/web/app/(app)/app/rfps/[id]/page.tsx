'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { ifMatch, useAction } from '@/lib/hooks';
import { formatDateTime, formatXof } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, Input, PageHeader, Spinner, Table, Td, Th } from '@/components/ui';
import { TrancheTable } from '@/components/seasons/financing-tab';
import { QaPanel } from '@/components/rfp/qa';

export default function OperatorRfpPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations();
  const { api } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const rfp = useQuery({ queryKey: ['rfp', id], queryFn: () => unwrap(api.GET('/v1/rfps/{id}', { params: { path: { id } } })) });
  const closed = rfp.data && ['evaluation', 'awarded'].includes(rfp.data.status);
  const ev = useQuery({ queryKey: ['evaluation', id], enabled: !!closed, queryFn: () => unwrap(api.GET('/v1/rfps/{id}/evaluation', { params: { path: { id } } })) });
  const awards = useQuery({ queryKey: ['awards', id], enabled: !!closed, queryFn: () => unwrap(api.GET('/v1/rfps/{id}/awards', { params: { path: { id } } })) });
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (ev.data && Object.keys(amounts).length === 0) setAmounts(Object.fromEntries(ev.data.tranches.flatMap((tr) => tr.suggestedAllocation.map((a) => [a.bidId, String(a.amountXof)]))));
  }, [ev.data, amounts]);
  if (rfp.isLoading || !rfp.data) return <Spinner />;
  const r = rfp.data;
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['rfp', id] }), qc.invalidateQueries({ queryKey: ['evaluation', id] }), qc.invalidateQueries({ queryKey: ['awards', id] })]);
  const act = (key: string, fn: () => Promise<unknown>) => run(key, async () => { await fn(); await refresh(); });
  return (
    <>
      <PageHeader
        title={`${t('rfp.title')} ${r.ref}`}
        subtitle={<span className="flex flex-wrap items-center gap-2">{r.blockName} · {r.dossierRef} ({r.grade}, {r.readinessScore}/100) <Badge tone="blue" data-testid="rfp-status">{t(`rfp.status.${r.status}`)}</Badge></span>}
        actions={<Link className="text-sm text-brand-700" href={`/app/seasons/${r.seasonId}?tab=financing`}>{t('common.back')}</Link>}
      />
      {msg && <Alert tone={msg.tone} className="mb-4">{msg.text}</Alert>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardBody className="space-y-3 text-sm">
            <p>{t('rfp.opened')} : {formatDateTime(r.openedAt)} · {t('rfp.deadline')} : <strong data-testid="rfp-deadline">{formatDateTime(r.deadlineAt)}</strong> · {t('rfp.extensions')} : {r.extensions}</p>
            <div className="flex flex-wrap gap-2">
              {r.allowedActions.includes('extend') && <Button size="sm" variant="secondary" loading={busy === 'extend'} onClick={() => act('extend', () => unwrap(api.POST('/v1/rfps/{id}/actions/extend', { params: { path: { id } }, headers: ifMatch(r.version), body: { workingDays: 5 } })))}>{t('rfp.extend')}</Button>}
              {r.allowedActions.includes('close_early') && <Button size="sm" loading={busy === 'close'} onClick={() => act('close', () => unwrap(api.POST('/v1/rfps/{id}/actions/close-early', { params: { path: { id } }, headers: ifMatch(r.version), body: {} })))}>{t('rfp.closeEarly')}</Button>}
              {r.allowedActions.includes('cancel') && (
                <span className="flex gap-1">
                  <Input className="h-8 w-40" placeholder={t('rfp.reason')} aria-label={t('rfp.reason')} value={reason} onChange={(e) => setReason(e.target.value)} />
                  <Button size="sm" variant="ghost" disabled={!reason} onClick={() => act('cancel', () => unwrap(api.POST('/v1/rfps/{id}/actions/cancel', { params: { path: { id } }, headers: ifMatch(r.version), body: { reason } })))}>{t('rfp.cancel')}</Button>
                </span>
              )}
            </div>
          </CardBody>
          <CardBody className="p-0"><TrancheTable tranches={r.tranches} /></CardBody>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t('rfp.invitations')}</CardTitle></CardHeader>
          <CardBody>
            <ul className="space-y-2 text-sm">
              {r.invitations.map((i) => <li key={i.id} className="flex justify-between gap-2"><span>{i.lenderName}</span><Badge tone={i.status === 'bid_submitted' ? 'green' : i.status === 'declined' ? 'red' : 'neutral'}>{t(`rfp.invStatus.${i.status}`)}</Badge></li>)}
            </ul>
          </CardBody>
        </Card>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {!closed ? (
            <Alert tone="info">{t('rfp.sealed')}</Alert>
          ) : (
            ev.data?.tranches.map((tr) => (
              <Card key={tr.trancheId}>
                <CardHeader className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>{t('rfp.evaluation')} · {formatXof(tr.amountXof)}</CardTitle>
                  <span className="text-sm text-neutral-600">{t('rfp.weightedEar')} : {tr.weightedEarBps ?? '—'} bps</span>
                </CardHeader>
                <CardBody className="p-0">
                  <Table>
                    <thead><tr><Th>{t('rfp.rank')}</Th><Th>{t('rfp.lender')}</Th><Th>{t('fin.amount')}</Th><Th>{t('rfp.ear')}</Th><Th>{t('rfp.cost')}</Th><Th>{t('rfp.share')}</Th><Th>{t('rfp.speed')}</Th><Th>{t('rfp.conditions')}</Th><Th>{t('rfp.total')}</Th>{r.allowedActions.includes('award') && <Th>{t('rfp.awardAmount')}</Th>}</tr></thead>
                    <tbody>
                      {tr.evaluations.map((e) => (
                        <tr key={e.bidId} className={tr.suggestedAllocation.some((s) => s.bidId === e.bidId) ? 'bg-brand-50' : ''}>
                          <Td>{e.rank}</Td>
                          <Td className="font-medium">{e.lenderName}</Td>
                          <Td>{formatXof(e.amountXof)}</Td>
                          <Td data-testid={`ear-${e.lenderName}`}>{e.effectiveAnnualRateBps}</Td>
                          <Td>{e.scoreCost}</Td>
                          <Td>{e.scoreShare}</Td>
                          <Td>{e.scoreSpeed}</Td>
                          <Td>{e.scoreConditions}</Td>
                          <Td className="font-semibold">{e.totalScore}</Td>
                          {r.allowedActions.includes('award') && <Td><Input className="h-8 w-32" type="number" aria-label={`${t('rfp.awardAmount')} ${e.lenderName}`} value={amounts[e.bidId] ?? ''} onChange={(ev2) => setAmounts({ ...amounts, [e.bidId]: ev2.target.value })} /></Td>}
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </CardBody>
              </Card>
            ))
          )}
          {closed && r.allowedActions.includes('award') && r.status === 'evaluation' && (
            <Button loading={busy === 'award'} onClick={() => act('award', () => unwrap(api.POST('/v1/rfps/{id}/actions/award', { params: { path: { id } }, headers: ifMatch(r.version), body: { awards: Object.entries(amounts).filter(([, v]) => Number(v) > 0).map(([bidId, v]) => ({ bidId, amountXof: Number(v) })) } })))}>{t('rfp.award')}</Button>
          )}
          {awards.data && awards.data.data.length > 0 && (
            <Card>
              <CardHeader><CardTitle>{t('rfp.awards')}</CardTitle></CardHeader>
              <CardBody className="p-0">
                <Table>
                  <thead><tr><Th>{t('rfp.lender')}</Th><Th>{t('fin.amount')}</Th><Th>{t('common.status')}</Th></tr></thead>
                  <tbody>{awards.data.data.map((a) => <tr key={a.id}><Td>{a.lenderName}</Td><Td>{formatXof(a.amountXof)}</Td><Td><Badge tone={a.status === 'accepted_by_lender' ? 'green' : a.status === 'proposed' ? 'blue' : 'red'} data-testid={`award-status-${a.lenderName}`}>{t(`rfp.awardStatus.${a.status}`)}</Badge>{a.declineReason && <div className="text-xs">{a.declineReason}</div>}</Td></tr>)}</tbody>
                </Table>
              </CardBody>
            </Card>
          )}
        </div>
        <QaPanel rfpId={id} mode="operator" canAsk={false} />
      </div>
    </>
  );
}
