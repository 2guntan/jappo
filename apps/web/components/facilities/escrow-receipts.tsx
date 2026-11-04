'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { ifMatch, useAction } from '@/lib/hooks';
import { formatDate, formatXof } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, Input, Table, Td, Th } from '@/components/ui';

/** Escrow receipts of the block; the lender holding the account confirms or rejects declared payments. */
export function EscrowReceipts({ blockId }: { blockId: string }) {
  const t = useTranslations();
  const { api } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const [reason, setReason] = useState<Record<string, string>>({});
  const q = useQuery({ queryKey: ['receipts', blockId], queryFn: () => unwrap(api.GET('/v1/escrow-receipts', { params: { query: { blockId } } })) });
  const rows = q.data?.data ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ['receipts', blockId] });
  return (
    <Card>
      <CardHeader className="flex items-center justify-between"><CardTitle>{t('harvest.receipts')}</CardTitle><span className="text-sm text-neutral-600">{formatXof(rows.filter((r) => r.status === 'confirmed').reduce((s, r) => s + r.amountXof, 0))}</span></CardHeader>
      <CardBody className="p-0">
        {msg && <Alert tone={msg.tone} className="m-4">{msg.text}</Alert>}
        {rows.length === 0 ? <p className="p-5 text-sm text-neutral-600">{t('harvest.noReceipts')}</p> : (
          <Table>
            <thead><tr><Th>{t('harvest.valueDate')}</Th><Th>{t('harvest.payer')}</Th><Th>{t('fin.amount')}</Th><Th>{t('facility.bankReference')}</Th><Th>{t('common.status')}</Th><Th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td>{formatDate(r.valueDate)}</Td><Td>{r.payerName}<span className="block text-xs text-neutral-500">{r.invoiceRef ?? ''}</span></Td><Td>{formatXof(r.amountXof)}</Td><Td>{r.bankReference}</Td>
                  <Td><Badge tone={r.status === 'confirmed' ? 'green' : r.status === 'rejected' ? 'red' : 'amber'} data-testid={`receipt-status-${r.bankReference}`}>{t(`harvest.receiptStatus.${r.status}`)}</Badge></Td>
                  <Td className="whitespace-nowrap">
                    {r.allowedActions.includes('confirm') && <Button size="sm" loading={busy === `c${r.id}`} data-testid={`confirm-receipt-${r.bankReference}`} onClick={() => run(`c${r.id}`, async () => { await unwrap(api.POST('/v1/escrow-receipts/{id}/actions/confirm', { params: { path: { id: r.id } }, headers: ifMatch(r.version), body: {} })); await refresh(); })}>{t('facility.confirmFunds')}</Button>}
                    {r.allowedActions.includes('reject') && (
                      <span className="ml-1 inline-flex gap-1">
                        <Input className="h-8 w-32" aria-label={t('rfp.reason')} placeholder={t('rfp.reason')} value={reason[r.id] ?? ''} onChange={(e) => setReason({ ...reason, [r.id]: e.target.value })} />
                        <Button size="sm" variant="ghost" disabled={!reason[r.id]?.trim()} onClick={() => run(`r${r.id}`, async () => { await unwrap(api.POST('/v1/escrow-receipts/{id}/actions/reject', { params: { path: { id: r.id } }, headers: ifMatch(r.version), body: { reason: reason[r.id] } })); await refresh(); })}>{t('facility.reject')}</Button>
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}
