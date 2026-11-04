'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { KYC_STATUSES } from '@jappo/contracts';
import { useSession } from '@/lib/session';
import { downloadCsv, formatDateTime, kycTone } from '@/lib/utils';
import { Badge, Button, Card, CardBody, EmptyState, Input, PageHeader, Select, Spinner, Table, Td, Th, buttonVariants } from '@/components/ui';

export default function AdminKycQueue() {
  const t = useTranslations();
  const { api } = useSession();
  const [status, setStatus] = useState<string>('submitted');
  const [q, setQ] = useState('');
  const list = useQuery({
    queryKey: ['admin-orgs', status, q],
    queryFn: () => unwrap(api.GET('/v1/admin/orgs', { params: { query: { limit: 100, q: q || undefined, ...(status ? { 'filter[kycStatus]': status as 'submitted' } : {}) } } })),
  });
  const rows = list.data?.data ?? [];
  return (
    <>
      <PageHeader title={t('admin.kycTitle')} actions={<Button variant="secondary" onClick={() => downloadCsv('organisations.csv', rows.map((o) => ({ name: o.legalName, type: o.type, kyc: o.kycStatus, created: o.createdAt })))}>{t('common.exportCsv')}</Button>} />
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-48">
          <Select aria-label={t('admin.filterStatus')} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t('admin.all')}</option>
            {KYC_STATUSES.map((s) => <option key={s} value={s}>{t(`kyc.${s}`)}</option>)}
          </Select>
        </div>
        <div className="w-64"><Input placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('common.search')} /></div>
      </div>
      {list.isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState title={t('admin.kycEmpty')} />
      ) : (
        <Card>
          <CardBody className="p-0">
            <Table>
              <thead><tr><Th>{t('common.name')}</Th><Th>{t('org.type')}</Th><Th>{t('org.kycStatus')}</Th><Th>{t('common.createdAt')}</Th><Th /></tr></thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id}>
                    <Td className="font-medium">{o.legalName}</Td>
                    <Td>{t(`auth.orgTypes.${o.type}` as 'auth.orgTypes.operator')}</Td>
                    <Td><Badge tone={kycTone(o.kycStatus)}>{t(`kyc.${o.kycStatus}`)}</Badge></Td>
                    <Td>{formatDateTime(o.createdAt)}</Td>
                    <Td><Link className={buttonVariants({ size: 'sm', variant: 'secondary' })} href={`/app/admin/kyc/${o.id}`}>{t('admin.review')}</Link></Td>
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
