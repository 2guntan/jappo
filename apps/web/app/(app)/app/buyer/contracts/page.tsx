'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { Card, CardBody, EmptyState, PageHeader, Spinner } from '@/components/ui';
import { OfftakeTable } from '@/components/offtake/offtake-table';

export default function BuyerContractsPage() {
  const t = useTranslations();
  const { api } = useSession();
  const q = useQuery({ queryKey: ['offtake', 'buyer'], queryFn: () => unwrap(api.GET('/v1/buyer/contracts')) });
  if (q.isLoading) return <Spinner />;
  const rows = q.data?.data ?? [];
  return (
    <>
      <PageHeader title={t('buyer.title')} />
      {rows.length ? <Card><CardBody className="p-0"><OfftakeTable rows={rows} showOperatorActions={false} /></CardBody></Card> : <EmptyState title={t('buyer.title')} description={t('buyer.empty')} />}
    </>
  );
}
