'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap, type Schemas } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { contractTone, formatDateTime } from '@/lib/utils';
import { Badge, Card, CardBody, EmptyState, PageHeader, Select, Spinner, Table, Td, Th } from '@/components/ui';

function ContractsList() {
  const t = useTranslations();
  const { api } = useSession();
  const sp = useSearchParams();
  const [status, setStatus] = useState('');
  const seasonId = sp.get('seasonId') ?? undefined;
  const blockId = sp.get('blockId') ?? undefined;
  const q = useQuery({
    queryKey: ['contracts', seasonId, blockId, status],
    queryFn: () => unwrap(api.GET('/v1/contracts', { params: { query: { seasonId, blockId, status: (status || undefined) as Schemas['Contract']['status'] | undefined } } })),
  });
  return (
    <>
      <PageHeader title={t('contracts.title')} subtitle={t('contracts.subtitle')} />
      <div className="mb-4 flex items-center gap-2">
        <label htmlFor="cstatus" className="text-sm text-neutral-600">{t('common.status')}</label>
        <Select id="cstatus" className="w-56" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('contracts.allStatuses')}</option>
          {(['draft', 'out_for_signature', 'partially_signed', 'signed', 'voided'] as const).map((s) => <option key={s} value={s}>{t(`contracts.status.${s}`)}</option>)}
        </Select>
      </div>
      {q.isLoading ? <Spinner /> : !q.data?.data.length ? <EmptyState title={t('contracts.title')} description={t('contracts.empty')} /> : (
        <Card>
          <CardBody className="p-0">
            <Table>
              <thead><tr><Th>{t('contracts.ref')}</Th><Th>{t('contracts.type')}</Th><Th>{t('adminLand.block')}</Th><Th>{t('contracts.parties')}</Th><Th>{t('contracts.sentAt')}</Th><Th>{t('common.status')}</Th></tr></thead>
              <tbody>
                {q.data.data.map((c) => (
                  <tr key={c.id}>
                    <Td className="font-medium"><Link className="text-brand-700 hover:underline" href={`/app/contracts/${c.id}`}>{c.ref}</Link></Td>
                    <Td>{c.title}</Td>
                    <Td>{c.blockRef}</Td>
                    <Td className="text-xs">{c.parties.map((p) => `${p.signedAt ? '✔' : '○'} ${p.name}`).join(' · ')}</Td>
                    <Td>{formatDateTime(c.sentAt)}</Td>
                    <Td><Badge tone={contractTone(c.status)} data-testid={`contract-status-${c.ref}`}>{t(`contracts.status.${c.status}`)}</Badge></Td>
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

export default function ContractsPage() {
  return (
    <Suspense>
      <ContractsList />
    </Suspense>
  );
}
