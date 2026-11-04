'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { formatDateTime, formatXof } from '@/lib/utils';
import { Badge, Card, CardBody, EmptyState, PageHeader, Spinner, Table, Td, Th, buttonVariants } from '@/components/ui';

export default function OpportunitiesPage() {
  const t = useTranslations();
  const { api } = useSession();
  const q = useQuery({ queryKey: ['opportunities'], queryFn: () => unwrap(api.GET('/v1/lender/opportunities')) });
  if (q.isLoading) return <Spinner />;
  const rows = q.data?.data ?? [];
  return (
    <>
      <PageHeader title={t('lender.opportunities')} />
      {rows.length === 0 ? <EmptyState title={t('lender.opportunities')} description={t('lender.noOpportunities')} action={<Link className={buttonVariants()} href="/app/lender/profiles">{t('lender.profiles')}</Link>} /> : (
        <Card>
          <CardBody className="p-0">
            <Table>
              <thead><tr><Th>{t('rfp.title')}</Th><Th>{t('adminLand.block')}</Th><Th>{t('readiness.score')}</Th><Th>{t('fin.amount')}</Th><Th>{t('rfp.deadline')}</Th><Th>{t('common.status')}</Th><Th /></tr></thead>
              <tbody>
                {rows.map(({ invitation, rfp }) => {
                  const days = rfp.deadlineAt ? Math.max(0, Math.ceil((Date.parse(rfp.deadlineAt) - Date.now()) / 86400_000)) : null;
                  return (
                    <tr key={rfp.id}>
                      <Td className="font-medium">{rfp.ref}<div className="text-xs text-neutral-500">{rfp.operatorName}</div></Td>
                      <Td>{rfp.blockName}<div className="text-xs text-neutral-500">{rfp.region}</div></Td>
                      <Td><Badge tone={rfp.grade === 'A' ? 'green' : 'amber'}>{rfp.grade}</Badge> {rfp.readinessScore}</Td>
                      <Td>{formatXof(rfp.tranches.reduce((s, x) => s + x.amountXof, 0))}</Td>
                      <Td>{formatDateTime(rfp.deadlineAt)}{rfp.status === 'open' && days !== null && <div className="text-xs text-amber-700">{t('lender.daysLeft', { days })}</div>}</Td>
                      <Td><Badge tone="blue">{t(`rfp.status.${rfp.status}`)}</Badge> <Badge>{t(`rfp.invStatus.${invitation.status}`)}</Badge></Td>
                      <Td><Link className={buttonVariants({ size: 'sm', variant: 'secondary' })} href={`/app/lender/rfps/${rfp.id}`}>{t('lender.view')}</Link></Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}
    </>
  );
}
