'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap, type Schemas } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { ifMatch, useAction } from '@/lib/hooks';
import { formatDate, formatDateTime, formatXof } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, Field, Input, Select, Table, Td, Th } from '@/components/ui';

const tone = (s: string) => (({ recorded: 'blue', dispatched: 'green', rejected: 'red', void: 'neutral', in_transit: 'amber', accepted: 'green', partially_accepted: 'amber', issued: 'blue', partially_paid: 'amber', paid: 'green', overdue: 'red', disputed: 'red', confirmed: 'green' }) as Record<string, 'blue' | 'green' | 'red' | 'neutral' | 'amber'>)[s] ?? 'neutral';
const kgf = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${new Intl.NumberFormat('fr-SN', { maximumFractionDigits: 3 }).format(n)} kg`);

export function HarvestTab({ season }: { season: Schemas['Season'] }) {
  const t = useTranslations();
  const { api, hasPermission } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const plots = useQuery({ queryKey: ['plots', season.blockId], queryFn: () => unwrap(api.GET('/v1/blocks/{id}/plots', { params: { path: { id: season.blockId } } })) });
  const ocs = useQuery({ queryKey: ['offtake', season.blockId], queryFn: () => unwrap(api.GET('/v1/offtake-contracts', { params: { query: { blockId: season.blockId } } })) });
  const tickets = useQuery({ queryKey: ['harvest', season.id], queryFn: () => unwrap(api.GET('/v1/seasons/{id}/harvest-deliveries', { params: { path: { id: season.id } } })) });
  const disp = useQuery({ queryKey: ['dispatches', season.id], queryFn: () => unwrap(api.GET('/v1/seasons/{id}/dispatches', { params: { path: { id: season.id } } })) });
  const invs = useQuery({ queryKey: ['invoices', season.id], queryFn: () => unwrap(api.GET('/v1/buyer-invoices', { params: { query: { seasonId: season.id } } })) });
  const runs = useQuery({ queryKey: ['settlement-runs', season.id], queryFn: () => unwrap(api.GET('/v1/seasons/{id}/settlement-runs', { params: { path: { id: season.id } } })) });
  const receipts = useQuery({ queryKey: ['receipts', season.blockId], queryFn: () => unwrap(api.GET('/v1/escrow-receipts', { params: { query: { blockId: season.blockId } } })) });
  const [w, setW] = useState({ plotId: '', farmerId: '', grossKg: '', tareKg: '0', moisturePct: '', grade: '' });
  const [sel, setSel] = useState<string[]>([]);
  const [selD, setSelD] = useState<string[]>([]);
  const [ocId, setOcId] = useState('');
  const [vehicle, setVehicle] = useState('');
  const refresh = () => Promise.all(['harvest', 'dispatches', 'invoices'].map((k) => qc.invalidateQueries({ queryKey: [k, season.id] })));
  const allPlots = plots.data?.data ?? [];
  const plot = allPlots.find((p) => p.id === w.plotId);
  const signed = (ocs.data?.data ?? []).filter((o) => o.status === 'signed');
  const grades = [...new Set(signed.flatMap((o) => o.qualitySpec.map((g) => g.grade)))];
  const net = Number(w.grossKg || 0) - Number(w.tareKg || 0);
  const recorded = (tickets.data?.data ?? []).filter((x) => x.status === 'recorded');
  const totalNet = (tickets.data?.data ?? []).filter((x) => x.status !== 'void').reduce((s, x) => s + x.netKg, 0);

  return (
    <div className="space-y-6">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <CardHeader className="flex items-center justify-between"><CardTitle>{t('harvest.tickets')}</CardTitle><span className="text-sm text-neutral-600" data-testid="harvest-total">{kgf(totalNet)}</span></CardHeader>
        <CardBody className="p-0">
          {hasPermission('harvest:record') && (
            <div className="grid gap-3 border-b border-neutral-100 p-5 sm:grid-cols-4">
              <Field label={t('ops.plot')} htmlFor="h-plot">
                <Select id="h-plot" value={w.plotId} onChange={(e) => { const p = allPlots.find((x) => x.id === e.target.value); setW({ ...w, plotId: e.target.value, farmerId: p?.farmers[0]?.farmerId ?? '' }); }}>
                  <option value="">—</option>
                  {allPlots.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
                </Select>
              </Field>
              <Field label={t('ops.farmer')} htmlFor="h-farmer">
                <Select id="h-farmer" value={w.farmerId} onChange={(e) => setW({ ...w, farmerId: e.target.value })}>
                  <option value="">—</option>
                  {(plot?.farmers ?? []).map((f) => <option key={f.farmerId} value={f.farmerId}>{f.name}</option>)}
                </Select>
              </Field>
              <Field label={t('harvest.gross')} htmlFor="h-gross"><Input id="h-gross" inputMode="decimal" value={w.grossKg} onChange={(e) => setW({ ...w, grossKg: e.target.value })} /></Field>
              <Field label={t('harvest.tare')} htmlFor="h-tare"><Input id="h-tare" inputMode="decimal" value={w.tareKg} onChange={(e) => setW({ ...w, tareKg: e.target.value })} /></Field>
              <Field label={t('harvest.moisture')} htmlFor="h-moist"><Input id="h-moist" inputMode="decimal" value={w.moisturePct} onChange={(e) => setW({ ...w, moisturePct: e.target.value })} /></Field>
              <Field label={t('harvest.grade')} htmlFor="h-grade">
                {grades.length ? (
                  <Select id="h-grade" value={w.grade} onChange={(e) => setW({ ...w, grade: e.target.value })}><option value="">—</option>{grades.map((g) => <option key={g} value={g}>{g}</option>)}</Select>
                ) : <Input id="h-grade" value={w.grade} onChange={(e) => setW({ ...w, grade: e.target.value })} />}
              </Field>
              <p className="self-end text-sm">{t('harvest.net')} : <strong data-testid="net-preview">{kgf(net > 0 ? net : 0)}</strong></p>
              <div className="flex items-end">
                <Button disabled={!w.plotId || !w.farmerId || net <= 0 || !w.grade} loading={busy === 'weigh'} onClick={() => run('weigh', async () => {
                  const r = await unwrap(api.POST('/v1/seasons/{id}/harvest-deliveries', { params: { path: { id: season.id } }, body: { plotId: w.plotId, farmerId: w.farmerId, grossKg: Number(w.grossKg), tareKg: Number(w.tareKg || 0), moisturePct: w.moisturePct ? Number(w.moisturePct) : null, grade: w.grade } }));
                  setW({ ...w, grossKg: '', moisturePct: '' });
                  await refresh();
                  await qc.invalidateQueries({ queryKey: ['season', season.id] });
                  return r;
                }, t('harvest.recorded'))}>{t('harvest.weigh')}</Button>
              </div>
            </div>
          )}
          <Table>
            <thead><tr><Th /><Th>{t('harvest.ticket')}</Th><Th>{t('ops.plot')}</Th><Th>{t('ops.farmer')}</Th><Th>{t('harvest.net')}</Th><Th>{t('harvest.grade')}</Th><Th>{t('ops.deliveredAt')}</Th><Th>{t('common.status')}</Th><Th /></tr></thead>
            <tbody>
              {(tickets.data?.data ?? []).map((x) => (
                <tr key={x.id}>
                  <Td>{x.status === 'recorded' && <input type="checkbox" aria-label={`${t('harvest.select')} ${x.ticketNo}`} checked={sel.includes(x.id)} onChange={(e) => setSel(e.target.checked ? [...sel, x.id] : sel.filter((y) => y !== x.id))} />}</Td>
                  <Td className="font-medium">{x.ticketNo}</Td><Td>{x.plotCode}</Td><Td>{x.farmerCode}</Td><Td>{kgf(x.netKg)}</Td><Td>{x.grade}</Td><Td>{formatDateTime(x.deliveredAt)}</Td>
                  <Td><Badge tone={tone(x.status)}>{t(`harvest.ticketStatus.${x.status}`)}</Badge></Td>
                  <Td>{x.status === 'recorded' && hasPermission('harvest:record') && <Button size="sm" variant="ghost" onClick={() => { const reason = window.prompt(t('rfp.reason')); if (reason) void run('void', async () => { await unwrap(api.POST('/v1/harvest-deliveries/{id}/actions/void', { params: { path: { id: x.id } }, headers: ifMatch(x.version), body: { reason } })); await refresh(); }); }}>{t('harvest.void')}</Button>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {hasPermission('dispatch:create') && recorded.length > 0 && (
            <div className="flex flex-wrap items-end gap-3 border-t border-neutral-100 p-5">
              <Field label={t('harvest.offtake')} htmlFor="d-oc">
                <Select id="d-oc" value={ocId} onChange={(e) => setOcId(e.target.value)}><option value="">—</option>{signed.map((o) => <option key={o.id} value={o.id}>{o.ref} · {o.buyerName}</option>)}</Select>
              </Field>
              <Field label={t('harvest.vehicle')} htmlFor="d-vehicle"><Input id="d-vehicle" value={vehicle} onChange={(e) => setVehicle(e.target.value)} /></Field>
              <Button disabled={!ocId || !sel.length} loading={busy === 'dispatch'} onClick={() => run('dispatch', async () => { await unwrap(api.POST('/v1/seasons/{id}/dispatches', { params: { path: { id: season.id } }, body: { offtakeContractId: ocId, deliveryIds: sel, vehicle: vehicle || null } })); setSel([]); await refresh(); })}>
                {t('harvest.dispatch', { count: sel.length })}
              </Button>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('harvest.dispatches')}</CardTitle></CardHeader>
        <CardBody className="p-0">
          <Table>
            <thead><tr><Th /><Th>{t('contracts.ref')}</Th><Th>{t('harvest.buyer')}</Th><Th>{t('harvest.net')}</Th><Th>{t('harvest.accepted')}</Th><Th>{t('harvest.rejected')}</Th><Th>{t('common.status')}</Th></tr></thead>
            <tbody>
              {(disp.data?.data ?? []).map((d) => (
                <tr key={d.id}>
                  <Td>{d.allowedActions.includes('invoice') && <input type="checkbox" aria-label={`${t('harvest.select')} ${d.ref}`} checked={selD.includes(d.id)} onChange={(e) => setSelD(e.target.checked ? [...selD, d.id] : selD.filter((y) => y !== d.id))} />}</Td>
                  <Td className="font-medium">{d.ref}<span className="block text-xs text-neutral-500">{d.vehicle ?? ''}</span></Td><Td>{d.buyerName}</Td><Td>{kgf(d.netKgTotal)}</Td><Td>{kgf(d.buyerAcceptedKg)}</Td><Td>{kgf(d.buyerRejectedKg)}{d.buyerComment && <span className="block text-xs text-neutral-500">{d.buyerComment}</span>}</Td>
                  <Td><Badge tone={tone(d.status)} data-testid={`dispatch-status-${d.ref}`}>{t(`harvest.dispatchStatus.${d.status}`)}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {hasPermission('buyer_invoice:create') && selD.length > 0 && (
            <div className="border-t border-neutral-100 p-5">
              <Button loading={busy === 'inv'} onClick={() => run('inv', async () => { await unwrap(api.POST('/v1/buyer-invoices', { body: { dispatchIds: selD } })); setSelD([]); await refresh(); })}>{t('harvest.invoice', { count: selD.length })}</Button>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('harvest.invoices')}</CardTitle></CardHeader>
        <CardBody className="p-0">
          <Table>
            <thead><tr><Th>{t('contracts.ref')}</Th><Th>{t('harvest.buyer')}</Th><Th>{t('harvest.accepted')}</Th><Th>{t('fin.amount')}</Th><Th>{t('harvest.paid')}</Th><Th>{t('facility.dueDate')}</Th><Th>{t('common.status')}</Th><Th /></tr></thead>
            <tbody>
              {(invs.data?.data ?? []).map((i) => (
                <tr key={i.id}>
                  <Td className="font-medium">{i.ref}</Td><Td>{i.buyerName}</Td><Td>{kgf(i.acceptedKg)}</Td><Td data-testid={`invoice-amount-${i.ref}`}>{formatXof(i.amountXof)}</Td><Td>{formatXof(i.paidXof)}</Td><Td>{formatDate(i.dueDate)}</Td>
                  <Td><Badge tone={tone(i.status)} data-testid={`invoice-status-${i.ref}`}>{t(`harvest.invoiceStatus.${i.status}`)}</Badge></Td>
                  <Td>{i.hasPdf && <Button size="sm" variant="ghost" onClick={() => run('pdf', async () => { const r = await unwrap(api.GET('/v1/buyer-invoices/{id}/pdf', { params: { path: { id: i.id } } })); window.open(r.url, '_blank', 'noopener'); })}>PDF</Button>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle>{t('settlement.title')}</CardTitle>
          {hasPermission('settlement:compute') && !(runs.data?.data.length) && (
            <Button loading={busy === 'stl'} data-testid="compute-settlement" onClick={() => run('stl', async () => { const r = await unwrap(api.POST('/v1/seasons/{id}/settlement-runs', { params: { path: { id: season.id } } })); window.location.href = `/app/settlements/${r.id}`; })}>{t('settlement.compute')}</Button>
          )}
        </CardHeader>
        <CardBody className="text-sm">
          {(runs.data?.data ?? []).length === 0 ? <p className="text-neutral-600">{t('settlement.computeHint')}</p> : runs.data!.data.map((r) => <a key={r.id} className="text-brand-700 hover:underline" href={`/app/settlements/${r.id}`}>{r.ref} · {t(`settlement.status.${r.status}`)}</a>)}
        </CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t('harvest.receipts')}</CardTitle></CardHeader>
        <CardBody className="p-0">
          <Table>
            <thead><tr><Th>{t('harvest.valueDate')}</Th><Th>{t('harvest.payer')}</Th><Th>{t('fin.amount')}</Th><Th>{t('facility.bankReference')}</Th><Th>{t('harvest.invoiceRef')}</Th><Th>{t('common.status')}</Th></tr></thead>
            <tbody>
              {(receipts.data?.data ?? []).map((r) => (
                <tr key={r.id}><Td>{formatDate(r.valueDate)}</Td><Td>{r.payerName}</Td><Td>{formatXof(r.amountXof)}</Td><Td>{r.bankReference}</Td><Td>{r.invoiceRef ?? '—'}</Td><Td><Badge tone={tone(r.status)}>{t(`harvest.receiptStatus.${r.status}`)}</Badge></Td></tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}
