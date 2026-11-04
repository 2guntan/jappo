'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { CAPEX_TRANCHES, OPEX_KINDS } from '@jappo/contracts';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import { formatDate, formatXof } from '@/lib/utils';
import { Alert, Button, Card, CardBody, CardHeader, CardTitle, Field, Input, Select, Table, Td, Th } from '@/components/ui';
import type { BlockT } from './types';

export function InvestmentTab({ block }: { block: BlockT }) {
  const t = useTranslations();
  const { api, hasPermission } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const own = block.allowedActions.includes('update');
  const capex = useQuery({ queryKey: ['capex', block.id], queryFn: () => unwrap(api.GET('/v1/blocks/{id}/capex-items', { params: { path: { id: block.id } } })) });
  const opex = useQuery({ queryKey: ['opex', block.id], queryFn: () => unwrap(api.GET('/v1/blocks/{id}/operator-opex', { params: { path: { id: block.id } } })) });
  const fee = useQuery({ queryKey: ['fee', block.id], retry: false, queryFn: () => unwrap(api.GET('/v1/blocks/{id}/fee-policy', { params: { path: { id: block.id } } })) });
  const [c, setC] = useState({ description: '', assetType: 'solar_pump', amountXof: '', usefulLifeYears: '10', tranche: 'investment', plannedDate: '' });
  const [o, setO] = useState({ description: '', kind: 'staff', amountXofPerMonth: '', startDate: '' });
  const [f, setF] = useState({ operatorServiceFeeXofPerFarmerSeason: '', landFeeXofPerHaSeason: '0', investmentRecoveryFeeXofPerHaSeason: '' });
  useEffect(() => {
    if (fee.data) setF({ operatorServiceFeeXofPerFarmerSeason: String(fee.data.operatorServiceFeeXofPerFarmerSeason), landFeeXofPerHaSeason: String(fee.data.landFeeXofPerHaSeason), investmentRecoveryFeeXofPerHaSeason: String(fee.data.investmentRecoveryFeeXofPerHaSeason) });
  }, [fee.data]);
  const inv = (k: string) => qc.invalidateQueries({ queryKey: [k, block.id] });
  return (
    <div className="space-y-6">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <CardHeader><CardTitle>{t('investment.fees')}</CardTitle></CardHeader>
        <CardBody>
          {!fee.data && <p className="mb-3 text-sm text-neutral-600">{t('investment.noFees')}</p>}
          <form className="grid gap-3 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); void run('fee', async () => { await unwrap(api.PUT('/v1/blocks/{id}/fee-policy', { params: { path: { id: block.id } }, body: { operatorServiceFeeXofPerFarmerSeason: Number(f.operatorServiceFeeXofPerFarmerSeason), landFeeXofPerHaSeason: Number(f.landFeeXofPerHaSeason), investmentRecoveryFeeXofPerHaSeason: Number(f.investmentRecoveryFeeXofPerHaSeason) } })); await inv('fee'); }, t('common.saved')); }}>
            <Field label={t('investment.serviceFee')} htmlFor="fee-svc"><Input id="fee-svc" type="number" min={0} disabled={!own || !hasPermission('fee_policy:manage')} value={f.operatorServiceFeeXofPerFarmerSeason} onChange={(e) => setF({ ...f, operatorServiceFeeXofPerFarmerSeason: e.target.value })} /></Field>
            <Field label={t('investment.landFee')} htmlFor="fee-land"><Input id="fee-land" type="number" min={0} disabled={!own || !hasPermission('fee_policy:manage')} value={f.landFeeXofPerHaSeason} onChange={(e) => setF({ ...f, landFeeXofPerHaSeason: e.target.value })} /></Field>
            <Field label={t('investment.recoveryFee')} htmlFor="fee-rec"><Input id="fee-rec" type="number" min={0} disabled={!own || !hasPermission('fee_policy:manage')} value={f.investmentRecoveryFeeXofPerHaSeason} onChange={(e) => setF({ ...f, investmentRecoveryFeeXofPerHaSeason: e.target.value })} /></Field>
            {own && hasPermission('fee_policy:manage') && <div className="flex items-end"><Button type="submit" loading={busy === 'fee'}>{t('investment.saveFees')}</Button></div>}
          </form>
        </CardBody>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t('investment.capex')}</CardTitle></CardHeader>
          <CardBody className="space-y-4 p-0">
            <Table>
              <thead><tr><Th>{t('investment.description')}</Th><Th>{t('investment.amount')}</Th><Th>{t('investment.tranche')}</Th><Th>{t('investment.plannedDate')}</Th><Th /></tr></thead>
              <tbody>{capex.data?.data.map((x) => <tr key={x.id}><Td>{x.description}<div className="text-xs text-neutral-500">{x.assetType} · {x.usefulLifeYears} ans</div></Td><Td>{formatXof(x.amountXof)}</Td><Td>{t(`investment.tranches.${x.tranche}`)}</Td><Td>{formatDate(x.plannedDate)}</Td><Td>{own && <Button size="sm" variant="ghost" onClick={() => run('dc', async () => { await unwrap(api.DELETE('/v1/capex-items/{id}', { params: { path: { id: x.id } } })); await inv('capex'); })}>{t('seasons.remove')}</Button>}</Td></tr>)}</tbody>
            </Table>
            {own && hasPermission('capex:manage') && (
              <form className="grid gap-3 px-5 pb-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void run('c', async () => { await unwrap(api.POST('/v1/blocks/{id}/capex-items', { params: { path: { id: block.id } }, body: { ...c, amountXof: Number(c.amountXof), usefulLifeYears: Number(c.usefulLifeYears), tranche: c.tranche as 'investment' } })); setC({ ...c, description: '', amountXof: '' }); await inv('capex'); }); }}>
                <Field label={t('investment.description')} htmlFor="cx-d"><Input id="cx-d" required value={c.description} onChange={(e) => setC({ ...c, description: e.target.value })} /></Field>
                <Field label={t('investment.assetType')} htmlFor="cx-t"><Input id="cx-t" required value={c.assetType} onChange={(e) => setC({ ...c, assetType: e.target.value })} /></Field>
                <Field label={t('investment.amount')} htmlFor="cx-a"><Input id="cx-a" type="number" min={1} required value={c.amountXof} onChange={(e) => setC({ ...c, amountXof: e.target.value })} /></Field>
                <Field label={t('investment.life')} htmlFor="cx-l"><Input id="cx-l" type="number" min={1} value={c.usefulLifeYears} onChange={(e) => setC({ ...c, usefulLifeYears: e.target.value })} /></Field>
                <Field label={t('investment.tranche')} htmlFor="cx-tr"><Select id="cx-tr" value={c.tranche} onChange={(e) => setC({ ...c, tranche: e.target.value })}>{CAPEX_TRANCHES.map((x) => <option key={x} value={x}>{t(`investment.tranches.${x}`)}</option>)}</Select></Field>
                <Field label={t('investment.plannedDate')} htmlFor="cx-pd"><Input id="cx-pd" type="date" required value={c.plannedDate} onChange={(e) => setC({ ...c, plannedDate: e.target.value })} /></Field>
                <div><Button type="submit" loading={busy === 'c'}>{t('investment.add')}</Button></div>
              </form>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t('investment.opex')}</CardTitle></CardHeader>
          <CardBody className="space-y-4 p-0">
            <Table>
              <thead><tr><Th>{t('investment.description')}</Th><Th>{t('investment.amount')}</Th><Th>{t('seasons.start')}</Th><Th /></tr></thead>
              <tbody>{opex.data?.data.map((x) => <tr key={x.id}><Td>{x.description}<div className="text-xs text-neutral-500">{t(`investment.opexKinds.${x.kind}`)}</div></Td><Td>{formatXof(x.amountXofPerMonth)} {t('investment.perMonth')}</Td><Td>{formatDate(x.startDate)}</Td><Td>{own && <Button size="sm" variant="ghost" onClick={() => run('do', async () => { await unwrap(api.DELETE('/v1/operator-opex/{id}', { params: { path: { id: x.id } } })); await inv('opex'); })}>{t('seasons.remove')}</Button>}</Td></tr>)}</tbody>
            </Table>
            {own && hasPermission('opex:manage') && (
              <form className="grid gap-3 px-5 pb-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void run('o', async () => { await unwrap(api.POST('/v1/blocks/{id}/operator-opex', { params: { path: { id: block.id } }, body: { ...o, kind: o.kind as 'staff', amountXofPerMonth: Number(o.amountXofPerMonth) } })); setO({ ...o, description: '', amountXofPerMonth: '' }); await inv('opex'); }); }}>
                <Field label={t('investment.description')} htmlFor="ox-d"><Input id="ox-d" required value={o.description} onChange={(e) => setO({ ...o, description: e.target.value })} /></Field>
                <Field label={t('investment.kind')} htmlFor="ox-k"><Select id="ox-k" value={o.kind} onChange={(e) => setO({ ...o, kind: e.target.value })}>{OPEX_KINDS.map((x) => <option key={x} value={x}>{t(`investment.opexKinds.${x}`)}</option>)}</Select></Field>
                <Field label={`${t('investment.amount')} (${t('investment.perMonth')})`} htmlFor="ox-a"><Input id="ox-a" type="number" min={0} required value={o.amountXofPerMonth} onChange={(e) => setO({ ...o, amountXofPerMonth: e.target.value })} /></Field>
                <Field label={t('seasons.start')} htmlFor="ox-s"><Input id="ox-s" type="date" required value={o.startDate} onChange={(e) => setO({ ...o, startDate: e.target.value })} /></Field>
                <div><Button type="submit" loading={busy === 'o'}>{t('investment.add')}</Button></div>
              </form>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
