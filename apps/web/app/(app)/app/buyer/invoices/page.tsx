'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import { formatDate, formatXof } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Field, Input, PageHeader, Select, Spinner, Table, Td, Th } from '@/components/ui';

export default function BuyerInvoicesPage() {
  const t = useTranslations();
  const { api } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const q = useQuery({ queryKey: ['buyer-invoices'], queryFn: () => unwrap(api.GET('/v1/buyer-invoices')) });
  const receipts = useQuery({ queryKey: ['buyer-receipts'], queryFn: () => unwrap(api.GET('/v1/escrow-receipts')) });
  const [pay, setPay] = useState({ invoiceId: '', escrowAccountId: '', amountXof: '', valueDate: new Date().toISOString().slice(0, 10), bankReference: '' });
  const inv = q.data?.data.find((i) => i.id === pay.invoiceId);
  const escrows = useQuery({ queryKey: ['escrows', inv?.blockId], enabled: !!inv, queryFn: () => unwrap(api.GET('/v1/escrow-accounts', { params: { query: { blockId: inv!.blockId } } })) });
  if (q.isLoading) return <Spinner />;
  const rows = q.data?.data ?? [];
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['buyer-invoices'] }), qc.invalidateQueries({ queryKey: ['buyer-receipts'] })]);
  return (
    <>
      <PageHeader title={t('buyer.invoices')} subtitle={t('buyer.invoicesHint')} />
      {msg && <Alert tone={msg.tone} className="mb-4">{msg.text}</Alert>}
      {rows.length === 0 ? <EmptyState title={t('buyer.invoices')} description={t('buyer.noInvoices')} /> : (
        <Card className="mb-6">
          <CardBody className="p-0">
            <Table>
              <thead><tr><Th>{t('contracts.ref')}</Th><Th>{t('adminLand.block')}</Th><Th>{t('fin.amount')}</Th><Th>{t('harvest.paid')}</Th><Th>{t('facility.dueDate')}</Th><Th>{t('common.status')}</Th><Th /></tr></thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id}>
                    <Td className="font-medium">{i.ref}</Td><Td>{i.blockRef}</Td><Td>{formatXof(i.amountXof)}</Td><Td>{formatXof(i.paidXof)}</Td><Td>{formatDate(i.dueDate)}</Td>
                    <Td><Badge data-testid={`buyer-invoice-${i.ref}`}>{t(`harvest.invoiceStatus.${i.status}`)}</Badge></Td>
                    <Td className="space-x-1 whitespace-nowrap">
                      {i.hasPdf && <Button size="sm" variant="ghost" onClick={() => run('pdf', async () => { const r = await unwrap(api.GET('/v1/buyer-invoices/{id}/pdf', { params: { path: { id: i.id } } })); window.open(r.url, '_blank', 'noopener'); })}>PDF</Button>}
                      {i.allowedActions.includes('record_payment') && <Button size="sm" variant="secondary" onClick={() => setPay({ ...pay, invoiceId: i.id, amountXof: String(i.outstandingXof) })}>{t('buyer.declarePayment')}</Button>}
                      {i.status !== 'paid' && i.status !== 'disputed' && <Button size="sm" variant="ghost" onClick={() => { const reason = window.prompt(t('rfp.reason')); if (reason) void run('dispute', async () => { await unwrap(api.POST('/v1/buyer-invoices/{id}/actions/dispute', { params: { path: { id: i.id } }, body: { reason } })); await refresh(); }); }}>{t('buyer.dispute')}</Button>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}
      {inv && (
        <Card className="mb-6">
          <CardHeader><CardTitle>{t('buyer.declarePayment')} · {inv.ref}</CardTitle></CardHeader>
          <CardBody className="grid gap-3 sm:grid-cols-4">
            <Field label={t('facility.escrow')} htmlFor="p-esc">
              <Select id="p-esc" value={pay.escrowAccountId} onChange={(e) => setPay({ ...pay, escrowAccountId: e.target.value })}>
                <option value="">—</option>
                {(escrows.data?.data ?? []).map((e) => <option key={e.id} value={e.id}>{e.bankName} · {e.accountNumberMasked}</option>)}
              </Select>
            </Field>
            <Field label={t('fin.amount')} htmlFor="p-amount"><Input id="p-amount" inputMode="numeric" value={pay.amountXof} onChange={(e) => setPay({ ...pay, amountXof: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label={t('harvest.valueDate')} htmlFor="p-date"><Input id="p-date" type="date" value={pay.valueDate} onChange={(e) => setPay({ ...pay, valueDate: e.target.value })} /></Field>
            <Field label={t('facility.bankReference')} htmlFor="p-ref"><Input id="p-ref" value={pay.bankReference} onChange={(e) => setPay({ ...pay, bankReference: e.target.value })} /></Field>
            <div>
              <Button disabled={!pay.escrowAccountId || !Number(pay.amountXof) || pay.bankReference.length < 3} loading={busy === 'pay'} onClick={() => run('pay', async () => { await unwrap(api.POST('/v1/escrow-receipts', { body: { escrowAccountId: pay.escrowAccountId, amountXof: Number(pay.amountXof), valueDate: pay.valueDate, bankReference: pay.bankReference, buyerInvoiceId: inv.id } })); setPay({ ...pay, invoiceId: '', bankReference: '' }); await refresh(); }, t('buyer.paymentDeclared'))}>{t('buyer.submitPayment')}</Button>
            </div>
          </CardBody>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>{t('harvest.receipts')}</CardTitle></CardHeader>
        <CardBody className="p-0">
          <Table>
            <thead><tr><Th>{t('harvest.valueDate')}</Th><Th>{t('fin.amount')}</Th><Th>{t('facility.bankReference')}</Th><Th>{t('harvest.invoiceRef')}</Th><Th>{t('common.status')}</Th></tr></thead>
            <tbody>{(receipts.data?.data ?? []).map((r) => <tr key={r.id}><Td>{formatDate(r.valueDate)}</Td><Td>{formatXof(r.amountXof)}</Td><Td>{r.bankReference}</Td><Td>{r.invoiceRef ?? '—'}</Td><Td><Badge data-testid={`receipt-${r.bankReference}`}>{t(`harvest.receiptStatus.${r.status}`)}</Badge></Td></tr>)}</tbody>
          </Table>
        </CardBody>
      </Card>
    </>
  );
}
