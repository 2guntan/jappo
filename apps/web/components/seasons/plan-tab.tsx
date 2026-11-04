'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { unwrap, type Schemas } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { ifMatch, useAction } from '@/lib/hooks';
import { formatXof } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Field, Input, Select, Table, Td, Th } from '@/components/ui';

export function PlanTab({ season }: { season: Schemas['Season'] }) {
  const t = useTranslations();
  const locale = useLocale();
  const { api } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const editable = season.allowedActions.includes('edit_plan');
  const plantings = useQuery({ queryKey: ['plantings', season.id], queryFn: () => unwrap(api.GET('/v1/seasons/{id}/plantings', { params: { path: { id: season.id } } })) });
  const plots = useQuery({ queryKey: ['plots', season.blockId], queryFn: () => unwrap(api.GET('/v1/blocks/{id}/plots', { params: { path: { id: season.blockId } } })) });
  const crops = useQuery({ queryKey: ['crops'], queryFn: () => unwrap(api.GET('/v1/crops')) });
  const rows = plantings.data?.data ?? [];
  const planted = useMemo(() => new Set(rows.map((p) => p.plotId)), [rows]);
  const free = (plots.data?.data ?? []).filter((p) => !planted.has(p.id) && p.status !== 'excluded');
  const [cropId, setCropId] = useState('');
  const [selected, setSelected] = useState<string[] | null>(null);
  const [harvest, setHarvest] = useState('');
  const [edits, setEdits] = useState<Record<string, Partial<Record<'yieldBaseTHa' | 'priceXofPerKgBase', string>>>>({});
  const cropName = (id: string) => crops.data?.data.find((c) => c.id === id)?.[locale === 'en' ? 'nameEn' : 'nameFr'] ?? '';
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['plantings', season.id] }), qc.invalidateQueries({ queryKey: ['season', season.id] })]);
  const chosen = selected ?? free.map((p) => p.id);

  return (
    <div className="space-y-6">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {!editable && <Alert tone="info">{t('seasons.locked')}</Alert>}
      {editable && free.length > 0 && (
        <Card>
          <CardHeader><CardTitle>{t('seasons.bulkAssign')}</CardTitle></CardHeader>
          <CardBody>
            <form className="grid gap-3 md:grid-cols-4" onSubmit={(e) => { e.preventDefault(); void run('bulk', async () => { await unwrap(api.POST('/v1/seasons/{id}/plantings/actions/bulk-assign', { params: { path: { id: season.id } }, body: { cropId, plotIds: chosen, plannedHarvestDate: harvest || null } })); setSelected(null); await refresh(); }); }}>
              <Field label={t('seasons.crop')} htmlFor="ba-crop"><Select id="ba-crop" required value={cropId} onChange={(e) => setCropId(e.target.value)}><option value="">—</option>{crops.data?.data.map((c) => <option key={c.id} value={c.id}>{locale === 'en' ? c.nameEn : c.nameFr}</option>)}</Select></Field>
              <Field label={t('seasons.harvestDate')} htmlFor="ba-harvest"><Input id="ba-harvest" type="date" value={harvest} onChange={(e) => setHarvest(e.target.value)} /></Field>
              <div className="md:col-span-2">
                <p className="text-sm font-medium">{t('seasons.selectPlots')} ({chosen.length}/{free.length})</p>
                <div className="mt-1 flex max-h-28 flex-wrap gap-2 overflow-y-auto text-xs">
                  {free.map((p) => (
                    <label key={p.id} className="flex items-center gap-1 rounded border border-neutral-200 px-2 py-1">
                      <input type="checkbox" checked={chosen.includes(p.id)} onChange={(e) => setSelected(e.target.checked ? [...chosen, p.id] : chosen.filter((x) => x !== p.id))} />
                      {p.code}
                    </label>
                  ))}
                </div>
              </div>
              <div><Button type="submit" disabled={!cropId || chosen.length === 0} loading={busy === 'bulk'}>{t('seasons.assign')}</Button></div>
            </form>
          </CardBody>
        </Card>
      )}
      {rows.length === 0 ? (
        <EmptyState title={t('seasons.plantings')} description={t('seasons.noPlantings')} />
      ) : (
        <Card>
          <CardBody className="p-0">
            <Table>
              <thead><tr><Th>{t('blocks.code')}</Th><Th>{t('seasons.crop')}</Th><Th>{t('blocks.area')}</Th><Th>{t('seasons.yieldBase')}</Th><Th>{t('seasons.yieldStress')}</Th><Th>{t('seasons.loss')}</Th><Th>{t('seasons.priceBase')}</Th><Th>{t('seasons.priceStress')}</Th><Th>{t('seasons.priceSource')}</Th>{editable && <Th />}</tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <Td className="font-medium">{p.plotCode}</Td>
                    <Td>{cropName(p.cropId)}</Td>
                    <Td>{p.areaHa.toFixed(4)}</Td>
                    <Td>{editable ? <Input className="h-8 w-20" type="number" step="0.001" aria-label={`${t('seasons.yieldBase')} ${p.plotCode}`} value={edits[p.id]?.yieldBaseTHa ?? String(p.yieldBaseTHa ?? '')} onChange={(e) => setEdits({ ...edits, [p.id]: { ...edits[p.id], yieldBaseTHa: e.target.value } })} /> : p.yieldBaseTHa}</Td>
                    <Td>{p.yieldStressTHa ?? '—'}</Td>
                    <Td>{p.postHarvestLossPct ?? '—'}</Td>
                    <Td>{editable ? <Input className="h-8 w-24" type="number" aria-label={`${t('seasons.priceBase')} ${p.plotCode}`} value={edits[p.id]?.priceXofPerKgBase ?? String(p.priceXofPerKgBase ?? '')} onChange={(e) => setEdits({ ...edits, [p.id]: { ...edits[p.id], priceXofPerKgBase: e.target.value } })} /> : formatXof(p.priceXofPerKgBase)}</Td>
                    <Td>{formatXof(p.priceXofPerKgStress)}</Td>
                    <Td><Badge tone={p.priceSource === 'none' ? 'red' : 'neutral'}>{t(`seasons.priceSources.${p.priceSource}`)}</Badge></Td>
                    {editable && (
                      <Td className="whitespace-nowrap">
                        {edits[p.id] && <Button size="sm" onClick={() => run('e', async () => { const e = edits[p.id]!; await unwrap(api.PATCH('/v1/plantings/{id}', { params: { path: { id: p.id } }, headers: ifMatch(p.version), body: { ...(e.yieldBaseTHa !== undefined ? { yieldBaseTHa: e.yieldBaseTHa === '' ? null : Number(e.yieldBaseTHa) } : {}), ...(e.priceXofPerKgBase !== undefined ? { priceXofPerKgBase: e.priceXofPerKgBase === '' ? null : Number(e.priceXofPerKgBase) } : {}) } })); setEdits(Object.fromEntries(Object.entries(edits).filter(([k]) => k !== p.id))); await refresh(); })}>{t('common.save')}</Button>}
                        <Button size="sm" variant="ghost" onClick={() => run('d', async () => { await unwrap(api.DELETE('/v1/plantings/{id}', { params: { path: { id: p.id } } })); await refresh(); })}>{t('seasons.remove')}</Button>
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
