'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import { downloadCsv, statusTone } from '@/lib/utils';
import { BlockMap } from '@/components/map';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Field, Input, Select, Table, Td, Th } from '@/components/ui';
import type { BlockT } from './types';

export function PlotsTab({ block }: { block: BlockT }) {
  const t = useTranslations();
  const { api } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const [count, setCount] = useState('');
  const [target, setTarget] = useState('');
  const [drawing, setDrawing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [allocFarmer, setAllocFarmer] = useState('');
  const [allocShare, setAllocShare] = useState('100');
  const plots = useQuery({ queryKey: ['plots', block.id], queryFn: () => unwrap(api.GET('/v1/blocks/{id}/plots', { params: { path: { id: block.id } } })) });
  const map = useQuery({ queryKey: ['block-map', block.id], queryFn: () => unwrap(api.GET('/v1/blocks/{id}/map', { params: { path: { id: block.id } } })) });
  const farmers = useQuery({ queryKey: ['farmers-all'], queryFn: () => unwrap(api.GET('/v1/farmers', { params: { query: { limit: 200 } } })) });
  const refresh = () => Promise.all(['plots', 'block-map', 'block'].map((k) => qc.invalidateQueries({ queryKey: [k, block.id] })));
  const rows = plots.data?.data ?? [];
  const sel = rows.find((p) => p.id === selected);
  const canCreate = block.allowedActions.includes('add_plot');

  return (
    <div className="space-y-6">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-2">
          {drawing && <p className="text-sm text-brand-700">{t('blocks.drawHint')}</p>}
          <BlockMap
            features={(map.data?.features ?? []) as never}
            drawMode={drawing}
            onSelect={setSelected}
            onDrawn={(g) =>
              void run('draw', async () => {
                await unwrap(api.POST('/v1/blocks/{id}/plots', { params: { path: { id: block.id } }, body: { geometry: g as never } }));
                setDrawing(false);
                await refresh();
              })
            }
          />
        </div>
        <div className="space-y-4">
          {canCreate && rows.length === 0 && (
            <Card>
              <CardHeader><CardTitle>{t('blocks.autoGrid')}</CardTitle></CardHeader>
              <CardBody>
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run('grid', async () => {
                      await unwrap(api.POST('/v1/blocks/{id}/plots/actions/auto-grid', { params: { path: { id: block.id } }, body: count ? { count: Number(count), codePrefix: 'P-' } : { targetAreaHa: Number(target), codePrefix: 'P-' } }));
                      await refresh();
                    });
                  }}
                >
                  <p className="text-xs text-neutral-600">{t('blocks.autoGridHelp')}</p>
                  <Field label={t('blocks.plotCount')} htmlFor="grid-count"><Input id="grid-count" type="number" min={1} value={count} onChange={(e) => setCount(e.target.value)} /></Field>
                  <Field label={t('blocks.targetArea')} htmlFor="grid-target"><Input id="grid-target" type="number" step="0.01" min={0.01} value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
                  <Button type="submit" disabled={!count && !target} loading={busy === 'grid'}>{t('blocks.generate')}</Button>
                </form>
              </CardBody>
            </Card>
          )}
          {canCreate && <Button variant={drawing ? 'danger' : 'secondary'} onClick={() => setDrawing(!drawing)}>{drawing ? t('blocks.cancelDraw') : t('blocks.drawPlot')}</Button>}
          {sel && (
            <Card data-testid="plot-panel">
              <CardHeader><CardTitle>{sel.code} · {sel.areaHa.toFixed(4)} ha</CardTitle></CardHeader>
              <CardBody className="space-y-3 text-sm">
                <Badge tone={statusTone(sel.status)}>{t(`plotStatus.${sel.status}`)}</Badge>
                <ul className="space-y-1">
                  {sel.farmers.map((f) => (
                    <li key={f.allocationId} className="flex items-center justify-between gap-2">
                      <span>{f.name} · {f.sharePct} %</span>
                      <Button size="sm" variant="ghost" onClick={() => run('end', async () => { await unwrap(api.POST('/v1/allocations/{id}/actions/end', { params: { path: { id: f.allocationId } }, body: {} })); await refresh(); })}>{t('blocks.endAllocation')}</Button>
                    </li>
                  ))}
                </ul>
                {sel.allocatedPct < 100 && sel.status !== 'excluded' && (
                  <form
                    className="space-y-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run('alloc', async () => {
                        await unwrap(api.POST('/v1/plots/{id}/allocations', { params: { path: { id: sel.id } }, body: { farmerId: allocFarmer, sharePct: Number(allocShare) } }));
                        setAllocFarmer('');
                        await refresh();
                      });
                    }}
                  >
                    <Field label={t('blocks.selectFarmer')} htmlFor="alloc-farmer">
                      <Select id="alloc-farmer" value={allocFarmer} onChange={(e) => setAllocFarmer(e.target.value)}>
                        <option value="">—</option>
                        {farmers.data?.data.map((f) => <option key={f.id} value={f.id}>{f.code} · {f.firstName} {f.lastName}</option>)}
                      </Select>
                    </Field>
                    <Field label={t('blocks.share')} htmlFor="alloc-share"><Input id="alloc-share" type="number" min={1} max={100} value={allocShare} onChange={(e) => setAllocShare(e.target.value)} /></Field>
                    <Button type="submit" size="sm" disabled={!allocFarmer} loading={busy === 'alloc'}>{t('blocks.allocate')}</Button>
                  </form>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState title={t('blocks.plots')} description={t('blocks.noPlots')} />
      ) : (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>{t('blocks.plots')} ({rows.length})</CardTitle>
            <Button size="sm" variant="secondary" onClick={() => downloadCsv(`${block.ref}-plots.csv`, rows.map((p) => ({ code: p.code, areaHa: p.areaHa, status: p.status, farmers: p.farmers.map((f) => `${f.name} (${f.sharePct}%)`).join('; ') })))}>{t('common.exportCsv')}</Button>
          </CardHeader>
          <CardBody className="p-0">
            <Table>
              <thead><tr><Th>{t('blocks.code')}</Th><Th>{t('blocks.area')}</Th><Th>{t('common.status')}</Th><Th>{t('blocks.allocation')}</Th><Th /></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className={selected === p.id ? 'bg-brand-50' : ''}>
                    <Td className="font-medium">{p.code}</Td>
                    <Td>{p.areaHa.toFixed(4)} ha</Td>
                    <Td><Badge tone={statusTone(p.status)}>{t(`plotStatus.${p.status}`)}</Badge></Td>
                    <Td>{p.farmers.map((f) => `${f.name} (${f.sharePct} %)`).join(', ') || '—'}</Td>
                    <Td><Button size="sm" variant="ghost" onClick={() => setSelected(p.id)} aria-label={`${t('blocks.allocate')} ${p.code}`}>{t('blocks.allocate')}</Button></Td>
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
