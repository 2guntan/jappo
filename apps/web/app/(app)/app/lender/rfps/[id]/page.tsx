'use client';

import Link from 'next/link';
import { use, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap, type Schemas } from '@jappo/sdk';
import { RATE_METHODS, REPAYMENT_PROFILES, SECURITY_CODES } from '@jappo/contracts';
import { useSession } from '@/lib/session';
import { ifMatch, useAction } from '@/lib/hooks';
import { formatDateTime, formatXof } from '@/lib/utils';
import { BlockMap } from '@/components/map';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, Field, Input, PageHeader, Select, Spinner, Table, Td, Textarea, Th } from '@/components/ui';
import { QaPanel } from '@/components/rfp/qa';

type Snapshot = {
  block?: { name: string; areaHa: number; region: string; commune: string | null; tenureType: string; boundary: unknown; plots: { code: string; geometry: unknown }[] };
  farmers?: { count: number; women: number; youth: number; walletVerified: number; netIncomeAvgXof: number };
  plan?: { crop?: { fr: string; en: string }; areaHa: number; yieldBaseTHa: number; priceXofPerKgBase: number }[];
  offtake?: { ref: string; buyer: string; minVolumeKg: number; priceXofPerKg: number; status: string; paysIntoEscrow: boolean }[];
  model?: { scenarios: Record<string, { grossRevenueXof: number; seasonalDebtDueXof: number; hcr: number | null }> };
};

function BidForm({ rfp, tranche, existing }: { rfp: Schemas['Rfp']; tranche: Schemas['Tranche']; existing?: Schemas['Bid'] }) {
  const t = useTranslations();
  const { api, hasPermission } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const [v, setV] = useState({
    amountXof: String(existing?.amountXof ?? tranche.amountXof),
    rateBps: String(existing?.rateBps ?? 1800),
    rateMethod: existing?.rateMethod ?? 'flat',
    upfrontFeeBps: String(existing?.upfrontFeeBps ?? 100),
    tenorMonths: String(existing?.tenorMonths ?? tranche.requestedTenorMonths),
    graceMonths: String(existing?.graceMonths ?? 0),
    repaymentProfile: existing?.repaymentProfile ?? tranche.repaymentProfile,
    daysToDisbursement: String(existing?.daysToDisbursement ?? 10),
    validUntil: existing?.validUntil ?? new Date(Date.now() + 120 * 86400_000).toISOString().slice(0, 10),
    security: existing?.securityRequirements ?? (['escrow_domiciliation'] as string[]),
    cps: (existing?.conditionsPrecedent ?? []).join('\n'),
    cashCollateralPct: String(existing?.cashCollateralPct ?? 0),
    acceptsPartial: existing?.acceptsPartial ?? true,
    comments: existing?.comments ?? '',
  });
  const [preview, setPreview] = useState<Schemas['BidPreview'] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const terms = { amountXof: Number(v.amountXof), rateBps: Number(v.rateBps), rateMethod: v.rateMethod as 'flat', upfrontFeeBps: Number(v.upfrontFeeBps), tenorMonths: Number(v.tenorMonths), graceMonths: Number(v.graceMonths), graceType: 'interest_only' as const, repaymentProfile: v.repaymentProfile as 'bullet' };
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (terms.amountXof > 0 && terms.tenorMonths > 0) unwrap(api.POST('/v1/bids/preview', { body: terms })).then(setPreview).catch(() => setPreview(null));
    }, 300);
  }, [v.amountXof, v.rateBps, v.rateMethod, v.upfrontFeeBps, v.tenorMonths, v.graceMonths, v.repaymentProfile]);
  const editable = !existing || existing.status === 'draft';
  const body = { ...terms, daysToDisbursement: Number(v.daysToDisbursement), validUntil: v.validUntil, securityRequirements: v.security as (typeof SECURITY_CODES)[number][], conditionsPrecedent: v.cps.split('\n').map((x) => x.trim()).filter((x) => x.length >= 2), cashCollateralPct: Number(v.cashCollateralPct), acceptsPartial: v.acceptsPartial, comments: v.comments || null };
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['my-bids', rfp.id] }), qc.invalidateQueries({ queryKey: ['lender-rfp', rfp.id] })]);
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{t('lender.bid')} · {t(`fin.trancheTypes.${tranche.type}`)} · {formatXof(tranche.amountXof)}</CardTitle>
        {existing && <Badge tone={existing.status === 'submitted' ? 'green' : 'neutral'} data-testid={`bid-status-${tranche.type}`}>{t(`lender.bidStatus.${existing.status}`)}</Badge>}
      </CardHeader>
      <CardBody className="space-y-4">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <fieldset disabled={!editable} className="grid gap-3 sm:grid-cols-3">
          <Field label={t('fin.amount')} htmlFor={`b-amt-${tranche.id}`}><Input id={`b-amt-${tranche.id}`} type="number" value={v.amountXof} onChange={(e) => setV({ ...v, amountXof: e.target.value })} /></Field>
          <Field label={t('lender.rate')} htmlFor={`b-rate-${tranche.id}`}><Input id={`b-rate-${tranche.id}`} type="number" value={v.rateBps} onChange={(e) => setV({ ...v, rateBps: e.target.value })} /></Field>
          <Field label={t('lender.method')} htmlFor={`b-method-${tranche.id}`}><Select id={`b-method-${tranche.id}`} value={v.rateMethod} onChange={(e) => setV({ ...v, rateMethod: e.target.value as 'flat' })}>{RATE_METHODS.map((m) => <option key={m} value={m}>{t(`model.methods.${m}`)}</option>)}</Select></Field>
          <Field label={t('lender.fee')} htmlFor={`b-fee-${tranche.id}`}><Input id={`b-fee-${tranche.id}`} type="number" value={v.upfrontFeeBps} onChange={(e) => setV({ ...v, upfrontFeeBps: e.target.value })} /></Field>
          <Field label={t('fin.tenor')} htmlFor={`b-tenor-${tranche.id}`}><Input id={`b-tenor-${tranche.id}`} type="number" value={v.tenorMonths} onChange={(e) => setV({ ...v, tenorMonths: e.target.value })} /></Field>
          <Field label={t('fin.profile')} htmlFor={`b-prof-${tranche.id}`}><Select id={`b-prof-${tranche.id}`} value={v.repaymentProfile} onChange={(e) => setV({ ...v, repaymentProfile: e.target.value as 'bullet' })}>{REPAYMENT_PROFILES.map((m) => <option key={m} value={m}>{t(`model.profiles.${m}`)}</option>)}</Select></Field>
          <Field label={t('lender.days')} htmlFor={`b-days-${tranche.id}`}><Input id={`b-days-${tranche.id}`} type="number" value={v.daysToDisbursement} onChange={(e) => setV({ ...v, daysToDisbursement: e.target.value })} /></Field>
          <Field label={t('lender.validUntil')} htmlFor={`b-valid-${tranche.id}`}><Input id={`b-valid-${tranche.id}`} type="date" value={v.validUntil} onChange={(e) => setV({ ...v, validUntil: e.target.value })} /></Field>
          <Field label={t('lender.cashCollateral')} htmlFor={`b-cc-${tranche.id}`}><Input id={`b-cc-${tranche.id}`} type="number" value={v.cashCollateralPct} onChange={(e) => setV({ ...v, cashCollateralPct: e.target.value })} /></Field>
          <fieldset className="sm:col-span-3">
            <legend className="text-sm font-medium">{t('lender.security')}</legend>
            <div className="mt-1 flex flex-wrap gap-3 text-xs">{SECURITY_CODES.map((c) => <label key={c} className="flex items-center gap-1"><input type="checkbox" checked={v.security.includes(c)} onChange={(e) => setV({ ...v, security: e.target.checked ? [...v.security, c] : v.security.filter((x) => x !== c) })} />{c}</label>)}</div>
          </fieldset>
          <div className="sm:col-span-3"><Field label={t('lender.cps')} htmlFor={`b-cps-${tranche.id}`}><Textarea id={`b-cps-${tranche.id}`} value={v.cps} onChange={(e) => setV({ ...v, cps: e.target.value })} /></Field></div>
          <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" checked={v.acceptsPartial} onChange={(e) => setV({ ...v, acceptsPartial: e.target.checked })} />{t('lender.partial')}</label>
        </fieldset>
        {preview && (
          <div className="rounded-md bg-brand-50 p-3 text-sm">
            <p>{t('lender.earLive')} : <strong data-testid={`ear-live-${tranche.type}`}>{preview.earBps}</strong> bps · {t('lender.interest')} {formatXof(preview.totalInterestXof)} · {t('lender.fee')} {formatXof(preview.upfrontFeeXof)}</p>
            <details className="mt-2"><summary className="cursor-pointer text-brand-700">{t('lender.schedule')}</summary>
              <Table><thead><tr><Th>#</Th><Th>M</Th><Th>{t('lender.principal')}</Th><Th>{t('lender.interest')}</Th><Th>{t('lender.totalDue')}</Th></tr></thead><tbody>{preview.schedule.map((l) => <tr key={l.seq}><Td>{l.seq}</Td><Td>{l.month}</Td><Td>{formatXof(l.principalXof)}</Td><Td>{formatXof(l.interestXof)}</Td><Td>{formatXof(l.totalXof)}</Td></tr>)}</tbody></Table>
            </details>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {editable && hasPermission('bid:draft') && (
            <Button variant="secondary" loading={busy === 'save'} onClick={() => run('save', async () => {
              if (existing) await unwrap(api.PATCH('/v1/bids/{id}', { params: { path: { id: existing.id } }, headers: ifMatch(existing.version), body }));
              else await unwrap(api.POST('/v1/rfps/{id}/bids', { params: { path: { id: rfp.id } }, body: { ...body, trancheId: tranche.id } }));
              await refresh();
            }, t('common.saved'))}>{t('lender.saveDraft')}</Button>
          )}
          {existing?.allowedActions.includes('submit') && <Button loading={busy === 'submit'} onClick={() => run('submit', async () => { await unwrap(api.POST('/v1/bids/{id}/actions/submit', { params: { path: { id: existing.id } }, headers: ifMatch(existing.version) })); await refresh(); })}>{t('lender.submitBid')}</Button>}
          {existing?.allowedActions.includes('withdraw') && <Button variant="ghost" loading={busy === 'withdraw'} onClick={() => run('withdraw', async () => { await unwrap(api.POST('/v1/bids/{id}/actions/withdraw', { params: { path: { id: existing.id } }, headers: ifMatch(existing.version) })); await refresh(); })}>{t('lender.withdraw')}</Button>}
        </div>
      </CardBody>
    </Card>
  );
}

export default function LenderRfpPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations();
  const { api } = useSession();
  const qc = useQueryClient();
  const { msg, run } = useAction();
  const [declineReason, setDeclineReason] = useState('');
  const rfp = useQuery({ queryKey: ['lender-rfp', id], queryFn: () => unwrap(api.GET('/v1/rfps/{id}', { params: { path: { id } } })) });
  const dossier = useQuery({ queryKey: ['dossier', rfp.data?.dossierId], enabled: !!rfp.data, queryFn: () => unwrap(api.GET('/v1/dossiers/{id}', { params: { path: { id: rfp.data!.dossierId } } })) });
  const myBids = useQuery({ queryKey: ['my-bids', id], enabled: !!rfp.data, queryFn: () => unwrap(api.GET('/v1/rfps/{id}/bids', { params: { path: { id } } })) });
  const viewed = useRef(false);
  useEffect(() => {
    if (rfp.data?.myInvitation?.status === 'invited' && !viewed.current) {
      viewed.current = true;
      void unwrap(api.POST('/v1/rfps/{id}/actions/view', { params: { path: { id } }, body: {} })).then(() => qc.invalidateQueries({ queryKey: ['lender-rfp', id] }));
    }
  }, [rfp.data, api, id, qc]);
  if (rfp.isLoading || !rfp.data) return <Spinner />;
  const r = rfp.data;
  const snap = (dossier.data?.snapshot ?? {}) as Snapshot;
  const open = async (url: Promise<{ url: string }>) => window.open((await url).url, '_blank', 'noopener');
  const mapFeatures = snap.block ? [{ type: 'Feature' as const, geometry: snap.block.boundary as never, properties: { kind: 'boundary' } }, ...snap.block.plots.map((p) => ({ type: 'Feature' as const, geometry: p.geometry as never, properties: { kind: 'plot', code: p.code, status: 'allocated' } }))] : [];
  return (
    <>
      <PageHeader
        title={`${r.ref} · ${r.blockName}`}
        subtitle={<span className="flex flex-wrap items-center gap-2">{r.operatorName} · {r.dossierRef} <Badge tone={r.grade === 'A' ? 'green' : 'amber'}>{r.grade} · {r.readinessScore}/100</Badge> <Badge tone="blue">{t(`rfp.status.${r.status}`)}</Badge> · {t('rfp.deadline')} {formatDateTime(r.deadlineAt)}</span>}
        actions={<Link href="/app/lender/opportunities" className="text-sm text-brand-700">{t('common.back')}</Link>}
      />
      {msg && <Alert tone={msg.tone} className="mb-4">{msg.text}</Alert>}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader className="flex items-center justify-between"><CardTitle>{t('lender.dossier')}</CardTitle>{dossier.data?.pdfFileId && <Button size="sm" variant="secondary" onClick={() => open(unwrap(api.GET('/v1/dossiers/{id}/pdf', { params: { path: { id: r.dossierId } } })))}>{t('dossier.download')}</Button>}</CardHeader>
            <CardBody className="space-y-4 text-sm">
              {snap.block && <p>{snap.block.name} · {snap.block.commune}, {snap.block.region} · {snap.block.areaHa.toFixed(2)} ha · {snap.block.tenureType}</p>}
              {snap.farmers && <p>{t('blocks.farmers')} : {snap.farmers.count} ({t('blocks.women')} {snap.farmers.women}) · Wave/OM {snap.farmers.walletVerified}/{snap.farmers.count} · {t('model.net')} ~ {formatXof(snap.farmers.netIncomeAvgXof)}</p>}
              <BlockMap features={mapFeatures as never} height={260} />
              {snap.model && (
                <Table>
                  <thead><tr><Th>{t('model.scenario')}</Th><Th>{t('model.revenue')}</Th><Th>{t('model.debt')}</Th><Th>{t('model.hcr')}</Th></tr></thead>
                  <tbody>{Object.entries(snap.model.scenarios).map(([k, b]) => <tr key={k}><Td>{t(`model.scenarios.${k}` as 'model.scenarios.base')}</Td><Td>{formatXof(b.grossRevenueXof)}</Td><Td>{formatXof(b.seasonalDebtDueXof)}</Td><Td>{b.hcr}</Td></tr>)}</tbody>
                </Table>
              )}
              {snap.offtake && snap.offtake.length > 0 && <p>{snap.offtake.map((o) => `${o.ref} · ${o.buyer} · ${o.minVolumeKg.toLocaleString('fr-SN')} kg · ${formatXof(o.priceXofPerKg)}/kg · ${o.status}${o.paysIntoEscrow ? ' · escrow' : ''}`).join(' — ')}</p>}
              {dossier.data && (
                <div>
                  <p className="font-medium">{t('dossier.dataRoom')}</p>
                  <ul className="mt-1 space-y-1">{dossier.data.dataRoom.map((f) => <li key={f.fileId} className="flex justify-between"><span>{f.label}</span><Button size="sm" variant="ghost" onClick={() => open(unwrap(api.GET('/v1/files/{id}/signed-url', { params: { path: { id: f.fileId } } })))}>{t('common.open')}</Button></li>)}</ul>
                </div>
              )}
            </CardBody>
          </Card>
          {r.allowedActions.includes('bid') && r.tranches.map((tr) => <BidForm key={tr.id + (myBids.data?.data.find((b) => b.trancheId === tr.id && b.status !== 'withdrawn')?.version ?? 0)} rfp={r} tranche={tr} existing={myBids.data?.data.find((b) => b.trancheId === tr.id && b.status !== 'withdrawn')} />)}
          {!r.allowedActions.includes('bid') && myBids.data?.data.map((b) => <Card key={b.id}><CardBody className="text-sm">{formatXof(b.amountXof)} · {b.rateBps} bps · EAR {b.earBps} · <Badge>{t(`lender.bidStatus.${b.status}`)}</Badge></CardBody></Card>)}
          {r.allowedActions.includes('decline') && (
            <div className="flex gap-2">
              <Input className="w-64" placeholder={t('rfp.reason')} aria-label={t('rfp.reason')} value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} />
              <Button variant="ghost" disabled={!declineReason} onClick={() => run('decline', async () => { await unwrap(api.POST('/v1/rfps/{id}/actions/decline', { params: { path: { id } }, body: { reason: declineReason } })); await qc.invalidateQueries({ queryKey: ['lender-rfp', id] }); })}>{t('lender.decline')}</Button>
            </div>
          )}
        </div>
        <QaPanel rfpId={id} mode="lender" canAsk={r.allowedActions.includes('ask')} />
      </div>
    </>
  );
}
