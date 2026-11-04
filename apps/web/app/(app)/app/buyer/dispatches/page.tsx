'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { ifMatch, useAction } from '@/lib/hooks';
import { formatDateTime } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, EmptyState, Input, PageHeader, Spinner, Table, Td, Th } from '@/components/ui';

const kgf = (n: number | null) => (n === null ? '—' : `${new Intl.NumberFormat('fr-SN', { maximumFractionDigits: 3 }).format(n)} kg`);

export default function BuyerDispatchesPage() {
  const t = useTranslations();
  const { api } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const [form, setForm] = useState<Record<string, { accepted: string; rejected: string; comment: string }>>({});
  const q = useQuery({ queryKey: ['buyer-dispatches'], queryFn: () => unwrap(api.GET('/v1/dispatches')) });
  if (q.isLoading) return <Spinner />;
  const rows = q.data?.data ?? [];
  return (
    <>
      <PageHeader title={t('buyer.dispatches')} subtitle={t('buyer.dispatchesHint')} />
      {msg && <Alert tone={msg.tone} className="mb-4">{msg.text}</Alert>}
      {rows.length === 0 ? <EmptyState title={t('buyer.dispatches')} description={t('buyer.noDispatches')} /> : (
        <Card>
          <CardBody className="p-0">
            <Table>
              <thead><tr><Th>{t('contracts.ref')}</Th><Th>{t('adminLand.block')}</Th><Th>{t('harvest.offtake')}</Th><Th>{t('harvest.net')}</Th><Th>{t('harvest.dispatchedAt')}</Th><Th>{t('common.status')}</Th><Th /></tr></thead>
              <tbody>
                {rows.map((d) => {
                  const f = form[d.id] ?? { accepted: String(d.netKgTotal), rejected: '0', comment: '' };
                  return (
                    <tr key={d.id}>
                      <Td className="font-medium">{d.ref}<span className="block text-xs text-neutral-500">{d.vehicle ?? ''}</span></Td>
                      <Td>{d.blockRef}</Td><Td>{d.offtakeRef}</Td><Td>{kgf(d.netKgTotal)}</Td><Td>{formatDateTime(d.dispatchedAt)}</Td>
                      <Td><Badge data-testid={`buyer-dispatch-${d.ref}`}>{t(`harvest.dispatchStatus.${d.status}`)}</Badge>{d.buyerAcceptedKg !== null && <span className="block text-xs">{kgf(d.buyerAcceptedKg)} / {kgf(d.buyerRejectedKg)}</span>}</Td>
                      <Td className="whitespace-nowrap">
                        {d.allowedActions.includes('accept') && (
                          <div className="flex flex-wrap items-center gap-1">
                            <Input className="h-8 w-28" aria-label={`${t('harvest.accepted')} ${d.ref}`} inputMode="decimal" value={f.accepted} onChange={(e) => setForm({ ...form, [d.id]: { ...f, accepted: e.target.value } })} />
                            <Input className="h-8 w-24" aria-label={`${t('harvest.rejected')} ${d.ref}`} inputMode="decimal" value={f.rejected} onChange={(e) => setForm({ ...form, [d.id]: { ...f, rejected: e.target.value } })} />
                            <Input className="h-8 w-40" aria-label={`${t('buyer.comment')} ${d.ref}`} placeholder={t('buyer.comment')} value={f.comment} onChange={(e) => setForm({ ...form, [d.id]: { ...f, comment: e.target.value } })} />
                            <Button size="sm" loading={busy === d.id} onClick={() => run(d.id, async () => { await unwrap(api.POST('/v1/dispatches/{id}/actions/accept', { params: { path: { id: d.id } }, headers: ifMatch(d.version), body: { acceptedKg: Number(f.accepted), rejectedKg: Number(f.rejected || 0), comment: f.comment || null } })); await qc.invalidateQueries({ queryKey: ['buyer-dispatches'] }); })}>{t('buyer.confirmReceipt')}</Button>
                          </div>
                        )}
                      </Td>
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
