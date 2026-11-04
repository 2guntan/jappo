'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { fieldDb, kvGet, newClientId, type LocalAllocation, type LocalFarmer, type LocalPlot } from '@/lib/field-db';
import { Alert, Button, Field, Input, Select } from '@/components/ui';

export interface OpsData {
  seasons: { id: string; blockId: string; name: string; status: string }[];
  plantings: { id: string; seasonId: string; plotId: string; cropId: string; cropName: string }[];
  grades: { blockId: string; cropId: string; grades: string[] }[];
}
const STAGES = ['land_prep', 'sowing', 'emergence', 'vegetative', 'flowering', 'fruiting', 'maturity', 'harvested', 'failed'] as const;

function useOpsData() {
  const [d, setD] = useState<OpsData | null>(null);
  useEffect(() => {
    void kvGet<OpsData>('ops').then((v) => setD(v ?? { seasons: [], plantings: [], grades: [] }));
  }, []);
  return d;
}

const gps = () =>
  new Promise<[number, number] | null>((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition((p) => resolve([p.coords.longitude, p.coords.latitude]), () => resolve(null), { timeout: 5000 });
  });

/** Offline field visit (queued `visit.create`). */
export function VisitScreen({ plots, onDone }: { plots: LocalPlot[]; onDone: (msg: string) => void }) {
  const t = useTranslations();
  const [v, setV] = useState({ plotId: '', cropStage: 'vegetative', healthScore: '4', estimatedYieldTHa: '', notes: '' });
  return (
    <div className="space-y-3">
      <Field label={t('ops.plot')} htmlFor="fv-plot"><Select id="fv-plot" value={v.plotId} onChange={(e) => setV({ ...v, plotId: e.target.value })}><option value="">—</option>{plots.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</Select></Field>
      <Field label={t('ops.stage')} htmlFor="fv-stage"><Select id="fv-stage" value={v.cropStage} onChange={(e) => setV({ ...v, cropStage: e.target.value })}>{STAGES.map((s) => <option key={s} value={s}>{t(`ops.stages.${s}`)}</option>)}</Select></Field>
      <Field label={t('ops.health')} htmlFor="fv-health"><Select id="fv-health" value={v.healthScore} onChange={(e) => setV({ ...v, healthScore: e.target.value })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
      <Field label={t('ops.estimate')} htmlFor="fv-est"><Input id="fv-est" inputMode="decimal" value={v.estimatedYieldTHa} onChange={(e) => setV({ ...v, estimatedYieldTHa: e.target.value })} /></Field>
      <Field label={t('ops.notes')} htmlFor="fv-notes"><Input id="fv-notes" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      <Button
        className="w-full"
        disabled={!v.plotId}
        onClick={async () => {
          const g = await gps();
          const plot = plots.find((p) => p.id === v.plotId)!;
          await fieldDb().queue.put({ clientId: newClientId('visit'), type: 'visit.create', payload: { plotId: v.plotId, cropStage: v.cropStage, healthScore: Number(v.healthScore), estimatedYieldTHa: v.estimatedYieldTHa ? Number(v.estimatedYieldTHa) : null, notes: v.notes || null, visitedAt: new Date().toISOString(), geo: g ? { type: 'Point', coordinates: g } : null }, createdAt: new Date().toISOString(), status: 'pending', label: `${t('ops.visit')} ${plot.code}` });
          onDone(t('field.saved'));
        }}
      >
        {t('ops.recordVisit')}
      </Button>
    </div>
  );
}

/** Offline harvest weighing (queued `harvestDelivery.create`); the ticket number is assigned at sync. */
export function WeighScreen({ plots, farmers, allocations, onDone }: { plots: LocalPlot[]; farmers: LocalFarmer[]; allocations: LocalAllocation[]; onDone: (msg: string) => void }) {
  const t = useTranslations();
  const ops = useOpsData();
  const [w, setW] = useState({ plotId: '', farmerKey: '', grossKg: '', tareKg: '0', grade: '' });
  const [err, setErr] = useState<string | null>(null);
  const plot = plots.find((p) => p.id === w.plotId);
  const season = ops?.seasons.find((s) => s.blockId === plot?.blockId && ['in_progress', 'harvest'].includes(s.status));
  const planting = ops?.plantings.find((p) => p.plotId === w.plotId && p.seasonId === season?.id);
  const grades = ops?.grades.filter((g) => g.blockId === plot?.blockId && g.cropId === planting?.cropId).flatMap((g) => g.grades) ?? [];
  const plotFarmers = allocations.filter((a) => a.plotId === w.plotId && a.status === 'active').map((a) => farmers.find((f) => f.key === a.farmerKey)).filter((f): f is LocalFarmer => Boolean(f?.id));
  const net = Number(w.grossKg || 0) - Number(w.tareKg || 0);
  return (
    <div className="space-y-3">
      {err && <Alert tone="error">{err}</Alert>}
      <Field label={t('ops.plot')} htmlFor="fw-plot"><Select id="fw-plot" value={w.plotId} onChange={(e) => setW({ ...w, plotId: e.target.value, farmerKey: '' })}><option value="">—</option>{plots.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</Select></Field>
      {plot && !season && <Alert tone="info">{t('harvest.noActiveSeason')}</Alert>}
      <Field label={t('ops.farmer')} htmlFor="fw-farmer"><Select id="fw-farmer" value={w.farmerKey} onChange={(e) => setW({ ...w, farmerKey: e.target.value })}><option value="">—</option>{plotFarmers.map((f) => <option key={f.key} value={f.key}>{f.firstName} {f.lastName} · {f.code}</option>)}</Select></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('harvest.gross')} htmlFor="fw-gross"><Input id="fw-gross" inputMode="decimal" value={w.grossKg} onChange={(e) => setW({ ...w, grossKg: e.target.value })} /></Field>
        <Field label={t('harvest.tare')} htmlFor="fw-tare"><Input id="fw-tare" inputMode="decimal" value={w.tareKg} onChange={(e) => setW({ ...w, tareKg: e.target.value })} /></Field>
      </div>
      <Field label={t('harvest.grade')} htmlFor="fw-grade">
        {grades.length ? <Select id="fw-grade" value={w.grade} onChange={(e) => setW({ ...w, grade: e.target.value })}><option value="">—</option>{grades.map((g) => <option key={g} value={g}>{g}</option>)}</Select> : <Input id="fw-grade" value={w.grade} onChange={(e) => setW({ ...w, grade: e.target.value })} />}
      </Field>
      <p className="text-sm">{t('harvest.net')} : <strong>{net > 0 ? net : 0} kg</strong></p>
      <Button
        className="w-full"
        disabled={!season || !w.farmerKey || net <= 0 || !w.grade}
        onClick={async () => {
          setErr(null);
          const f = farmers.find((x) => x.key === w.farmerKey)!;
          await fieldDb().queue.put({ clientId: newClientId('harvest'), type: 'harvestDelivery.create', payload: { seasonId: season!.id, plotId: w.plotId, farmerId: f.id, grossKg: Number(w.grossKg), tareKg: Number(w.tareKg || 0), grade: w.grade, deliveredAt: new Date().toISOString() }, createdAt: new Date().toISOString(), status: 'pending', label: `${t('harvest.ticket')} ${plot!.code} · ${f.code} · ${net} kg` });
          setW({ ...w, grossKg: '' });
          onDone(t('field.saved'));
        }}
      >
        {t('harvest.weigh')}
      </Button>
    </div>
  );
}
