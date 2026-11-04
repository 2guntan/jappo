'use client';

import { use, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { ifMatch, useAction } from '@/lib/hooks';
import { formatDateTime, formatXof } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, Input, PageHeader, Spinner, Table, Td, Textarea, Th } from '@/components/ui';

const ACTIONS = { recompute: 'recompute', approve_operator: 'approve-operator', approve_lender: 'approve-lender', instruct: 'instruct', mark_executed: 'mark-executed', reconcile: 'reconcile' } as const;

export default function SettlementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations();
  const { api, authedFetch, hasPermission } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const [csv, setCsv] = useState('');
  const [failReason, setFailReason] = useState<Record<string, string>>({});
  const q = useQuery({ queryKey: ['settlement', id], queryFn: () => unwrap(api.GET('/v1/settlement-runs/{id}', { params: { path: { id } } })) });
  const r = q.data;
  const instructed = r && ['instructed', 'executed', 'reconciled'].includes(r.status);
  const ins = useQuery({ queryKey: ['instructions', id], enabled: !!instructed, queryFn: () => unwrap(api.GET('/v1/settlement-runs/{id}/instructions', { params: { path: { id } } })) as Promise<{ data: { id: string; ref: string; beneficiaryType: string; beneficiaryName: string; channel: string; destinationMasked: string; heldForFarmer: boolean; amountXof: number; status: string; provider: string; failureReason: string | null }[] }> });
  const operator = r?.allowedActions.includes('recompute') || r?.allowedActions.includes('mark_executed') || r?.allowedActions.includes('reconcile') || (r && r.lines.some((l) => l.farmerName));
  const st = useQuery({ queryKey: ['statements', id], enabled: !!instructed && !!operator, queryFn: () => unwrap(api.GET('/v1/settlement-runs/{id}/statements', { params: { path: { id } } })) });
  if (q.isLoading || !r) return <Spinner />;
  const refresh = () => Promise.all(['settlement', 'instructions', 'statements'].map((k) => qc.invalidateQueries({ queryKey: [k, id] })));
  const act = (a: keyof typeof ACTIONS) =>
    run(a, async () => {
      const path = { params: { path: { id } }, headers: ifMatch(r.version) };
      if (a === 'recompute') await unwrap(api.POST('/v1/settlement-runs/{id}/actions/recompute', path));
      else if (a === 'approve_operator') await unwrap(api.POST('/v1/settlement-runs/{id}/actions/approve-operator', path));
      else if (a === 'approve_lender') await unwrap(api.POST('/v1/settlement-runs/{id}/actions/approve-lender', path));
      else if (a === 'instruct') await unwrap(api.POST('/v1/settlement-runs/{id}/actions/instruct', path));
      else if (a === 'mark_executed') await unwrap(api.POST('/v1/settlement-runs/{id}/actions/mark-executed', path));
      else await unwrap(api.POST('/v1/settlement-runs/{id}/actions/reconcile', path));
      await refresh();
    });
  const download = (format: 'generic' | 'wave' | 'orange_money') =>
    run(`dl-${format}`, async () => {
      const res = await authedFetch(`/v1/settlement-runs/${id}/instructions?format=${format}`);
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${r.ref}-${format}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      await refresh();
    });
  const d = r.distribution;
  return (
    <>
      <PageHeader
        title={`${r.ref} · ${r.blockName}`}
        subtitle={`${t('settlement.receipts')} ${formatXof(r.receiptsTotalXof)} · ${t('settlement.grossCredit')} ${formatXof(r.grossCreditTotalXof)}`}
        actions={
          <>
            <Badge data-testid="settlement-status">{t(`settlement.status.${r.status}`)}</Badge>
            {(Object.keys(ACTIONS) as (keyof typeof ACTIONS)[]).filter((a) => r.allowedActions.includes(a)).map((a) => (
              <Button key={a} variant={a === 'recompute' ? 'secondary' : 'primary'} loading={busy === a} data-testid={`settlement-${a}`} onClick={() => act(a)}>{t(`settlement.actions.${a}`)}</Button>
            ))}
          </>
        }
      />
      {msg && <Alert tone={msg.tone} className="mb-4">{msg.text}</Alert>}
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <Card><CardBody><p className="text-xs text-neutral-500">{t('settlement.seasonalLenders')}</p><p className="text-xl font-semibold" data-testid="dist-seasonal">{formatXof(d.seasonalByFacility.reduce((s, x) => s + x.amountXof, 0))}</p></CardBody></Card>
        <Card><CardBody><p className="text-xs text-neutral-500">{t('settlement.investment')}</p><p className="text-xl font-semibold">{formatXof(d.investmentToLenderXof)}</p></CardBody></Card>
        <Card><CardBody><p className="text-xs text-neutral-500">{t('settlement.operator')}</p><p className="text-xl font-semibold" data-testid="dist-operator">{formatXof(d.operatorXof)}</p></CardBody></Card>
        <Card><CardBody><p className="text-xs text-neutral-500">{t('settlement.farmersTotal')}</p><p className="text-xl font-semibold" data-testid="dist-farmers">{formatXof(d.farmersTotalXof)}</p></CardBody></Card>
      </div>
      {!r.invariantOk && <Alert tone="error" className="mb-4">{t('settlement.invariantBroken')}</Alert>}
      <Card className="mb-6">
        <CardHeader><CardTitle>{t('settlement.lines')}</CardTitle></CardHeader>
        <CardBody className="p-0">
          <Table>
            <thead><tr><Th>{t('ops.farmer')}</Th><Th>{t('settlement.grossCredit')}</Th><Th>{t('settlement.seasonal')}</Th><Th>{t('settlement.invest')}</Th><Th>{t('settlement.fees')}</Th><Th>{t('settlement.solidarity')}</Th><Th>{t('settlement.payout')}</Th><Th>{t('settlement.arrears')}</Th></tr></thead>
            <tbody>
              {r.lines.map((l) => (
                <tr key={l.farmerId}>
                  <Td className="font-medium">{l.farmerCode}<span className="block text-xs text-neutral-500">{l.farmerName}</span></Td>
                  <Td>{formatXof(l.grossCreditXof)}</Td><Td>{formatXof(l.seasonalPaidXof)}</Td><Td>{formatXof(l.investmentFeePaidXof)}</Td><Td>{formatXof(l.operatorFeesPaidXof + l.otherDeductionsXof)}</Td>
                  <Td>{l.solidarityContributionXof ? `− ${formatXof(l.solidarityContributionXof)}` : l.solidarityReceivedXof ? `+ ${formatXof(l.solidarityReceivedXof)}` : '—'}</Td>
                  <Td className="font-semibold" data-testid={`payout-${l.farmerCode}`}>{formatXof(l.payoutXof)}</Td>
                  <Td className="text-xs">{l.arrears.seasonalDebtXof + l.arrears.investmentFeeXof + l.arrears.operatorFeesXof ? formatXof(l.arrears.seasonalDebtXof + l.arrears.investmentFeeXof + l.arrears.operatorFeesXof) : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
      <Card className="mb-6">
        <CardHeader><CardTitle>{t('settlement.approvals')}</CardTitle></CardHeader>
        <CardBody className="space-y-1 text-sm">
          <p>{t('settlement.operatorApproval')} : {formatDateTime(r.approvedOperatorAt)}</p>
          {r.lenderApprovals.map((a) => <p key={a.lenderOrgId}>{a.lenderName} : {a.approvedAt ? formatDateTime(a.approvedAt) : t('settlement.pending')}</p>)}
        </CardBody>
      </Card>
      {instructed && (
        <Card className="mb-6">
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{t('settlement.instructions')}</CardTitle>
            {operator && (
              <div className="flex gap-2">
                {(['generic', 'wave', 'orange_money'] as const).map((f) => <Button key={f} size="sm" variant="secondary" loading={busy === `dl-${f}`} onClick={() => download(f)}>{t(`settlement.formats.${f}`)}</Button>)}
              </div>
            )}
          </CardHeader>
          <CardBody className="p-0">
            <Table>
              <thead><tr><Th>{t('contracts.ref')}</Th><Th>{t('facility.beneficiary')}</Th><Th>{t('settlement.channel')}</Th><Th>{t('fin.amount')}</Th><Th>{t('common.status')}</Th><Th /></tr></thead>
              <tbody>
                {(ins.data?.data ?? []).map((i) => (
                  <tr key={i.id}>
                    <Td className="font-medium">{i.ref}</Td>
                    <Td>{i.beneficiaryName}<span className="block text-xs text-neutral-500">{t(`settlement.beneficiaries.${i.beneficiaryType}`)}{i.heldForFarmer ? ` · ${t('settlement.heldForFarmer')}` : ''}</span></Td>
                    <Td className="text-xs">{i.channel === 'mobile_money' ? i.provider : t('settlement.bank')} · {i.destinationMasked}</Td>
                    <Td>{formatXof(i.amountXof)}</Td>
                    <Td><Badge data-testid={`instruction-status-${i.ref}`}>{t(`settlement.insStatus.${i.status}`)}</Badge>{i.failureReason && <span className="block text-xs text-red-600">{i.failureReason}</span>}</Td>
                    <Td className="whitespace-nowrap">
                      {hasPermission('payout:confirm') && i.status !== 'confirmed' && r.status !== 'reconciled' && (
                        <>
                          <Button size="sm" data-testid={`confirm-${i.ref}`} onClick={() => run(`c${i.id}`, async () => { await unwrap(api.POST('/v1/payout-instructions/{id}/actions/confirm', { params: { path: { id: i.id } }, body: {} })); await refresh(); })}>{t('facility.confirmFunds')}</Button>
                          <Input className="ml-1 inline h-8 w-32" aria-label={t('rfp.reason')} placeholder={t('rfp.reason')} value={failReason[i.id] ?? ''} onChange={(e) => setFailReason({ ...failReason, [i.id]: e.target.value })} />
                          <Button size="sm" variant="ghost" disabled={!failReason[i.id]?.trim()} onClick={() => run(`f${i.id}`, async () => { await unwrap(api.POST('/v1/payout-instructions/{id}/actions/fail', { params: { path: { id: i.id } }, body: { reason: failReason[i.id] } })); await refresh(); })}>{t('settlement.fail')}</Button>
                        </>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {operator && r.status !== 'reconciled' && (
              <div className="space-y-2 border-t border-neutral-100 p-5">
                <p className="text-sm font-medium">{t('settlement.importTitle')}</p>
                <Textarea aria-label={t('settlement.importTitle')} rows={4} placeholder="reference,status,provider_ref,reason" value={csv} onChange={(e) => setCsv(e.target.value)} />
                <Button size="sm" variant="secondary" disabled={csv.trim().length < 10} loading={busy === 'imp'} onClick={() => run('imp', async () => { const res = await unwrap(api.POST('/v1/settlement-runs/{id}/instructions/actions/import-confirmations', { params: { path: { id } }, body: { csv } })); setCsv(''); await refresh(); return res; }, t('settlement.imported'))}>{t('settlement.import')}</Button>
              </div>
            )}
          </CardBody>
        </Card>
      )}
      {instructed && operator && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>{t('settlement.statements')}</CardTitle>
            {hasPermission('statement:send') && <Button size="sm" loading={busy === 'send'} data-testid="send-statements" onClick={() => run('send', async () => { const res = await unwrap(api.POST('/v1/settlement-runs/{id}/statements/actions/send', { params: { path: { id } } })); await refresh(); return res; }, t('settlement.statementsSent'))}>{t('settlement.sendStatements')}</Button>}
          </CardHeader>
          <CardBody className="p-0">
            <Table>
              <thead><tr><Th>{t('ops.farmer')}</Th><Th>SMS</Th><Th>{t('settlement.sentAt')}</Th><Th /></tr></thead>
              <tbody>
                {(st.data?.data ?? []).map((s) => (
                  <tr key={s.id}>
                    <Td>{s.farmerCode}<span className="block text-xs text-neutral-500">{s.farmerName}</span></Td>
                    <Td className="max-w-md text-xs">{s.smsText}</Td>
                    <Td>{formatDateTime(s.sentAt)}</Td>
                    <Td>{s.hasPdf && <Button size="sm" variant="ghost" onClick={() => run('pdf', async () => { const x = await unwrap(api.GET('/v1/farmer-statements/{id}/pdf', { params: { path: { id: s.id } } })); window.open(x.url, '_blank', 'noopener'); })}>PDF</Button>}</Td>
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
