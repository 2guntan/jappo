'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap, type Schemas } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { ifMatch, uploadFile, useAction } from '@/lib/hooks';
import { facilityTone, formatDateTime, formatXof } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, Field, Input, Select, Table, Td, Th } from '@/components/ui';

type Facility = Schemas['Facility'];
type Disbursement = Schemas['Disbursement'];

function RequestForm({ facility, onDone }: { facility: Facility; onDone: () => Promise<unknown> }) {
  const t = useTranslations();
  const { api } = useSession();
  const { busy, msg, run } = useAction();
  const remaining = facility.principalXof - facility.requestedXof;
  const [f, setF] = useState({ amountXof: String(remaining), purpose: '', beneficiaryType: 'supplier' as 'supplier' | 'operator' | 'farmer', beneficiaryName: '', beneficiaryFarmerId: '' });
  return (
    <div className="space-y-3 border-t border-neutral-100 p-5">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <p className="text-sm font-medium">{t('facility.requestDisbursement')} · {t('facility.remaining')} {formatXof(remaining)}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('fin.amount')} htmlFor="d-amount"><Input id="d-amount" inputMode="numeric" value={f.amountXof} onChange={(e) => setF({ ...f, amountXof: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label={t('facility.purpose')} htmlFor="d-purpose"><Input id="d-purpose" value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} /></Field>
        <Field label={t('facility.beneficiaryType')} htmlFor="d-btype">
          <Select id="d-btype" value={f.beneficiaryType} onChange={(e) => setF({ ...f, beneficiaryType: e.target.value as typeof f.beneficiaryType })}>
            {(['supplier', 'operator', 'farmer'] as const).map((b) => <option key={b} value={b}>{t(`facility.beneficiaries.${b}`)}</option>)}
          </Select>
        </Field>
        {f.beneficiaryType === 'supplier' && <Field label={t('facility.beneficiaryName')} htmlFor="d-bname"><Input id="d-bname" value={f.beneficiaryName} onChange={(e) => setF({ ...f, beneficiaryName: e.target.value })} /></Field>}
        {f.beneficiaryType === 'farmer' && (
          <Field label={t('facility.beneficiaryFarmer')} htmlFor="d-bfarmer">
            <Select id="d-bfarmer" value={f.beneficiaryFarmerId} onChange={(e) => setF({ ...f, beneficiaryFarmerId: e.target.value })}>
              <option value="">—</option>
              {facility.farmerAllocations.map((a) => <option key={a.farmerId} value={a.farmerId}>{a.farmerCode}</option>)}
            </Select>
          </Field>
        )}
      </div>
      <Button
        loading={busy === 'req'}
        disabled={!Number(f.amountXof) || f.purpose.trim().length < 3}
        onClick={() => run('req', async () => {
          await unwrap(api.POST('/v1/facilities/{id}/disbursements', { params: { path: { id: facility.id } }, body: { amountXof: Number(f.amountXof), purpose: f.purpose, beneficiaryType: f.beneficiaryType, beneficiaryName: f.beneficiaryName || null, beneficiaryFarmerId: f.beneficiaryFarmerId || null } }));
          await onDone();
        })}
      >
        {t('facility.submitRequest')}
      </Button>
    </div>
  );
}

function LenderActions({ d, onDone }: { d: Disbursement; onDone: () => Promise<unknown> }) {
  const t = useTranslations();
  const { api, authedFetch } = useSession();
  const { busy, msg, run } = useAction();
  const [bankRef, setBankRef] = useState('');
  const [reason, setReason] = useState('');
  const [proof, setProof] = useState<File | null>(null);
  const act = (action: 'approve' | 'reject' | 'execute' | 'confirm', body: { reason?: string; bankReference?: string; proofFileId?: string | null } = {}) =>
    run(action, async () => {
      const opts = { params: { path: { id: d.id } }, headers: ifMatch(d.version), body };
      if (action === 'approve') await unwrap(api.POST('/v1/disbursements/{id}/actions/approve', opts));
      else if (action === 'reject') await unwrap(api.POST('/v1/disbursements/{id}/actions/reject', opts));
      else if (action === 'execute') await unwrap(api.POST('/v1/disbursements/{id}/actions/execute', opts));
      else await unwrap(api.POST('/v1/disbursements/{id}/actions/confirm', opts));
      await onDone();
    });
  return (
    <div className="space-y-2">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        {d.allowedActions.includes('approve') && <Button size="sm" loading={busy === 'approve'} data-testid={`approve-${d.ref}`} onClick={() => act('approve')}>{t('facility.approve')}</Button>}
        {d.allowedActions.includes('execute') && (
          <>
            <Input className="h-8 w-40" aria-label={t('facility.bankReference')} placeholder={t('facility.bankReference')} value={bankRef} onChange={(e) => setBankRef(e.target.value)} />
            <Input className="h-8 w-48" type="file" accept="application/pdf,image/*" aria-label={t('facility.proof')} onChange={(e) => setProof(e.target.files?.[0] ?? null)} />
            <Button size="sm" disabled={!bankRef.trim()} loading={busy === 'execute'} data-testid={`execute-${d.ref}`} onClick={() => run('execute', async () => {
              const proofFileId = proof ? await uploadFile(authedFetch, proof) : null;
              await unwrap(api.POST('/v1/disbursements/{id}/actions/execute', { params: { path: { id: d.id } }, headers: ifMatch(d.version), body: { bankReference: bankRef, proofFileId } }));
              await onDone();
            })}>{t('facility.execute')}</Button>
          </>
        )}
        {d.status === 'approved' && !d.allowedActions.includes('execute') && <span className="text-xs text-neutral-500">{t('facility.fourEyes')}</span>}
        {d.allowedActions.includes('confirm') && <Button size="sm" loading={busy === 'confirm'} data-testid={`confirm-${d.ref}`} onClick={() => act('confirm')}>{t('facility.confirmFunds')}</Button>}
        {d.allowedActions.includes('reject') && (
          <>
            <Input className="h-8 w-36" aria-label={t('rfp.reason')} placeholder={t('rfp.reason')} value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button size="sm" variant="ghost" disabled={!reason.trim()} loading={busy === 'reject'} onClick={() => act('reject', { reason })}>{t('facility.reject')}</Button>
          </>
        )}
      </div>
    </div>
  );
}

export function Disbursements({ facility }: { facility: Facility }) {
  const t = useTranslations();
  const { api } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['disbursements', facility.id], queryFn: () => unwrap(api.GET('/v1/facilities/{id}/disbursements', { params: { path: { id: facility.id } } })) });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['disbursements', facility.id] }), qc.invalidateQueries({ queryKey: ['facility', facility.id] })]);
  const rows = q.data?.data ?? [];
  return (
    <Card>
      <CardHeader><CardTitle>{t('facility.disbursements')}</CardTitle></CardHeader>
      <CardBody className="p-0">
        {rows.length === 0 ? <p className="p-5 text-sm text-neutral-600">{t('facility.noDisbursements')}</p> : (
          <Table>
            <thead><tr><Th>{t('facility.ref')}</Th><Th>{t('fin.amount')}</Th><Th>{t('facility.beneficiary')}</Th><Th>{t('facility.bankReference')}</Th><Th>{t('common.status')}</Th><Th /></tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <Td className="font-medium">{d.ref}<span className="block text-xs text-neutral-500">{d.purpose}</span></Td>
                  <Td>{formatXof(d.amountXof)}</Td>
                  <Td>{d.beneficiaryName}<span className="block text-xs text-neutral-500">{t(`facility.beneficiaries.${d.beneficiaryType}`)}</span></Td>
                  <Td>{d.bankReference ?? '—'}<span className="block text-xs text-neutral-500">{formatDateTime(d.confirmedAt ?? d.executedAt ?? d.approvedAt ?? d.createdAt)}</span></Td>
                  <Td><Badge tone={facilityTone(d.status)} data-testid={`disbursement-status-${d.ref}`}>{t(`facility.dStatus.${d.status}`)}</Badge>{d.rejectReason && <span className="block text-xs text-red-600">{d.rejectReason}</span>}</Td>
                  <Td>{d.allowedActions.length > 0 && <LenderActions d={d} onDone={refresh} />}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {facility.allowedActions.includes('request_disbursement') && <RequestForm facility={facility} onDone={refresh} />}
      </CardBody>
    </Card>
  );
}
