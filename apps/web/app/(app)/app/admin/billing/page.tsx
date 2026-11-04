'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import { formatDate, formatXof } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, Input, PageHeader, Table, Td, Th } from '@/components/ui';

export default function AdminBillingPage() {
  const t = useTranslations();
  const { api } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const [price, setPrice] = useState<Record<string, string>>({});
  const [ref, setRef] = useState<Record<string, string>>({});
  const plans = useQuery({ queryKey: ['admin-plans'], queryFn: () => unwrap(api.GET('/v1/admin/plans')) });
  const inv = useQuery({ queryKey: ['admin-invoices'], queryFn: () => unwrap(api.GET('/v1/admin/invoices')) });
  return (
    <>
      <PageHeader title={t('adminBilling.title')} />
      {msg && <Alert tone={msg.tone} className="mb-4">{msg.text}</Alert>}
      <Card className="mb-6">
        <CardHeader><CardTitle>{t('adminBilling.plans')}</CardTitle></CardHeader>
        <CardBody className="p-0">
          <Table>
            <thead><tr><Th>Code</Th><Th>{t('adminBilling.name')}</Th><Th>{t('adminBilling.price')}</Th><Th>bps</Th><Th /></tr></thead>
            <tbody>
              {(plans.data?.data ?? []).map((p) => (
                <tr key={p.id}>
                  <Td className="font-medium">{p.code}</Td><Td>{p.name}</Td>
                  <Td><Input className="h-8 w-32" inputMode="numeric" aria-label={`${t('adminBilling.price')} ${p.code}`} value={price[p.id] ?? String(p.unitPriceXof)} onChange={(e) => setPrice({ ...price, [p.id]: e.target.value.replace(/\D/g, '') })} /></Td><Td>{p.structuringFeeBps}</Td>
                  <Td><Button size="sm" variant="secondary" disabled={price[p.id] === undefined} loading={busy === p.id} onClick={() => run(p.id, async () => { await unwrap(api.PATCH('/v1/admin/plans/{id}', { params: { path: { id: p.id } }, body: { unitPriceXof: Number(price[p.id]) } })); await qc.invalidateQueries({ queryKey: ['admin-plans'] }); }, t('common.saved'))}>{t('common.save')}</Button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t('billing.invoices')}</CardTitle></CardHeader>
        <CardBody className="p-0">
          <Table>
            <thead><tr><Th>{t('contracts.ref')}</Th><Th>{t('billing.total')}</Th><Th>{t('facility.dueDate')}</Th><Th>{t('common.status')}</Th><Th /></tr></thead>
            <tbody>
              {(inv.data?.data ?? []).map((i) => (
                <tr key={i.id}>
                  <Td className="font-medium">{i.ref}<span className="block text-xs text-neutral-500">{i.lines.map((l) => l.description).join(' · ')}</span></Td><Td>{formatXof(i.totalXof)}</Td><Td>{formatDate(i.dueDate)}</Td>
                  <Td><Badge data-testid={`admin-invoice-${i.ref}`}>{t(`billing.status.${i.status}`)}</Badge></Td>
                  <Td className="whitespace-nowrap">
                    {i.status === 'issued' && (
                      <span className="inline-flex gap-1">
                        <Input className="h-8 w-36" aria-label={`${t('adminBilling.reference')} ${i.ref}`} placeholder={t('adminBilling.reference')} value={ref[i.id] ?? ''} onChange={(e) => setRef({ ...ref, [i.id]: e.target.value })} />
                        <Button size="sm" disabled={!ref[i.id]?.trim()} onClick={() => run(`p${i.id}`, async () => { await unwrap(api.POST('/v1/admin/invoices/{id}/actions/mark-paid', { params: { path: { id: i.id } }, body: { reference: ref[i.id] } })); await qc.invalidateQueries({ queryKey: ['admin-invoices'] }); })}>{t('adminBilling.markPaid')}</Button>
                        <Button size="sm" variant="ghost" disabled={!ref[i.id]?.trim()} onClick={() => run(`v${i.id}`, async () => { await unwrap(api.POST('/v1/admin/invoices/{id}/actions/void', { params: { path: { id: i.id } }, body: { reason: ref[i.id] } })); await qc.invalidateQueries({ queryKey: ['admin-invoices'] }); })}>{t('adminBilling.void')}</Button>
                      </span>
                    )}
                    {i.hasPdf && <Button size="sm" variant="ghost" onClick={() => run('pdf', async () => { const r = await unwrap(api.GET('/v1/admin/invoices/{id}/pdf', { params: { path: { id: i.id } } })); window.open(r.url, '_blank', 'noopener'); })}>PDF</Button>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </>
  );
}
