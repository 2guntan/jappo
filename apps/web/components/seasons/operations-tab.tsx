'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap, type Schemas } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { uploadFile, useAction } from '@/lib/hooks';
import { formatDateTime } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, Field, Input, Select, Table, Td, Textarea, Th } from '@/components/ui';

const STAGES = ['land_prep', 'sowing', 'emergence', 'vegetative', 'flowering', 'fruiting', 'maturity', 'harvested', 'failed'] as const;
const ISSUES = ['pest', 'disease', 'water_stress', 'flood', 'weeds', 'theft', 'livestock_damage', 'labour_shortage', 'input_missing', 'other'] as const;

export function OperationsTab({ season }: { season: Schemas['Season'] }) {
  const t = useTranslations();
  const { api, authedFetch, hasPermission } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const lines = useQuery({ queryKey: ['budget', season.id], queryFn: () => unwrap(api.GET('/v1/seasons/{id}/budget-lines', { params: { path: { id: season.id } } })) });
  const plots = useQuery({ queryKey: ['plots', season.blockId], queryFn: () => unwrap(api.GET('/v1/blocks/{id}/plots', { params: { path: { id: season.blockId } } })) });
  const deliveries = useQuery({ queryKey: ['service-deliveries', season.id], queryFn: () => unwrap(api.GET('/v1/seasons/{id}/service-deliveries', { params: { path: { id: season.id } } })) });
  const [sd, setSd] = useState({ budgetLineId: '', farmerId: '', qty: '1', supplierName: '', ack: 'none' as 'none' | 'signature_photo' | 'otp', ackCode: '' });
  const [photo, setPhoto] = useState<File | null>(null);
  const [vis, setVis] = useState({ plotId: '', cropStage: 'vegetative' as (typeof STAGES)[number], healthScore: '4', estimatedYieldTHa: '', notes: '', issues: [] as string[] });
  const visits = useQuery({ queryKey: ['visits', vis.plotId], enabled: !!vis.plotId, queryFn: () => unwrap(api.GET('/v1/plots/{id}/visits', { params: { path: { id: vis.plotId } } })) });
  const allPlots = plots.data?.data ?? [];
  const line = lines.data?.data.find((l) => l.id === sd.budgetLineId);
  const farmerOptions = allPlots.filter((p) => !line?.plotId || p.id === line.plotId).flatMap((p) => p.farmers);
  const canRecord = hasPermission('service_delivery:record');

  return (
    <div className="space-y-6">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <CardHeader><CardTitle>{t('ops.services')}</CardTitle></CardHeader>
        <CardBody className="p-0">
          <Table>
            <thead><tr><Th>{t('ops.service')}</Th><Th>{t('ops.qty')}</Th><Th>{t('ops.supplier')}</Th><Th>{t('ops.ack')}</Th><Th>{t('ops.deliveredAt')}</Th></tr></thead>
            <tbody>
              {(deliveries.data?.data ?? []).map((d) => (
                <tr key={d.id}><Td>{d.serviceLabel}</Td><Td>{d.qty} {d.unit}</Td><Td>{d.supplierName ?? '—'}</Td><Td><Badge tone={d.farmerAckMethod === 'none' ? 'neutral' : 'green'}>{t(`ops.ackMethods.${d.farmerAckMethod}`)}</Badge></Td><Td>{formatDateTime(d.deliveredAt)}</Td></tr>
              ))}
            </tbody>
          </Table>
          {canRecord && (
            <div className="grid gap-3 border-t border-neutral-100 p-5 sm:grid-cols-3">
              <Field label={t('ops.budgetLine')} htmlFor="sd-line">
                <Select id="sd-line" value={sd.budgetLineId} onChange={(e) => setSd({ ...sd, budgetLineId: e.target.value, farmerId: '' })}>
                  <option value="">—</option>
                  {(lines.data?.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.serviceName} · {l.qty} {l.unit}{l.plotId ? ` · ${allPlots.find((p) => p.id === l.plotId)?.code ?? ''}` : ''}</option>)}
                </Select>
              </Field>
              <Field label={t('ops.farmer')} htmlFor="sd-farmer">
                <Select id="sd-farmer" value={sd.farmerId} onChange={(e) => setSd({ ...sd, farmerId: e.target.value })}>
                  <option value="">—</option>
                  {farmerOptions.map((f) => <option key={f.farmerId} value={f.farmerId}>{f.name}</option>)}
                </Select>
              </Field>
              <Field label={t('ops.qty')} htmlFor="sd-qty"><Input id="sd-qty" inputMode="decimal" value={sd.qty} onChange={(e) => setSd({ ...sd, qty: e.target.value })} /></Field>
              <Field label={t('ops.supplier')} htmlFor="sd-sup"><Input id="sd-sup" value={sd.supplierName} onChange={(e) => setSd({ ...sd, supplierName: e.target.value })} /></Field>
              <Field label={t('ops.ack')} htmlFor="sd-ack">
                <Select id="sd-ack" value={sd.ack} onChange={(e) => setSd({ ...sd, ack: e.target.value as typeof sd.ack })}>
                  {(['none', 'signature_photo', 'otp'] as const).map((a) => <option key={a} value={a}>{t(`ops.ackMethods.${a}`)}</option>)}
                </Select>
              </Field>
              {sd.ack === 'signature_photo' && <Field label={t('ops.photo')} htmlFor="sd-photo"><Input id="sd-photo" type="file" accept="image/*" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} /></Field>}
              {sd.ack === 'otp' && (
                <Field label={t('ops.ackCode')} htmlFor="sd-code">
                  <div className="flex gap-2">
                    <Input id="sd-code" inputMode="numeric" maxLength={6} value={sd.ackCode} onChange={(e) => setSd({ ...sd, ackCode: e.target.value.replace(/\D/g, '') })} />
                    <Button type="button" size="sm" variant="secondary" disabled={!sd.farmerId} loading={busy === 'code'} onClick={() => run('code', () => unwrap(api.POST('/v1/farmers/{id}/actions/request-ack-code', { params: { path: { id: sd.farmerId } } })), t('ops.codeSent'))}>{t('ops.sendCode')}</Button>
                  </div>
                </Field>
              )}
              <div className="flex items-end">
                <Button
                  disabled={!sd.budgetLineId || !Number(sd.qty)}
                  loading={busy === 'sd'}
                  onClick={() => run('sd', async () => {
                    const photoFileId = sd.ack === 'signature_photo' && photo ? await uploadFile(authedFetch, photo) : null;
                    await unwrap(api.POST('/v1/seasons/{id}/service-deliveries', { params: { path: { id: season.id } }, body: { budgetLineId: sd.budgetLineId, farmerId: sd.farmerId || null, qty: Number(sd.qty), supplierName: sd.supplierName || null, farmerAckMethod: sd.ack, ackCode: sd.ack === 'otp' ? sd.ackCode : undefined, photoFileId } }));
                    setSd({ ...sd, ackCode: '' });
                    await qc.invalidateQueries({ queryKey: ['service-deliveries', season.id] });
                  }, t('common.saved'))}
                >
                  {t('ops.recordDelivery')}
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('ops.visits')}</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('ops.plot')} htmlFor="v-plot">
              <Select id="v-plot" value={vis.plotId} onChange={(e) => setVis({ ...vis, plotId: e.target.value })}>
                <option value="">—</option>
                {allPlots.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
              </Select>
            </Field>
            {hasPermission('visit:record') && (
              <>
                <Field label={t('ops.stage')} htmlFor="v-stage">
                  <Select id="v-stage" value={vis.cropStage} onChange={(e) => setVis({ ...vis, cropStage: e.target.value as typeof vis.cropStage })}>
                    {STAGES.map((s) => <option key={s} value={s}>{t(`ops.stages.${s}`)}</option>)}
                  </Select>
                </Field>
                <Field label={t('ops.health')} htmlFor="v-health">
                  <Select id="v-health" value={vis.healthScore} onChange={(e) => setVis({ ...vis, healthScore: e.target.value })}>
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </Select>
                </Field>
                <Field label={t('ops.estimate')} htmlFor="v-est"><Input id="v-est" inputMode="decimal" value={vis.estimatedYieldTHa} onChange={(e) => setVis({ ...vis, estimatedYieldTHa: e.target.value })} /></Field>
                <fieldset className="sm:col-span-2">
                  <legend className="mb-1 text-sm font-medium">{t('ops.issues')}</legend>
                  <div className="flex flex-wrap gap-3 text-sm">
                    {ISSUES.map((i) => (
                      <label key={i} className="flex items-center gap-1">
                        <input type="checkbox" checked={vis.issues.includes(i)} onChange={(e) => setVis({ ...vis, issues: e.target.checked ? [...vis.issues, i] : vis.issues.filter((x) => x !== i) })} />
                        {t(`ops.issueTypes.${i}`)}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <Field label={t('ops.notes')} htmlFor="v-notes"><Textarea id="v-notes" rows={2} value={vis.notes} onChange={(e) => setVis({ ...vis, notes: e.target.value })} /></Field>
                <div className="flex items-end">
                  <Button
                    disabled={!vis.plotId}
                    loading={busy === 'visit'}
                    onClick={() => run('visit', async () => {
                      await unwrap(api.POST('/v1/plots/{id}/visits', { params: { path: { id: vis.plotId } }, body: { cropStage: vis.cropStage, healthScore: Number(vis.healthScore), estimatedYieldTHa: vis.estimatedYieldTHa ? Number(vis.estimatedYieldTHa) : null, notes: vis.notes || null, issues: vis.issues as never } }));
                      await qc.invalidateQueries({ queryKey: ['visits', vis.plotId] });
                      await qc.invalidateQueries({ queryKey: ['alerts', season.blockId] });
                    }, t('common.saved'))}
                  >
                    {t('ops.recordVisit')}
                  </Button>
                </div>
              </>
            )}
          </div>
          {vis.plotId && (
            <Table>
              <thead><tr><Th>{t('ops.visitedAt')}</Th><Th>{t('ops.stage')}</Th><Th>{t('ops.health')}</Th><Th>{t('ops.estimate')}</Th><Th>{t('ops.issues')}</Th></tr></thead>
              <tbody>
                {(visits.data?.data ?? []).map((v) => (
                  <tr key={v.id}><Td>{formatDateTime(v.visitedAt)}</Td><Td>{t(`ops.stages.${v.cropStage}`)}</Td><Td><Badge tone={v.healthScore <= 1 ? 'red' : v.healthScore <= 2 ? 'amber' : 'green'}>{v.healthScore}/5</Badge></Td><Td>{v.estimatedYieldTHa ?? '—'}</Td><Td className="text-xs">{v.issues.map((i) => t(`ops.issueTypes.${i}`)).join(', ')}</Td></tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
