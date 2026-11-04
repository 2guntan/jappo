'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { unwrap, type Schemas } from '@jappo/sdk';
import { BUDGET_PAYERS, BUDGET_SCOPES } from '@jappo/contracts';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import { downloadCsv, formatXof } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, Field, Input, Select, Table, Td, Th } from '@/components/ui';

export function BudgetTab({ season }: { season: Schemas['Season'] }) {
  const t = useTranslations();
  const locale = useLocale();
  const { api } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const editable = season.allowedActions.includes('edit_budget');
  const lines = useQuery({ queryKey: ['budget-lines', season.id], queryFn: () => unwrap(api.GET('/v1/seasons/{id}/budget-lines', { params: { path: { id: season.id } } })) });
  const summary = useQuery({ queryKey: ['budget-summary', season.id], queryFn: () => unwrap(api.GET('/v1/seasons/{id}/budget-summary', { params: { path: { id: season.id } } })) });
  const services = useQuery({ queryKey: ['services'], queryFn: () => unwrap(api.GET('/v1/services')) });
  const plots = useQuery({ queryKey: ['plots', season.blockId], queryFn: () => unwrap(api.GET('/v1/blocks/{id}/plots', { params: { path: { id: season.blockId } } })) });
  const crops = useQuery({ queryKey: ['crops'], queryFn: () => unwrap(api.GET('/v1/crops')) });
  const [l, setL] = useState({ scope: 'block', serviceId: '', qty: '1', unitPriceXof: '', payer: 'farmer_credit', plotId: '', cropId: '' });
  const refresh = () => Promise.all(['budget-lines', 'budget-summary', 'season'].map((k) => qc.invalidateQueries({ queryKey: [k, season.id] })));
  const rows = lines.data?.data ?? [];
  const sum = summary.data;
  const svcName = (s: { nameFr: string; nameEn: string }) => (locale === 'en' ? s.nameEn : s.nameFr);
  const hasTemplateLines = rows.some((r) => r.source === 'template');

  return (
    <div className="space-y-6">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {sum && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(['farmer_credit', 'farmer_cash', 'operator', 'grant'] as const).map((p) => (
            <Card key={p}><CardBody><p className="text-xs text-neutral-500">{t(`seasons.payers.${p}`)}</p><p className="text-lg font-semibold" data-testid={`total-${p}`}>{formatXof(sum.totals[p])}</p></CardBody></Card>
          ))}
          <Card><CardBody><p className="text-xs text-neutral-500">{t('seasons.perHa')}</p><p className="text-lg font-semibold">{formatXof(sum.perHaXof)}</p></CardBody></Card>
          <Card><CardBody><p className="text-xs text-neutral-500">{t('seasons.quoted')}</p><p className="text-lg font-semibold">{sum.quotedSharePct} %</p></CardBody></Card>
          {sum.unallocated.farmerCreditXof > 0 && <Card><CardBody><p className="text-xs text-neutral-500">{t('seasons.unallocated')}</p><p className="text-lg font-semibold text-amber-700">{formatXof(sum.unallocated.farmerCreditXof)}</p></CardBody></Card>}
        </div>
      )}
      {sum?.warnings.map((w, i) => <Alert key={i} tone="warning">{w.message}</Alert>)}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t('seasons.budget')}</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => downloadCsv('budget.csv', rows.map((r) => ({ service: r.serviceName, scope: r.scope, qty: r.qty, unit: r.unit, unitPrice: r.unitPriceXof, total: r.totalXof, payer: r.payer })))}>{t('common.exportCsv')}</Button>
            {editable && <Button size="sm" loading={busy === 'gen'} onClick={() => run('gen', async () => { await unwrap(api.POST('/v1/seasons/{id}/budget-lines/actions/generate-from-templates', { params: { path: { id: season.id } }, body: { replace: hasTemplateLines, payer: 'farmer_credit' } })); await refresh(); })}>{hasTemplateLines ? t('seasons.regenerate') : t('seasons.generate')}</Button>}
          </div>
        </CardHeader>
        <CardBody className="p-0">
          <Table>
            <thead><tr><Th>{t('seasons.service')}</Th><Th>{t('seasons.scope')}</Th><Th>{t('seasons.qty')}</Th><Th>{t('seasons.unitPrice')}</Th><Th>{t('seasons.total')}</Th><Th>{t('seasons.payer')}</Th>{editable && <Th />}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td>{r.serviceName} {r.quoteId && <Badge tone="green">{t('seasons.quote')}</Badge>}</Td>
                  <Td>{t(`seasons.scopes.${r.scope}`)}</Td>
                  <Td>{r.qty} {r.unit}</Td>
                  <Td>{formatXof(r.unitPriceXof)}</Td>
                  <Td className="font-medium">{formatXof(r.totalXof)}</Td>
                  <Td>{t(`seasons.payers.${r.payer}`)}</Td>
                  {editable && <Td><Button size="sm" variant="ghost" onClick={() => run('del', async () => { await unwrap(api.DELETE('/v1/budget-lines/{id}', { params: { path: { id: r.id } } })); await refresh(); })}>{t('seasons.remove')}</Button></Td>}
                </tr>
              ))}
            </tbody>
          </Table>
          {editable && (
            <form className="grid gap-3 border-t border-neutral-100 px-5 py-4 md:grid-cols-6" onSubmit={(e) => { e.preventDefault(); void run('add', async () => { await unwrap(api.POST('/v1/seasons/{id}/budget-lines', { params: { path: { id: season.id } }, body: { scope: l.scope as 'block', serviceId: l.serviceId, qty: Number(l.qty), payer: l.payer as 'farmer_credit', ...(l.unitPriceXof ? { unitPriceXof: Number(l.unitPriceXof) } : {}), ...(l.scope === 'plot' ? { plotId: l.plotId } : {}), ...(l.scope === 'per_ha_crop' ? { cropId: l.cropId } : {}) } })); await refresh(); }); }}>
              <Field label={t('seasons.scope')} htmlFor="bl-scope"><Select id="bl-scope" value={l.scope} onChange={(e) => setL({ ...l, scope: e.target.value })}>{BUDGET_SCOPES.map((s) => <option key={s} value={s}>{t(`seasons.scopes.${s}`)}</option>)}</Select></Field>
              {l.scope === 'plot' && <Field label={t('blocks.code')} htmlFor="bl-plot"><Select id="bl-plot" value={l.plotId} onChange={(e) => setL({ ...l, plotId: e.target.value })}><option value="">—</option>{plots.data?.data.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</Select></Field>}
              {l.scope === 'per_ha_crop' && <Field label={t('seasons.crop')} htmlFor="bl-crop"><Select id="bl-crop" value={l.cropId} onChange={(e) => setL({ ...l, cropId: e.target.value })}><option value="">—</option>{crops.data?.data.map((c) => <option key={c.id} value={c.id}>{locale === 'en' ? c.nameEn : c.nameFr}</option>)}</Select></Field>}
              <Field label={t('seasons.service')} htmlFor="bl-svc"><Select id="bl-svc" required value={l.serviceId} onChange={(e) => setL({ ...l, serviceId: e.target.value })}><option value="">—</option>{services.data?.data.map((s) => <option key={s.id} value={s.id}>{svcName(s)}</option>)}</Select></Field>
              <Field label={t('seasons.qty')} htmlFor="bl-qty"><Input id="bl-qty" type="number" step="0.001" min={0} value={l.qty} onChange={(e) => setL({ ...l, qty: e.target.value })} /></Field>
              <Field label={t('seasons.unitPrice')} htmlFor="bl-price"><Input id="bl-price" type="number" min={0} placeholder="auto" value={l.unitPriceXof} onChange={(e) => setL({ ...l, unitPriceXof: e.target.value })} /></Field>
              <Field label={t('seasons.payer')} htmlFor="bl-payer"><Select id="bl-payer" value={l.payer} onChange={(e) => setL({ ...l, payer: e.target.value })}>{BUDGET_PAYERS.map((p) => <option key={p} value={p}>{t(`seasons.payers.${p}`)}</option>)}</Select></Field>
              <div className="flex items-end"><Button type="submit" disabled={!l.serviceId} loading={busy === 'add'}>{t('seasons.addLine')}</Button></div>
            </form>
          )}
        </CardBody>
      </Card>
      {sum && sum.farmers.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t('seasons.perFarmer')}</CardTitle></CardHeader>
          <CardBody className="p-0">
            <Table>
              <thead><tr><Th>{t('farmers.code')}</Th><Th>{t('common.name')}</Th><Th>{t('seasons.ha')}</Th><Th>{t('seasons.credit')}</Th><Th>{t('seasons.cash')}</Th></tr></thead>
              <tbody>{sum.farmers.map((f) => <tr key={f.farmerId}><Td>{f.farmerCode}</Td><Td>{f.name}</Td><Td>{f.ha.toFixed(4)}</Td><Td className="font-medium" data-testid={`credit-${f.farmerCode}`}>{formatXof(f.farmerCreditXof)}</Td><Td>{formatXof(f.farmerCashXof)}</Td></tr>)}</tbody>
            </Table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
