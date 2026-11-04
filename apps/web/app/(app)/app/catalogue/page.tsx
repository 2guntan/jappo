'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { unwrap, type Schemas } from '@jappo/sdk';
import { SERVICE_KINDS, SERVICE_UNITS } from '@jappo/contracts';
import { useSession } from '@/lib/session';
import { ifMatch, useAction } from '@/lib/hooks';
import { formatXof } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, Field, Input, PageHeader, Select, Table, Td, Th } from '@/components/ui';

export default function CataloguePage() {
  const t = useTranslations();
  const locale = useLocale();
  const { api, hasPermission } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const [zone, setZone] = useState('casamance');
  const [irrigated, setIrrigated] = useState('true');
  const crops = useQuery({ queryKey: ['crops'], queryFn: () => unwrap(api.GET('/v1/crops')) });
  const zones = useQuery({ queryKey: ['zones'], queryFn: () => unwrap(api.GET('/v1/zones')) });
  const templates = useQuery({ queryKey: ['templates', zone, irrigated], queryFn: () => unwrap(api.GET('/v1/crop-templates', { params: { query: { zone, irrigated: irrigated as 'true' } } })) });
  const services = useQuery({ queryKey: ['services'], queryFn: () => unwrap(api.GET('/v1/services')) });
  const [edit, setEdit] = useState<Record<string, { yieldBaseTHa: string; yieldStressTHa: string; postHarvestLossPct: string }>>({});
  const [svc, setSvc] = useState({ code: '', nameFr: '', nameEn: '', kind: 'other', unit: 'unit', defaultUnitPriceXof: '' });
  const cropName = (id: string) => { const c = crops.data?.data.find((x) => x.id === id); return c ? (locale === 'en' ? c.nameEn : c.nameFr) : ''; };
  const svcName = (id: string) => { const s = services.data?.data.find((x) => x.id === id); return s ? (locale === 'en' ? s.nameEn : s.nameFr) : id; };
  const saveTemplate = (tp: Schemas['CropTemplate']) =>
    run(tp.id, async () => {
      const e = edit[tp.id]!;
      const vals = { yieldBaseTHa: Number(e.yieldBaseTHa), yieldStressTHa: Number(e.yieldStressTHa), postHarvestLossPct: Number(e.postHarvestLossPct) };
      if (tp.isOverride || hasPermission('admin:catalogue')) await unwrap(api.PATCH('/v1/crop-templates/{id}', { params: { path: { id: tp.id } }, headers: ifMatch(tp.version), body: vals }));
      else await unwrap(api.POST('/v1/crop-templates', { body: { cropId: tp.cropId, zone: tp.zone, irrigated: tp.irrigated, cycleDays: tp.cycleDays, deliveryRatePct: tp.deliveryRatePct, inputs: tp.inputs, ...vals } }));
      setEdit({});
      await qc.invalidateQueries({ queryKey: ['templates'] });
    }, t('common.saved'));
  return (
    <>
      <PageHeader title={t('catalogue.title')} />
      {msg && <Alert tone={msg.tone} className="mb-4">{msg.text}</Alert>}
      <Card className="mb-6">
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{t('catalogue.templates')}</CardTitle>
          <div className="flex gap-2">
            <Select aria-label={t('catalogue.zone')} value={zone} onChange={(e) => setZone(e.target.value)}>{zones.data?.data.map((z) => <option key={z.code} value={z.code}>{z.name}</option>)}</Select>
            <Select aria-label={t('catalogue.irrigated')} value={irrigated} onChange={(e) => setIrrigated(e.target.value)}><option value="true">{t('catalogue.irrigated')}</option><option value="false">{t('catalogue.rainfed')}</option></Select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          <Table>
            <thead><tr><Th>{t('seasons.crop')}</Th><Th>{t('catalogue.cycle')}</Th><Th>{t('seasons.yieldBase')}</Th><Th>{t('seasons.yieldStress')}</Th><Th>{t('seasons.loss')}</Th><Th>{t('catalogue.inputs')}</Th><Th /></tr></thead>
            <tbody>
              {templates.data?.data.map((tp) => {
                const e = edit[tp.id];
                const canEdit = hasPermission('crop_template:manage');
                return (
                  <tr key={tp.id}>
                    <Td className="font-medium">{cropName(tp.cropId)} {tp.isOverride ? <Badge tone="blue">{t('catalogue.overridden')}</Badge> : <Badge>{t('catalogue.platform')}</Badge>}</Td>
                    <Td>{tp.cycleDays}</Td>
                    {(['yieldBaseTHa', 'yieldStressTHa', 'postHarvestLossPct'] as const).map((k) => (
                      <Td key={k}>{e ? <Input className="h-8 w-20" type="number" step="0.001" aria-label={k} value={e[k]} onChange={(ev) => setEdit({ [tp.id]: { ...e, [k]: ev.target.value } })} /> : tp[k]}</Td>
                    ))}
                    <Td className="max-w-xs text-xs text-neutral-600">{tp.inputs.map((i) => `${svcName(i.serviceId)} ${i.qtyPerHa} ${i.unit}`).join(' · ')}</Td>
                    <Td className="whitespace-nowrap">
                      {canEdit && !e && <Button size="sm" variant="ghost" onClick={() => setEdit({ [tp.id]: { yieldBaseTHa: String(tp.yieldBaseTHa), yieldStressTHa: String(tp.yieldStressTHa), postHarvestLossPct: String(tp.postHarvestLossPct) } })}>{t('catalogue.override')}</Button>}
                      {e && <Button size="sm" loading={busy === tp.id} onClick={() => saveTemplate(tp)}>{t('common.save')}</Button>}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </CardBody>
      </Card>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>{t('catalogue.services')}</CardTitle></CardHeader>
          <CardBody className="p-0">
            <Table>
              <thead><tr><Th>{t('catalogue.code')}</Th><Th>{t('common.name')}</Th><Th>{t('catalogue.kind')}</Th><Th>{t('catalogue.unit')}</Th><Th>{t('catalogue.defaultPrice')}</Th></tr></thead>
              <tbody>{services.data?.data.map((s) => <tr key={s.id}><Td><code className="text-xs">{s.code}</code></Td><Td>{locale === 'en' ? s.nameEn : s.nameFr} {s.ownerOrgId && <Badge tone="blue">{t('catalogue.overridden')}</Badge>}</Td><Td className="text-xs">{s.kind}</Td><Td>{s.unit}</Td><Td>{formatXof(s.defaultUnitPriceXof)}</Td></tr>)}</tbody>
            </Table>
          </CardBody>
        </Card>
        {hasPermission('service:manage') && (
          <Card>
            <CardHeader><CardTitle>{t('catalogue.newService')}</CardTitle></CardHeader>
            <CardBody>
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run('svc', async () => { await unwrap(api.POST('/v1/services', { body: { ...svc, kind: svc.kind as 'other', unit: svc.unit as 'unit', defaultUnitPriceXof: Number(svc.defaultUnitPriceXof) } })); setSvc({ ...svc, code: '', nameFr: '', nameEn: '', defaultUnitPriceXof: '' }); await qc.invalidateQueries({ queryKey: ['services'] }); }); }}>
                <Field label={t('catalogue.code')} htmlFor="sv-code"><Input id="sv-code" required pattern="[a-z0-9_]{2,40}" value={svc.code} onChange={(e) => setSvc({ ...svc, code: e.target.value })} /></Field>
                <Field label={t('catalogue.nameFr')} htmlFor="sv-fr"><Input id="sv-fr" required value={svc.nameFr} onChange={(e) => setSvc({ ...svc, nameFr: e.target.value })} /></Field>
                <Field label={t('catalogue.nameEn')} htmlFor="sv-en"><Input id="sv-en" required value={svc.nameEn} onChange={(e) => setSvc({ ...svc, nameEn: e.target.value })} /></Field>
                <Field label={t('catalogue.kind')} htmlFor="sv-kind"><Select id="sv-kind" value={svc.kind} onChange={(e) => setSvc({ ...svc, kind: e.target.value })}>{SERVICE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</Select></Field>
                <Field label={t('catalogue.unit')} htmlFor="sv-unit"><Select id="sv-unit" value={svc.unit} onChange={(e) => setSvc({ ...svc, unit: e.target.value })}>{SERVICE_UNITS.map((k) => <option key={k} value={k}>{k}</option>)}</Select></Field>
                <Field label={t('catalogue.defaultPrice')} htmlFor="sv-price"><Input id="sv-price" type="number" min={0} required value={svc.defaultUnitPriceXof} onChange={(e) => setSvc({ ...svc, defaultUnitPriceXof: e.target.value })} /></Field>
                <Button type="submit" loading={busy === 'svc'}>{t('investment.add')}</Button>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
