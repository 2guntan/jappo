'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import { formatDateTime, formatXof } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, EmptyState, Input, PageHeader, Spinner, Table, Td, Th } from '@/components/ui';

export default function LenderAwardsPage() {
  const t = useTranslations();
  const { api } = useSession();
  const qc = useQueryClient();
  const { msg, run } = useAction();
  const [reason, setReason] = useState<Record<string, string>>({});
  const q = useQuery({ queryKey: ['lender-awards'], queryFn: () => unwrap(api.GET('/v1/lender/awards')) });
  if (q.isLoading) return <Spinner />;
  const rows = q.data?.data ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ['lender-awards'] });
  return (
    <>
      <PageHeader title={t('lender.awards')} />
      {msg && <Alert tone={msg.tone} className="mb-4">{msg.text}</Alert>}
      {rows.length === 0 ? <EmptyState title={t('lender.awards')} description={t('lender.noAwards')} /> : (
        <Card>
          <CardBody className="p-0">
            <Table>
              <thead><tr><Th>{t('rfp.title')}</Th><Th>{t('adminLand.block')}</Th><Th>{t('fin.amount')}</Th><Th>{t('admin.at')}</Th><Th>{t('common.status')}</Th><Th /></tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <Td className="font-medium">{a.rfpRef}</Td>
                    <Td>{a.blockName}</Td>
                    <Td>{formatXof(a.amountXof)}</Td>
                    <Td>{formatDateTime(a.decidedAt)}</Td>
                    <Td><Badge tone={a.status === 'accepted_by_lender' ? 'green' : a.status === 'proposed' ? 'blue' : 'red'} data-testid={`my-award-${a.rfpRef}`}>{t(`rfp.awardStatus.${a.status}`)}</Badge></Td>
                    <Td className="space-x-1 whitespace-nowrap">
                      {a.allowedActions.includes('accept') && <Button size="sm" onClick={() => run('a', async () => { await unwrap(api.POST('/v1/awards/{id}/actions/accept', { params: { path: { id: a.id } }, body: {} })); await refresh(); })}>{t('lender.accept')}</Button>}
                      {a.allowedActions.includes('decline') && (
                        <span className="inline-flex gap-1">
                          <Input className="h-8 w-32" placeholder={t('rfp.reason')} aria-label={t('rfp.reason')} value={reason[a.id] ?? ''} onChange={(e) => setReason({ ...reason, [a.id]: e.target.value })} />
                          <Button size="sm" variant="ghost" disabled={!reason[a.id]} onClick={() => run('d', async () => { await unwrap(api.POST('/v1/awards/{id}/actions/decline', { params: { path: { id: a.id } }, body: { reason: reason[a.id] } })); await refresh(); })}>{t('lender.declineAward')}</Button>
                        </span>
                      )}
                    </Td>
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
