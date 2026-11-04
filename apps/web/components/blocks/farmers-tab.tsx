'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { statusTone } from '@/lib/utils';
import { Badge, Card, CardBody, EmptyState, Table, Td, Th, buttonVariants } from '@/components/ui';
import type { BlockT } from './types';

export function BlockFarmersTab({ block }: { block: BlockT }) {
  const t = useTranslations();
  const { api, hasPermission } = useSession();
  const q = useQuery({ queryKey: ['farmers', 'block', block.id], queryFn: () => unwrap(api.GET('/v1/farmers', { params: { query: { limit: 200, blockId: block.id } } })) });
  const rows = q.data?.data ?? [];
  if (!rows.length)
    return <EmptyState title={t('farmers.title')} description={t('farmers.empty')} action={hasPermission('farmer:create') ? <Link className={buttonVariants()} href="/app/farmers">{t('farmers.title')}</Link> : undefined} />;
  return (
    <Card>
      <CardBody className="p-0">
        <Table>
          <thead><tr><Th>{t('farmers.code')}</Th><Th>{t('common.name')}</Th><Th>{t('farmers.sex')}</Th><Th>{t('farmers.village')}</Th><Th>{t('farmers.kyc')}</Th><Th>{t('farmers.wallet')}</Th></tr></thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id}>
                <Td><Link href={`/app/farmers/${f.id}`} className="text-brand-700 hover:underline">{f.code}</Link></Td>
                <Td>{f.firstName} {f.lastName}</Td>
                <Td>{t(`enum.sex.${f.sex}`)}</Td>
                <Td>{f.village ?? '—'}</Td>
                <Td><Badge tone={statusTone(f.kycStatus)}>{t(`farmers.kycStatus.${f.kycStatus}`)}</Badge></Td>
                <Td>{f.walletVerifiedAt ? <Badge tone="green">{t('farmers.walletVerified')}</Badge> : <Badge>{t('farmers.walletUnverified')}</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </CardBody>
    </Card>
  );
}
