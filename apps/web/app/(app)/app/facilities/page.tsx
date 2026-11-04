'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { facilityTone, formatDate, formatXof } from '@/lib/utils';
import { Badge, Card, CardBody, EmptyState, PageHeader, Spinner, Table, Td, Th } from '@/components/ui';

export default function FacilitiesPage() {
  const t = useTranslations();
  const { api } = useSession();
  const q = useQuery({ queryKey: ['facilities'], queryFn: () => unwrap(api.GET('/v1/facilities')) });
  const pending = useQuery({ queryKey: ['disbursements-pending'], queryFn: () => unwrap(api.GET('/v1/disbursements/pending')) });
  if (q.isLoading) return <Spinner />;
  const rows = q.data?.data ?? [];
  const outstanding = rows.reduce((s, f) => s + f.outstandingPrincipalXof, 0);
  const overdue = rows.reduce((s, f) => s + f.overdueXof, 0);
  return (
    <>
      <PageHeader title={t('facility.title')} subtitle={t('facility.subtitle')} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card><CardBody><p className="text-xs text-neutral-500">{t('facility.count')}</p><p className="text-2xl font-semibold">{rows.length}</p></CardBody></Card>
        <Card><CardBody><p className="text-xs text-neutral-500">{t('facility.outstanding')}</p><p className="text-2xl font-semibold" data-testid="portfolio-outstanding">{formatXof(outstanding)}</p></CardBody></Card>
        <Card><CardBody><p className="text-xs text-neutral-500">{t('facility.overdue')}</p><p className="text-2xl font-semibold">{formatXof(overdue)}</p><p className="text-xs text-neutral-500">{t('facility.pendingDisbursements', { count: pending.data?.data.length ?? 0 })}</p></CardBody></Card>
      </div>
      {rows.length === 0 ? <EmptyState title={t('facility.title')} description={t('facility.empty')} /> : (
        <Card>
          <CardBody className="p-0">
            <Table>
              <thead><tr><Th>{t('facility.ref')}</Th><Th>{t('adminLand.block')}</Th><Th>{t('facility.lender')}</Th><Th>{t('fin.amount')}</Th><Th>{t('facility.disbursed')}</Th><Th>{t('facility.maturity')}</Th><Th>{t('common.status')}</Th></tr></thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id}>
                    <Td className="font-medium"><Link className="text-brand-700 hover:underline" href={`/app/facilities/${f.id}`}>{f.ref}</Link></Td>
                    <Td>{f.blockRef} · {f.blockName}</Td>
                    <Td>{f.lenderName}</Td>
                    <Td>{formatXof(f.principalXof)}</Td>
                    <Td>{formatXof(f.disbursedXof)}</Td>
                    <Td>{formatDate(f.maturityDate)}</Td>
                    <Td><Badge tone={facilityTone(f.status)} data-testid={`facility-status-${f.ref}`}>{t(`facility.status.${f.status}`)}</Badge></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}
    </>
  );
}
