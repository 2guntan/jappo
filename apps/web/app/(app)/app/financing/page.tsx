'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { formatDateTime, formatXof } from '@/lib/utils';
import { Badge, Card, CardBody, EmptyState, PageHeader, Spinner, Table, Td, Th } from '@/components/ui';

export default function FinancingPage() {
  const t = useTranslations();
  const { api } = useSession();
  const q = useQuery({ queryKey: ['financing', 'all'], queryFn: () => unwrap(api.GET('/v1/financing-requests')) });
  if (q.isLoading) return <Spinner />;
  const rows = q.data?.data ?? [];
  return (
    <>
      <PageHeader title={t('fin.title')} />
      {rows.length === 0 ? <EmptyState title={t('fin.title')} description={t('fin.empty')} /> : (
        <Card>
          <CardBody className="p-0">
            <Table>
              <thead><tr><Th>Ref</Th><Th>{t('adminLand.block')}</Th><Th>{t('fin.amount')}</Th><Th>{t('common.status')}</Th><Th>{t('common.createdAt')}</Th><Th /></tr></thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f.id}>
                    <Td><Link className="font-medium text-brand-700 hover:underline" href={`/app/seasons/${f.seasonId}?tab=financing`}>{f.ref}</Link></Td>
                    <Td>{f.blockName}</Td>
                    <Td>{formatXof(f.tranches.reduce((s, x) => s + x.amountXof, 0))}</Td>
                    <Td><Badge tone="blue">{t(`fin.status.${f.status}`)}</Badge></Td>
                    <Td>{formatDateTime(f.createdAt)}</Td>
                    <Td>{f.rfpId && <Link className="text-brand-700 hover:underline" href={`/app/rfps/${f.rfpId}`}>{t('fin.rfp')}</Link>}</Td>
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
