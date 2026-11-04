'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { SERVICE_UNITS } from '@jappo/contracts';
import { useSession } from '@/lib/session';
import { uploadFile, useAction } from '@/lib/hooks';
import { formatDate, formatXof } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th } from '@/components/ui';

export default function QuotesPage() {
  const t = useTranslations();
  const locale = useLocale();
  const { api, authedFetch, hasPermission } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const quotes = useQuery({ queryKey: ['quotes'], queryFn: () => unwrap(api.GET('/v1/supplier-quotes')) });
  const services = useQuery({ queryKey: ['services'], queryFn: () => unwrap(api.GET('/v1/services')) });
  const [q, setQ] = useState({ supplierName: '', serviceId: '', unit: 'kg', unitPriceXof: '', validUntil: '', private: false });
  const [file, setFile] = useState<File | null>(null);
  const svcName = (id: string) => { const s = services.data?.data.find((x) => x.id === id); return s ? (locale === 'en' ? s.nameEn : s.nameFr) : ''; };
  const rows = quotes.data?.data ?? [];
  return (
    <>
      <PageHeader title={t('quotes.title')} />
      {msg && <Alert tone={msg.tone} className="mb-4">{msg.text}</Alert>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {rows.length === 0 ? <EmptyState title={t('quotes.title')} description={t('quotes.empty')} /> : (
            <Card>
              <CardBody className="p-0">
                <Table>
                  <thead><tr><Th>{t('quotes.supplier')}</Th><Th>{t('seasons.service')}</Th><Th>{t('seasons.unitPrice')}</Th><Th>{t('quotes.validUntil')}</Th></tr></thead>
                  <tbody>{rows.map((r) => <tr key={r.id}><Td>{r.supplierName} {r.private && <Badge>{t('quotes.private').split(' ')[0]}</Badge>}</Td><Td>{svcName(r.serviceId)}</Td><Td>{formatXof(r.unitPriceXof)} / {r.unit}</Td><Td>{formatDate(r.validUntil)}</Td></tr>)}</tbody>
                </Table>
              </CardBody>
            </Card>
          )}
        </div>
        {hasPermission('quote:manage') && (
          <Card>
            <CardHeader><CardTitle>{t('quotes.new')}</CardTitle></CardHeader>
            <CardBody>
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run('q', async () => { const fileId = file ? await uploadFile(authedFetch, file) : null; await unwrap(api.POST('/v1/supplier-quotes', { body: { ...q, unit: q.unit as 'kg', unitPriceXof: Number(q.unitPriceXof), fileId } })); setQ({ ...q, supplierName: '', unitPriceXof: '' }); setFile(null); await qc.invalidateQueries({ queryKey: ['quotes'] }); }); }}>
                <Field label={t('quotes.supplier')} htmlFor="q-sup"><Input id="q-sup" required value={q.supplierName} onChange={(e) => setQ({ ...q, supplierName: e.target.value })} /></Field>
                <Field label={t('seasons.service')} htmlFor="q-svc"><Select id="q-svc" required value={q.serviceId} onChange={(e) => { const s = services.data?.data.find((x) => x.id === e.target.value); setQ({ ...q, serviceId: e.target.value, unit: s?.unit ?? q.unit }); }}><option value="">—</option>{services.data?.data.map((s) => <option key={s.id} value={s.id}>{locale === 'en' ? s.nameEn : s.nameFr}</option>)}</Select></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t('catalogue.unit')} htmlFor="q-unit"><Select id="q-unit" value={q.unit} onChange={(e) => setQ({ ...q, unit: e.target.value })}>{SERVICE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}</Select></Field>
                  <Field label={t('seasons.unitPrice')} htmlFor="q-price"><Input id="q-price" type="number" min={0} required value={q.unitPriceXof} onChange={(e) => setQ({ ...q, unitPriceXof: e.target.value })} /></Field>
                </div>
                <Field label={t('quotes.validUntil')} htmlFor="q-valid"><Input id="q-valid" type="date" required value={q.validUntil} onChange={(e) => setQ({ ...q, validUntil: e.target.value })} /></Field>
                <Field label={t('org.file')} htmlFor="q-file"><Input id="q-file" type="file" accept=".pdf,.jpg,.png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={q.private} onChange={(e) => setQ({ ...q, private: e.target.checked })} /> {t('quotes.private')}</label>
                <Button type="submit" loading={busy === 'q'}>{t('investment.add')}</Button>
              </form>
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
