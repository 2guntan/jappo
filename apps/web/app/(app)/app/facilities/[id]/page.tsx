'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { ifMatch, useAction } from '@/lib/hooks';
import { facilityTone, formatDate, formatXof } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, Field, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@/components/ui';
import { Disbursements } from '@/components/facilities/disbursements';

export default function FacilityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations();
  const { api } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const [esc, setEsc] = useState({ bankName: '', accountLabel: '', accountNumber: '', iban: '' });
  const [loanRef, setLoanRef] = useState<string | null>(null);
  const [rs, setRs] = useState({ reason: '', extendMonths: '3' });
  const q = useQuery({ queryKey: ['facility', id], queryFn: () => unwrap(api.GET('/v1/facilities/{id}', { params: { path: { id } } })) });
  const f = q.data;
  const escrows = useQuery({ queryKey: ['escrows', f?.blockId], enabled: !!f, queryFn: () => unwrap(api.GET('/v1/escrow-accounts', { params: { query: { blockId: f!.blockId } } })) });
  const contracts = useQuery({ queryKey: ['contracts', 'facility', id], enabled: !!f, queryFn: () => unwrap(api.GET('/v1/contracts', { params: { query: { relatedId: id } } })) });
  const reps = useQuery({ queryKey: ['repayments', id], queryFn: () => unwrap(api.GET('/v1/facilities/{id}/repayments', { params: { path: { id } } })) });
  if (q.isLoading || !f) return <Spinner />;
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['facility', id] }), qc.invalidateQueries({ queryKey: ['escrows'] }), qc.invalidateQueries({ queryKey: ['facilities'] })]);
  const lender = f.allowedActions.includes('edit');
  const ownEscrows = (escrows.data?.data ?? []).filter((e) => e.lenderOrgId === f.lenderOrgId);
  const linked = escrows.data?.data.find((e) => e.id === f.escrowAccountId);

  return (
    <>
      <PageHeader
        title={`${f.ref} · ${formatXof(f.principalXof)}`}
        subtitle={<>{f.blockRef} · {f.blockName} · {f.lenderName} → {f.operatorName}</>}
        actions={
          <>
            <Badge tone={facilityTone(f.status)} data-testid="facility-status">{t(`facility.status.${f.status}`)}</Badge>
            {f.allowedActions.includes('confirm_cp') && (
              <Button loading={busy === 'cp'} data-testid="confirm-cp" onClick={() => run('cp', async () => { await unwrap(api.POST('/v1/facilities/{id}/actions/confirm-cp', { params: { path: { id } }, headers: ifMatch(f.version) })); await refresh(); })}>{t('facility.confirmCp')}</Button>
            )}
          </>
        }
      />
      {msg && <Alert tone={msg.tone} className="mb-4">{msg.text}</Alert>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>{t('facility.terms')}</CardTitle></CardHeader>
            <CardBody className="grid gap-3 text-sm sm:grid-cols-3">
              <p><span className="block text-xs text-neutral-500">{t('fin.rate')}</span>{(f.rateBps / 100).toFixed(2)} % · {t(`model.methods.${f.rateMethod}`)}</p>
              <p><span className="block text-xs text-neutral-500">{t('facility.upfrontFee')}</span>{formatXof(f.upfrontFeeXof)}</p>
              <p><span className="block text-xs text-neutral-500">{t('fin.tenor')}</span>{f.tenorMonths} · {t(`model.profiles.${f.repaymentProfile}`)}</p>
              <p><span className="block text-xs text-neutral-500">{t('facility.start')}</span>{formatDate(f.startDate)}</p>
              <p><span className="block text-xs text-neutral-500">{t('facility.maturity')}</span>{formatDate(f.maturityDate)}</p>
              <p><span className="block text-xs text-neutral-500">{t('fin.borrower')}</span>{t(`model.borrowers.${f.borrowerType}`)}</p>
              <p><span className="block text-xs text-neutral-500">{t('facility.disbursed')}</span><span data-testid="disbursed">{formatXof(f.disbursedXof)}</span></p>
              <p><span className="block text-xs text-neutral-500">{t('facility.outstanding')}</span>{formatXof(f.outstandingPrincipalXof)}</p>
              <p><span className="block text-xs text-neutral-500">{t('facility.overdue')}</span>{formatXof(f.overdueXof)}</p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t('facility.schedule')}</CardTitle></CardHeader>
            <CardBody className="p-0">
              <Table>
                <thead><tr><Th>#</Th><Th>{t('facility.dueDate')}</Th><Th>{t('facility.principal')}</Th><Th>{t('facility.interest')}</Th><Th>{t('facility.total')}</Th><Th>{t('facility.paid')}</Th><Th>{t('common.status')}</Th></tr></thead>
                <tbody>
                  {f.schedule.map((l) => (
                    <tr key={l.seq}>
                      <Td>{l.seq}</Td><Td>{formatDate(l.dueDate)}</Td><Td>{formatXof(l.principalXof)}</Td><Td>{formatXof(l.interestXof)}</Td>
                      <Td className="font-medium" data-testid={`schedule-total-${l.seq}`}>{formatXof(l.totalXof)}</Td><Td>{formatXof(l.paidXof)}</Td>
                      <Td><Badge tone={facilityTone(l.status)}>{t(`facility.lineStatus.${l.status}`)}</Badge></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </CardBody>
          </Card>
          <Disbursements facility={f} />
          {f.farmerAllocations.length > 0 && (
            <Card>
              <CardHeader><CardTitle>{t('facility.allocations')}</CardTitle></CardHeader>
              <CardBody className="p-0">
                <Table>
                  <thead><tr><Th>{t('farmers.code')}</Th><Th>{t('facility.principal')}</Th><Th>{t('facility.interest')}</Th><Th>{t('facility.fees')}</Th><Th>{t('facility.due')}</Th></tr></thead>
                  <tbody>
                    {f.farmerAllocations.map((a) => (
                      <tr key={a.farmerId}><Td>{a.farmerCode}</Td><Td>{formatXof(a.principalXof)}</Td><Td>{formatXof(a.interestXof)}</Td><Td>{formatXof(a.feesXof)}</Td><Td className="font-medium">{formatXof(a.dueXof)}</Td></tr>
                    ))}
                  </tbody>
                </Table>
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader><CardTitle>{t('facility.repayments')}</CardTitle></CardHeader>
            <CardBody className="p-0">
              {(reps.data?.data ?? []).length === 0 ? <p className="p-5 text-sm text-neutral-600">{t('facility.noRepayments')}</p> : (
                <Table>
                  <thead><tr><Th>{t('facility.valueDate')}</Th><Th>{t('fin.amount')}</Th><Th>{t('facility.principal')}</Th><Th>{t('facility.interest')}</Th><Th>{t('facility.source')}</Th></tr></thead>
                  <tbody>{reps.data!.data.map((r) => <tr key={r.id}><Td>{formatDate(r.valueDate)}</Td><Td>{formatXof(r.amountXof)}</Td><Td>{formatXof(r.principalXof)}</Td><Td>{formatXof(r.interestXof)}</Td><Td>{r.source}</Td></tr>)}</tbody>
                </Table>
              )}
            </CardBody>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>{t('facility.cp')}</CardTitle></CardHeader>
            <CardBody className="space-y-2 text-sm">
              <ul className="space-y-1">
                {f.conditionsPrecedent.map((c) => <li key={c.code} data-testid={`cp-${c.code}`} className={c.met ? 'text-brand-700' : 'text-neutral-600'}>{c.met ? '✔' : '○'} {t(`facility.cps.${c.code}`)}</li>)}
              </ul>
              {(contracts.data?.data ?? []).map((c) => <Link key={c.id} className="block text-brand-700 hover:underline" href={`/app/contracts/${c.id}`}>{c.ref} · {t(`contracts.status.${c.status}`)}</Link>)}
              {f.seasonId && <Link className="block text-brand-700 hover:underline" href={`/app/contracts?seasonId=${f.seasonId}`}>{t('facility.seasonContracts')}</Link>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t('facility.escrow')}</CardTitle></CardHeader>
            <CardBody className="space-y-3 text-sm">
              {linked ? <p data-testid="escrow-linked">{linked.bankName} · {linked.accountLabel} · {linked.accountNumberMasked}</p> : <p className="text-neutral-600">{t('facility.noEscrow')}</p>}
              {lender && f.status === 'pending_cp' && ownEscrows.length > 0 && !f.escrowAccountId && (
                <Select aria-label={t('facility.escrow')} onChange={(e) => e.target.value && run('link', async () => { await unwrap(api.PATCH('/v1/facilities/{id}', { params: { path: { id } }, headers: ifMatch(f.version), body: { escrowAccountId: e.target.value } })); await refresh(); })}>
                  <option value="">{t('facility.linkEscrow')}</option>
                  {ownEscrows.map((e) => <option key={e.id} value={e.id}>{e.accountLabel} · {e.accountNumberMasked}</option>)}
                </Select>
              )}
              {lender && !f.escrowAccountId && (
                <div className="space-y-2">
                  <Field label={t('facility.bankName')} htmlFor="e-bank"><Input id="e-bank" value={esc.bankName} onChange={(e) => setEsc({ ...esc, bankName: e.target.value })} /></Field>
                  <Field label={t('facility.accountLabel')} htmlFor="e-label"><Input id="e-label" value={esc.accountLabel} onChange={(e) => setEsc({ ...esc, accountLabel: e.target.value })} /></Field>
                  <Field label={t('facility.accountNumber')} htmlFor="e-number"><Input id="e-number" value={esc.accountNumber} onChange={(e) => setEsc({ ...esc, accountNumber: e.target.value })} /></Field>
                  <Field label="IBAN" htmlFor="e-iban"><Input id="e-iban" value={esc.iban} onChange={(e) => setEsc({ ...esc, iban: e.target.value })} /></Field>
                  <Button
                    className="w-full"
                    loading={busy === 'esc'}
                    disabled={!esc.bankName || !esc.accountLabel || esc.accountNumber.length < 6}
                    onClick={() => run('esc', async () => { await unwrap(api.POST('/v1/escrow-accounts', { body: { blockId: f.blockId, bankName: esc.bankName, accountLabel: esc.accountLabel, accountNumber: esc.accountNumber, iban: esc.iban || null } })); await refresh(); })}
                  >
                    {t('facility.createEscrow')}
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>
          {lender && (
            <Card>
              <CardHeader><CardTitle>{t('facility.lenderLoanRef')}</CardTitle></CardHeader>
              <CardBody className="flex gap-2">
                <Input aria-label={t('facility.lenderLoanRef')} value={loanRef ?? f.lenderLoanRef ?? ''} onChange={(e) => setLoanRef(e.target.value)} />
                <Button variant="secondary" disabled={loanRef === null} loading={busy === 'ref'} onClick={() => run('ref', async () => { await unwrap(api.PATCH('/v1/facilities/{id}', { params: { path: { id } }, headers: ifMatch(f.version), body: { lenderLoanRef: loanRef || null } })); setLoanRef(null); await refresh(); })}>{t('common.save')}</Button>
              </CardBody>
            </Card>
          )}
          {(f.allowedActions.includes('restructure') || f.allowedActions.includes('mark_default')) && (
            <Card>
              <CardHeader><CardTitle>{t('facility.arrearsActions')}</CardTitle></CardHeader>
              <CardBody className="space-y-2">
                <Input aria-label={t('rfp.reason')} placeholder={t('rfp.reason')} value={rs.reason} onChange={(e) => setRs({ ...rs, reason: e.target.value })} />
                {f.allowedActions.includes('restructure') && (
                  <div className="flex gap-2">
                    <Input aria-label={t('facility.extendMonths')} className="w-20" inputMode="numeric" value={rs.extendMonths} onChange={(e) => setRs({ ...rs, extendMonths: e.target.value.replace(/\D/g, '') })} />
                    <Button variant="secondary" disabled={rs.reason.length < 3 || !Number(rs.extendMonths)} loading={busy === 'rs'} onClick={() => run('rs', async () => { await unwrap(api.POST('/v1/facilities/{id}/actions/restructure', { params: { path: { id } }, headers: ifMatch(f.version), body: { reason: rs.reason, extendMonths: Number(rs.extendMonths) } })); await refresh(); })}>{t('facility.restructure')}</Button>
                  </div>
                )}
                {f.allowedActions.includes('mark_default') && <Button variant="danger" disabled={rs.reason.length < 3} loading={busy === 'def'} onClick={() => run('def', async () => { await unwrap(api.POST('/v1/facilities/{id}/actions/mark-default', { params: { path: { id } }, headers: ifMatch(f.version), body: { reason: rs.reason } })); await refresh(); })}>{t('facility.markDefault')}</Button>}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
