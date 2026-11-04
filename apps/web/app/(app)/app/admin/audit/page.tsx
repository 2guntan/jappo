'use client';

import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { formatDateTime } from '@/lib/utils';
import { Alert, Button, Card, CardBody, PageHeader, Spinner, Table, Td, Th } from '@/components/ui';

export default function AuditPage() {
  const t = useTranslations();
  const { api } = useSession();
  const [check, setCheck] = useState<{ ok: boolean; checked: number; brokenAtSeq: number | null } | null>(null);
  const q = useInfiniteQuery({
    queryKey: ['audit'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => unwrap(api.GET('/v1/admin/audit', { params: { query: { limit: 50, cursor: pageParam } } })),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <>
      <PageHeader title={t('admin.auditTitle')} actions={<Button variant="secondary" onClick={async () => setCheck(await unwrap(api.POST('/v1/admin/audit/actions/verify')))}>{t('admin.verifyChain')}</Button>} />
      {check && <Alert tone={check.ok ? 'success' : 'error'} className="mb-4">{check.ok ? t('admin.chainOk', { count: check.checked }) : t('admin.chainBroken', { seq: check.brokenAtSeq ?? 0 })}</Alert>}
      {q.isLoading ? (
        <Spinner />
      ) : (
        <Card>
          <CardBody className="p-0">
            <Table>
              <thead><tr><Th>#</Th><Th>{t('admin.at')}</Th><Th>{t('admin.action')}</Th><Th>{t('admin.resource')}</Th><Th>{t('admin.actor')}</Th></tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <Td>{a.seq}</Td>
                    <Td>{formatDateTime(a.at)}</Td>
                    <Td><code className="text-xs">{a.action}</code></Td>
                    <Td className="text-xs">{a.resourceType}<div className="text-neutral-400">{a.resourceId}</div></Td>
                    <Td className="text-xs">{a.actorType}<div className="text-neutral-400">{a.actorId}</div></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}
      {q.hasNextPage && <Button variant="secondary" className="mt-4" onClick={() => q.fetchNextPage()}>{t('common.loadMore')}</Button>}
    </>
  );
}
