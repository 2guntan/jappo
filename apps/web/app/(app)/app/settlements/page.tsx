'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { formatDateTime, formatXof } from '@/lib/utils';
import { Badge, Card, CardBody, EmptyState, PageHeader, Spinner, Table, Td, Th } from '@/components/ui';

export default function SettlementsPage() {
  const t = useTranslations();
  const { api } = useSession();
  const q = useQuery({ queryKey: ['settlements'], queryFn: () => unwrap(api.GET('/v1/settlement-runs')) });
  if (q.isLoading) return <Spinner />;
  const rows = q.data?.data ?? [];
  return (
    <>
      <PageHeader title={t('settlement.title')} subtitle={t('settlement.subtitle')} />
      {rows.length === 0 ? <EmptyState title={t('settlement.title')} description={t('settlement.empty')} /> : (
        <Card>
          <CardBody className="p-0">
            <Table>
              <thead><tr><Th>{t('contracts.ref')}</Th><Th>{t('adminLand.block')}</Th><Th>{t('settlement.receipts')}</Th><Th>{t('settlement.farmersTotal')}</Th><Th>{t('settlement.computedAt')}</Th><Th>{t('common.status')}</Th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <Td className="font-medium"><Link className="text-brand-700 hover:underline" href={`/app/settlements/${r.id}`}>{r.ref}</Link></Td>
                    <Td>{r.blockRef} · {r.blockName}</Td><Td>{formatXof(r.receiptsTotalXof)}</Td><Td>{formatXof(r.distribution.farmersTotalXof)}</Td><Td>{formatDateTime(r.computedAt)}</Td>
                    <Td><Badge data-testid={`settlement-status-${r.ref}`}>{t(`settlement.status.${r.status}`)}</Badge></Td>
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
