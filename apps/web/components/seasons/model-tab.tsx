'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ApiError, unwrap, type Schemas } from '@jappo/sdk';
import { GRACE_TYPES, RATE_METHODS, REPAYMENT_PROFILES, SCENARIO_CODES } from '@jappo/contracts';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import { formatDateTime, formatXof } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, Field, Input, Select, Table, Td, Th } from '@/components/ui';

type Seasonal = NonNullable<Schemas['ModelAssumptions']['seasonal']>;
type Investment = NonNullable<Schemas['ModelAssumptions']['investment']>;
const DEFAULT_SEASONAL: Seasonal = { rateBps: 1800, rateMethod: 'flat', upfrontFeeBps: 100, tenorMonths: 6, repaymentProfile: 'bullet', feesChargedTo: 'operator', borrowerType: 'farmers' };
const DEFAULT_INVESTMENT: Investment = { rateBps: 1200, rateMethod: 'declining', upfrontFeeBps: 100, tenorMonths: 36, graceMonths: 0, graceType: 'interest_only', repaymentProfile: 'annuity' };

function NumField({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (v: number) => void }) {
  return <Field label={label} htmlFor={id}><Input id={id} type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} /></Field>;
}

export function ModelTab({ season }: { season: Schemas['Season'] }) {
  const t = useTranslations();
  const { api } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const editable = season.allowedActions.includes('edit_plan');
  const assumptions = useQuery({ queryKey: ['assumptions', season.id], queryFn: () => unwrap(api.GET('/v1/seasons/{id}/model-assumptions', { params: { path: { id: season.id } } })) });
  const current = useQuery({
    queryKey: ['model-current', season.id],
    retry: false,
    queryFn: async () => {
      try {
        return await unwrap(api.GET('/v1/seasons/{id}/model-runs/current', { params: { path: { id: season.id } } }));
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  });
  const [seasonal, setSeasonal] = useState<Seasonal | null>(null);
  const [investment, setInvestment] = useState<Investment | null>(null);
  const [spy, setSpy] = useState(1);
  const [disc, setDisc] = useState(1200);
  const [shock, setShock] = useState({ yieldShockPct: 0, priceShockPct: 0 });
  const [preview, setPreview] = useState<Schemas['ModelRun'] | null>(null);
  useEffect(() => {
    if (assumptions.data) {
      setSeasonal(assumptions.data.seasonal ?? (assumptions.data.version === 0 ? DEFAULT_SEASONAL : null));
      setInvestment(assumptions.data.investment);
      setSpy(assumptions.data.seasonsPerYear);
      setDisc(assumptions.data.discountRateBps);
    }
  }, [assumptions.data]);

  const runData = preview ?? current.data ?? null;
  const out = runData?.outputs;
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['model-current', season.id] }), qc.invalidateQueries({ queryKey: ['readiness', season.id] })]);

  return (
    <div className="space-y-6">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <CardHeader><CardTitle>{t('model.assumptions')}</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <div className="grid gap-6 lg:grid-cols-2">
            <fieldset className="space-y-3" disabled={!editable}>
              <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={!!seasonal} onChange={(e) => setSeasonal(e.target.checked ? DEFAULT_SEASONAL : null)} /> {t('model.seasonal')}</label>
              {seasonal && (
                <div className="grid grid-cols-2 gap-3">
                  <NumField id="s-rate" label={t('model.rate')} value={seasonal.rateBps} onChange={(v) => setSeasonal({ ...seasonal, rateBps: v })} />
                  <Field label={t('model.method')} htmlFor="s-method"><Select id="s-method" value={seasonal.rateMethod} onChange={(e) => setSeasonal({ ...seasonal, rateMethod: e.target.value as 'flat' })}>{RATE_METHODS.map((m) => <option key={m} value={m}>{t(`model.methods.${m}`)}</option>)}</Select></Field>
                  <NumField id="s-tenor" label={t('model.tenor')} value={seasonal.tenorMonths} onChange={(v) => setSeasonal({ ...seasonal, tenorMonths: v })} />
                  <NumField id="s-fee" label={t('model.fee')} value={seasonal.upfrontFeeBps} onChange={(v) => setSeasonal({ ...seasonal, upfrontFeeBps: v })} />
                  <Field label={t('model.profile')} htmlFor="s-profile"><Select id="s-profile" value={seasonal.repaymentProfile} onChange={(e) => setSeasonal({ ...seasonal, repaymentProfile: e.target.value as 'bullet' })}>{REPAYMENT_PROFILES.map((m) => <option key={m} value={m}>{t(`model.profiles.${m}`)}</option>)}</Select></Field>
                  <Field label={t('model.feesTo')} htmlFor="s-feesto"><Select id="s-feesto" value={seasonal.feesChargedTo} onChange={(e) => setSeasonal({ ...seasonal, feesChargedTo: e.target.value as 'operator' })}>{(['operator', 'farmers'] as const).map((m) => <option key={m} value={m}>{t(`model.feesToOptions.${m}`)}</option>)}</Select></Field>
                  <Field label={t('model.borrower')} htmlFor="s-borrower"><Select id="s-borrower" value={seasonal.borrowerType} onChange={(e) => setSeasonal({ ...seasonal, borrowerType: e.target.value as 'farmers' })}>{(['farmers', 'farmer_group', 'operator'] as const).map((m) => <option key={m} value={m}>{t(`model.borrowers.${m}`)}</option>)}</Select></Field>
                </div>
              )}
            </fieldset>
            <fieldset className="space-y-3" disabled={!editable}>
              <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={!!investment} onChange={(e) => setInvestment(e.target.checked ? DEFAULT_INVESTMENT : null)} /> {t('model.investment')}</label>
              {investment && (
                <div className="grid grid-cols-2 gap-3">
                  <NumField id="i-rate" label={t('model.rate')} value={investment.rateBps} onChange={(v) => setInvestment({ ...investment, rateBps: v })} />
                  <Field label={t('model.method')} htmlFor="i-method"><Select id="i-method" value={investment.rateMethod} onChange={(e) => setInvestment({ ...investment, rateMethod: e.target.value as 'flat' })}>{RATE_METHODS.map((m) => <option key={m} value={m}>{t(`model.methods.${m}`)}</option>)}</Select></Field>
                  <NumField id="i-tenor" label={t('model.tenor')} value={investment.tenorMonths} onChange={(v) => setInvestment({ ...investment, tenorMonths: v })} />
                  <NumField id="i-grace" label={t('model.grace')} value={investment.graceMonths} onChange={(v) => setInvestment({ ...investment, graceMonths: v })} />
                  <Field label={t('model.graceType')} htmlFor="i-gt"><Select id="i-gt" value={investment.graceType} onChange={(e) => setInvestment({ ...investment, graceType: e.target.value as 'interest_only' })}>{GRACE_TYPES.map((m) => <option key={m} value={m}>{t(`model.graceTypes.${m}`)}</option>)}</Select></Field>
                  <Field label={t('model.profile')} htmlFor="i-profile"><Select id="i-profile" value={investment.repaymentProfile} onChange={(e) => setInvestment({ ...investment, repaymentProfile: e.target.value as 'annuity' })}>{REPAYMENT_PROFILES.map((m) => <option key={m} value={m}>{t(`model.profiles.${m}`)}</option>)}</Select></Field>
                  <NumField id="i-fee" label={t('model.fee')} value={investment.upfrontFeeBps} onChange={(v) => setInvestment({ ...investment, upfrontFeeBps: v })} />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <NumField id="m-spy" label={t('model.seasonsPerYear')} value={spy} onChange={setSpy} />
                <NumField id="m-disc" label={t('model.discount')} value={disc} onChange={setDisc} />
              </div>
            </fieldset>
          </div>
          {editable && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" loading={busy === 'save'} onClick={() => run('save', async () => { await unwrap(api.PUT('/v1/seasons/{id}/model-assumptions', { params: { path: { id: season.id } }, body: { seasonal, investment, seasonsPerYear: spy, discountRateBps: disc } })); await qc.invalidateQueries({ queryKey: ['assumptions', season.id] }); await refresh(); }, t('common.saved'))}>{t('model.saveAssumptions')}</Button>
              <Button loading={busy === 'run'} onClick={() => run('run', async () => { await unwrap(api.POST('/v1/seasons/{id}/model-runs', { params: { path: { id: season.id } } })); setPreview(null); await refresh(); })}>{current.data ? t('model.rerun') : t('model.run')}</Button>
            </div>
          )}
        </CardBody>
      </Card>

      {!out ? (
        <Alert tone="info">{t('model.none')}</Alert>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {preview ? <Badge tone="amber">{t('model.whatIf')}</Badge> : current.data?.current ? <Badge tone="green" data-testid="model-current">{t('model.current')}</Badge> : <Badge tone="red">{t('model.stale')}</Badge>}
            <span className="text-neutral-500">{t('model.computedAt')} {formatDateTime(runData!.computedAt)}</span>
            <span className="text-neutral-500">{t('model.tranches')} : {formatXof(out.tranches.seasonalAmountXof)} / {formatXof(out.tranches.investmentAmountXof)}</span>
          </div>
          {out.warnings.length > 0 && <Alert tone="warning"><p className="font-medium">{t('model.warnings')}</p>{out.warnings.map((w, i) => <p key={i} className="text-xs">{w.code} — {w.message}</p>)}</Alert>}
          <Card>
            <CardBody className="p-0">
              <Table>
                <thead><tr><Th>{t('model.scenario')}</Th><Th>{t('model.revenue')}</Th><Th>{t('model.debt')}</Th><Th>{t('model.hcr')}</Th><Th>{t('model.breakeven')}</Th><Th>{t('model.minDscr')}</Th><Th>{t('model.npv')}</Th><Th>{t('model.irr')}</Th><Th>{t('model.payback')}</Th></tr></thead>
                <tbody>
                  {SCENARIO_CODES.map((k) => {
                    const b = out.scenarios[k].block;
                    return (
                      <tr key={k}>
                        <Td className="font-medium">{t(`model.scenarios.${k}`)}</Td>
                        <Td>{formatXof(b.grossRevenueXof)}</Td>
                        <Td>{formatXof(b.seasonalDebtDueXof)}</Td>
                        <Td data-testid={`hcr-${k}`} className={b.hcr !== null && b.hcr < 1 ? 'font-semibold text-red-700' : ''}>{b.hcr ?? '—'}</Td>
                        <Td>{b.breakevenYieldMultiplier ?? '—'}</Td>
                        <Td>{b.minDscr ?? '—'}</Td>
                        <Td>{formatXof(b.operatorNpvXof)}</Td>
                        <Td>{b.operatorIrr === null ? '—' : `${(b.operatorIrr * 100).toFixed(1)} %`}</Td>
                        <Td>{b.paybackMonth ?? '—'}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </CardBody>
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>{t('model.revenue')} / {t('model.debt')}</CardTitle></CardHeader>
              <CardBody style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={SCENARIO_CODES.map((k) => ({ name: t(`model.scenarios.${k}`), revenue: out.scenarios[k].block.grossRevenueXof, debt: out.scenarios[k].block.seasonalDebtDueXof }))}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" fontSize={10} />
                    <YAxis fontSize={10} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                    <Tooltip formatter={(v) => formatXof(Number(v))} />
                    <Legend />
                    <Bar dataKey="revenue" name={t('model.revenue')} fill="#23804a" />
                    <Bar dataKey="debt" name={t('model.debt')} fill="#d97706" />
                  </BarChart>
                </ResponsiveContainer>
              </CardBody>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t('model.cashflow')}</CardTitle></CardHeader>
              <CardBody style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={out.scenarios.base.monthlyCashflow.slice(0, 36)}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" fontSize={10} />
                    <YAxis fontSize={10} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                    <Tooltip formatter={(v) => formatXof(Number(v))} />
                    <Legend />
                    <Line dataKey="cumulativeXof" name={t('model.cumulative')} stroke="#23804a" dot={false} />
                    <Line dataKey="netXof" name={t('model.net2')} stroke="#0284c7" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardBody>
            </Card>
          </div>
          <Card>
            <CardHeader><CardTitle>{t('model.whatIf')}</CardTitle></CardHeader>
            <CardBody className="flex flex-wrap items-end gap-4">
              <Field label={`${t('model.yieldShock')} : ${shock.yieldShockPct}`} htmlFor="w-yield"><input id="w-yield" type="range" min={-30} max={60} value={shock.yieldShockPct} onChange={(e) => setShock({ ...shock, yieldShockPct: Number(e.target.value) })} /></Field>
              <Field label={`${t('model.priceShock')} : ${shock.priceShockPct}`} htmlFor="w-price"><input id="w-price" type="range" min={-30} max={60} value={shock.priceShockPct} onChange={(e) => setShock({ ...shock, priceShockPct: Number(e.target.value) })} /></Field>
              <Button variant="secondary" loading={busy === 'sim'} onClick={() => run('sim', async () => setPreview(await unwrap(api.POST('/v1/seasons/{id}/model-runs/preview', { params: { path: { id: season.id } }, body: shock }))))}>{t('model.simulate')}</Button>
              {preview && <Button variant="ghost" onClick={() => setPreview(null)}>{t('common.cancel')}</Button>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t('model.farmers')}</CardTitle></CardHeader>
            <CardBody className="p-0">
              <Table>
                <thead><tr><Th>#</Th><Th>ha</Th><Th>{t('model.revenue')}</Th><Th>{t('model.debt')}</Th><Th>{t('model.fees')}</Th><Th>{t('model.net')}</Th><Th>{t('model.valueCreated')}</Th><Th>{t('model.hcr')}</Th></tr></thead>
                <tbody>
                  {out.scenarios.base.farmers.map((f, i) => (
                    <tr key={f.farmerId}>
                      <Td>{i + 1}</Td>
                      <Td>{f.ha}</Td>
                      <Td>{formatXof(f.grossRevenueXof)}</Td>
                      <Td>{formatXof(f.seasonalDebtDueXof)}</Td>
                      <Td>{formatXof(f.investmentFeeXof + f.landFeeXof + f.operatorServiceFeeXof)}</Td>
                      <Td className={f.netIncomeXof < 0 ? 'text-red-700' : ''}>{formatXof(f.netIncomeXof)}</Td>
                      <Td>{formatXof(f.valueCreatedXof)}</Td>
                      <Td>{f.hcr ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
