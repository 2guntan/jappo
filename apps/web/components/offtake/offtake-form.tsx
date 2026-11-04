'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { PRICE_TYPES } from '@jappo/contracts';
import { useSession } from '@/lib/session';
import { Button, Field, Input, Select } from '@/components/ui';

export interface OfftakeFormValue {
  blockId: string;
  buyerOrgId: string;
  cropId: string;
  seasonId: string | null;
  minVolumeKg: number;
  maxVolumeKg: number;
  priceType: (typeof PRICE_TYPES)[number];
  priceXofPerKg: number;
  floorXofPerKg: number | null;
  paymentTermsDays: number;
  paysIntoEscrow: boolean;
  qualitySpec: { grade: string; adjustmentPct: number }[];
}

export function OfftakeForm({ blockId, onSubmit, busy }: { blockId?: string; onSubmit: (v: OfftakeFormValue) => void; busy?: boolean }) {
  const t = useTranslations();
  const locale = useLocale();
  const { api } = useSession();
  const buyers = useQuery({ queryKey: ['directory', 'buyer'], queryFn: () => unwrap(api.GET('/v1/orgs/directory', { params: { query: { type: 'buyer' } } })) });
  const crops = useQuery({ queryKey: ['crops'], queryFn: () => unwrap(api.GET('/v1/crops')) });
  const blocks = useQuery({ queryKey: ['blocks-min'], enabled: !blockId, queryFn: () => unwrap(api.GET('/v1/blocks', { params: { query: { limit: 200 } } })) });
  const [v, setV] = useState({ blockId: blockId ?? '', buyerOrgId: '', cropId: '', minVolumeKg: '', maxVolumeKg: '', priceType: 'fixed', priceXofPerKg: '', floorXofPerKg: '', paymentTermsDays: '30', paysIntoEscrow: true });
  const [grades, setGrades] = useState([{ grade: 'A', adjustmentPct: '0' }]);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ blockId: v.blockId, buyerOrgId: v.buyerOrgId, cropId: v.cropId, seasonId: null, minVolumeKg: Number(v.minVolumeKg), maxVolumeKg: Number(v.maxVolumeKg), priceType: v.priceType as 'fixed', priceXofPerKg: Number(v.priceXofPerKg), floorXofPerKg: v.floorXofPerKg ? Number(v.floorXofPerKg) : null, paymentTermsDays: Number(v.paymentTermsDays), paysIntoEscrow: v.paysIntoEscrow, qualitySpec: grades.filter((g) => g.grade).map((g) => ({ grade: g.grade, adjustmentPct: Number(g.adjustmentPct) })) });
      }}
    >
      {!blockId && (
        <Field label={t('offtake.block')} htmlFor="o-block"><Select id="o-block" required value={v.blockId} onChange={(e) => setV({ ...v, blockId: e.target.value })}><option value="">—</option>{blocks.data?.data.map((b) => <option key={b.id} value={b.id}>{b.ref} · {b.name}</option>)}</Select></Field>
      )}
      <Field label={t('offtake.buyer')} htmlFor="o-buyer"><Select id="o-buyer" required value={v.buyerOrgId} onChange={(e) => setV({ ...v, buyerOrgId: e.target.value })}><option value="">—</option>{buyers.data?.data.map((b) => <option key={b.id} value={b.id}>{b.legalName}</option>)}</Select></Field>
      <Field label={t('seasons.crop')} htmlFor="o-crop"><Select id="o-crop" required value={v.cropId} onChange={(e) => setV({ ...v, cropId: e.target.value })}><option value="">—</option>{crops.data?.data.map((c) => <option key={c.id} value={c.id}>{locale === 'en' ? c.nameEn : c.nameFr}</option>)}</Select></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('offtake.minVolume')} htmlFor="o-min"><Input id="o-min" type="number" min={0} required value={v.minVolumeKg} onChange={(e) => setV({ ...v, minVolumeKg: e.target.value })} /></Field>
        <Field label={t('offtake.maxVolume')} htmlFor="o-max"><Input id="o-max" type="number" min={0} required value={v.maxVolumeKg} onChange={(e) => setV({ ...v, maxVolumeKg: e.target.value })} /></Field>
        <Field label={t('offtake.priceType')} htmlFor="o-ptype"><Select id="o-ptype" value={v.priceType} onChange={(e) => setV({ ...v, priceType: e.target.value })}>{PRICE_TYPES.map((p) => <option key={p} value={p}>{t(`offtake.priceTypes.${p}`)}</option>)}</Select></Field>
        <Field label={t('offtake.price')} htmlFor="o-price"><Input id="o-price" type="number" min={0} required value={v.priceXofPerKg} onChange={(e) => setV({ ...v, priceXofPerKg: e.target.value })} /></Field>
        {v.priceType === 'floor_plus_market' && <Field label={t('offtake.floor')} htmlFor="o-floor"><Input id="o-floor" type="number" min={0} value={v.floorXofPerKg} onChange={(e) => setV({ ...v, floorXofPerKg: e.target.value })} /></Field>}
        <Field label={t('offtake.paymentTerms')} htmlFor="o-terms"><Input id="o-terms" type="number" min={0} value={v.paymentTermsDays} onChange={(e) => setV({ ...v, paymentTermsDays: e.target.value })} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.paysIntoEscrow} onChange={(e) => setV({ ...v, paysIntoEscrow: e.target.checked })} /> {t('offtake.escrow')}</label>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('offtake.grades')}</legend>
        {grades.map((g, i) => (
          <div key={i} className="flex gap-2">
            <Input aria-label={t('offtake.grade')} value={g.grade} onChange={(e) => setGrades(grades.map((x, j) => (j === i ? { ...x, grade: e.target.value } : x)))} />
            <Input aria-label={t('offtake.adjustment')} type="number" value={g.adjustmentPct} onChange={(e) => setGrades(grades.map((x, j) => (j === i ? { ...x, adjustmentPct: e.target.value } : x)))} />
          </div>
        ))}
        <Button type="button" size="sm" variant="ghost" onClick={() => setGrades([...grades, { grade: '', adjustmentPct: '0' }])}>{t('offtake.addGrade')}</Button>
      </fieldset>
      <Button type="submit" loading={busy}>{t('offtake.create')}</Button>
    </form>
  );
}
