'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import { formatDate, formatXof } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, PageHeader, Spinner, Table, Td, Th } from '@/components/ui';

export default function BillingPage() {
  const t = useTranslations();
  const { api, activeMembership, hasPermission } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const sub = useQuery({ queryKey: ['subscription'], queryFn: () => unwrap(api.GET('/v1/billing/subscription')) });
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => unwrap(api.GET('/v1/billing/plans')) });
  const inv = useQuery({ queryKey: ['platform-invoices'], queryFn: () => unwrap(api.GET('/v1/billing/invoices')) });
  if (sub.isLoading) return <Spinner />;
  const current = sub.data?.subscription;
  const mine = (plans.data?.data ?? []).filter((p) => activeMembership && p.orgTypes.includes(activeMembership.orgType));
  return (
    <>
      <PageHeader title={t('billing.title')} subtitle={current ? `${t('billing.current')} : ${current.plan.name}` : t('billing.none')} />
      {msg && <Alert tone={msg.tone} className="mb-4">{msg.text}</Alert>}
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        {mine.map((p) => (
          <Card key={p.id}>
            <CardHeader className="flex items-center justify-between"><CardTitle>{p.name}</CardTitle>{current?.plan.code === p.code && <Badge tone="green" data-testid="current-plan">{t('billing.currentBadge')}</Badge>}</CardHeader>
            <CardBody className="space-y-2 text-sm">
              <p className="text-lg font-semibold">{p.priceModel === 'free' ? t('billing.free') : `${formatXof(p.unitPriceXof)} ${t(`billing.per.${p.priceModel}`)}`}</p>
              {p.structuringFeeBps > 0 && <p>{t('billing.structuring', { pct: p.structuringFeeBps / 100 })}</p>}
              {p.includedSeats > 0 && <p>{t('billing.seats', { n: p.includedSeats })}</p>}
              {hasPermission('billing:manage') && current?.plan.code !== p.code && <Button size="sm" loading={busy === p.code} data-testid={`subscribe-${p.code}`} onClick={() => run(p.code, async () => { await unwrap(api.POST('/v1/billing/subscription', { body: { planCode: p.code } })); await Promise.all([qc.invalidateQueries({ queryKey: ['subscription'] }), qc.invalidateQueries({ queryKey: ['platform-invoices'] })]); }, t('billing.subscribed'))}>{t('billing.choose')}</Button>}
            </CardBody>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle>{t('billing.invoices')}</CardTitle></CardHeader>
        <CardBody className="p-0">
          <Table>
            <thead><tr><Th>{t('contracts.ref')}</Th><Th>{t('billing.description')}</Th><Th>{t('billing.total')}</Th><Th>{t('facility.dueDate')}</Th><Th>{t('common.status')}</Th><Th /></tr></thead>
            <tbody>
              {(inv.data?.data ?? []).map((i) => (
                <tr key={i.id}>
                  <Td className="font-medium">{i.ref}</Td><Td className="text-xs">{i.lines.map((l) => l.description).join(' · ')}</Td><Td data-testid={`platform-invoice-${i.ref}`}>{formatXof(i.totalXof)}</Td><Td>{formatDate(i.dueDate)}</Td>
                  <Td><Badge tone={i.status === 'paid' ? 'green' : i.status === 'void' ? 'neutral' : 'amber'}>{t(`billing.status.${i.status}`)}</Badge></Td>
                  <Td>{i.hasPdf && <Button size="sm" variant="ghost" onClick={() => run('pdf', async () => { const r = await unwrap(api.GET('/v1/billing/invoices/{id}/pdf', { params: { path: { id: i.id } } })); window.open(r.url, '_blank', 'noopener'); })}>PDF</Button>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </>
  );
}
