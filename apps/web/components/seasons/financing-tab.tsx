'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap, type Schemas } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { ifMatch, useAction } from '@/lib/hooks';
import { formatXof } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Table, Td, Th, buttonVariants } from '@/components/ui';

export function TrancheTable({ tranches }: { tranches: Schemas['Tranche'][] }) {
  const t = useTranslations();
  return (
    <Table>
      <thead><tr><Th>{t('fin.type')}</Th><Th>{t('fin.amount')}</Th><Th>{t('fin.tenor')}</Th><Th>{t('fin.profile')}</Th><Th>{t('fin.borrower')}</Th><Th>{t('fin.awarded')}</Th><Th>{t('common.status')}</Th></tr></thead>
      <tbody>
        {tranches.map((x) => (
          <tr key={x.id}>
            <Td className="font-medium">{t(`fin.trancheTypes.${x.type}`)}</Td>
            <Td data-testid={`tranche-amount-${x.type}`}>{formatXof(x.amountXof)}</Td>
            <Td>{x.requestedTenorMonths}</Td>
            <Td>{t(`model.profiles.${x.repaymentProfile}`)}</Td>
            <Td>{t(`model.borrowers.${x.borrowerType}`)}</Td>
            <Td>{formatXof(x.awardedXof)}</Td>
            <Td><Badge>{t(`fin.trancheStatus.${x.status}`)}</Badge></Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function FinancingTab({ season }: { season: Schemas['Season'] }) {
  const t = useTranslations();
  const { api } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const frs = useQuery({ queryKey: ['financing', season.id], queryFn: () => unwrap(api.GET('/v1/financing-requests', { params: { query: { seasonId: season.id } } })) });
  const dossiers = useQuery({ queryKey: ['dossiers', season.id], queryFn: () => unwrap(api.GET('/v1/seasons/{id}/dossiers', { params: { path: { id: season.id } } })) });
  const active = frs.data?.data.find((f) => f.status !== 'cancelled');
  const matches = useQuery({ queryKey: ['matches', active?.id], enabled: !!active && ['submitted', 'in_tender'].includes(active.status), queryFn: () => unwrap(api.GET('/v1/financing-requests/{id}/matches', { params: { path: { id: active!.id } } })) });
  const [deselected, setDeselected] = useState<string[]>([]);
  const frozen = dossiers.data?.data.find((d) => d.status === 'frozen');
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['financing', season.id] }), qc.invalidateQueries({ queryKey: ['season', season.id] })]);

  if (!active) {
    return (
      <div className="space-y-4">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <EmptyState
          title={t('fin.title')}
          description={frozen ? `${frozen.ref} · ${frozen.grade} · ${frozen.readinessScore}/100` : t('fin.needDossier')}
          action={frozen && frozen.allowedActions.includes('create_financing_request') ? <Button loading={busy === 'create'} onClick={() => run('create', async () => { await unwrap(api.POST('/v1/financing-requests', { body: { dossierId: frozen.id } })); await refresh(); })}>{t('fin.create')}</Button> : undefined}
        />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{active.ref} <Badge tone="blue" data-testid="fr-status">{t(`fin.status.${active.status}`)}</Badge></CardTitle>
          <div className="flex gap-2">
            {active.allowedActions.includes('submit') && <Button loading={busy === 'submit'} onClick={() => run('submit', async () => { await unwrap(api.POST('/v1/financing-requests/{id}/actions/submit', { params: { path: { id: active.id } }, headers: ifMatch(active.version) })); await refresh(); })}>{t('fin.submit')}</Button>}
            {active.allowedActions.includes('cancel') && <Button variant="ghost" loading={busy === 'cancel'} onClick={() => run('cancel', async () => { await unwrap(api.POST('/v1/financing-requests/{id}/actions/cancel', { params: { path: { id: active.id } }, headers: ifMatch(active.version), body: { reason: 'operator' } })); await refresh(); })}>{t('fin.cancel')}</Button>}
            {active.rfpId && <Link className={buttonVariants({ variant: 'secondary' })} href={`/app/rfps/${active.rfpId}`}>{t('fin.goRfp')}</Link>}
          </div>
        </CardHeader>
        <CardBody className="p-0"><TrancheTable tranches={active.tranches} /></CardBody>
      </Card>
      {['awarded', 'contracted'].includes(active.status) && <ContractsAndFacilities season={season} />}
      {matches.data && (
        <Card>
          <CardHeader><CardTitle>{t('fin.matches')}</CardTitle></CardHeader>
          <CardBody className="space-y-3">
            {matches.data.data.length === 0 ? <p className="text-sm text-neutral-600">{t('fin.noMatches')}</p> : (
              <ul className="space-y-2">
                {matches.data.data.map((m) => (
                  <li key={m.lenderOrgId} className="flex items-center gap-3 text-sm">
                    {active.allowedActions.includes('create_rfp') && <input type="checkbox" aria-label={`${t('fin.invite')} ${m.lenderName}`} checked={!deselected.includes(m.lenderOrgId)} onChange={(e) => setDeselected(e.target.checked ? deselected.filter((x) => x !== m.lenderOrgId) : [...deselected, m.lenderOrgId])} />}
                    <span className="font-medium">{m.lenderName}</span>
                    <span className="text-xs text-neutral-500">{m.profileName} · {m.reasons.join(', ')}</span>
                  </li>
                ))}
              </ul>
            )}
            {active.allowedActions.includes('create_rfp') && matches.data.data.length > 0 && (
              <Button
                loading={busy === 'rfp'}
                onClick={() => run('rfp', async () => {
                  const r = await unwrap(api.POST('/v1/rfps', { body: { financingRequestId: active.id, lenderOrgIds: matches.data!.data.map((m) => m.lenderOrgId).filter((x) => !deselected.includes(x)) } }));
                  await unwrap(api.POST('/v1/rfps/{id}/actions/open', { params: { path: { id: r.id } }, headers: ifMatch(r.version), body: {} }));
                  await refresh();
                  window.location.href = `/app/rfps/${r.id}`;
                })}
              >
                {t('fin.openRfp')}
              </Button>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function ContractsAndFacilities({ season }: { season: Schemas['Season'] }) {
  const t = useTranslations();
  const { api, hasPermission } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const facs = useQuery({ queryKey: ['facilities', season.id], queryFn: () => unwrap(api.GET('/v1/facilities', { params: { query: { seasonId: season.id } } })) });
  const cs = useQuery({ queryKey: ['contracts', season.id], queryFn: () => unwrap(api.GET('/v1/contracts', { params: { query: { seasonId: season.id } } })) });
  const contracts = cs.data?.data ?? [];
  const signed = contracts.filter((c) => c.status === 'signed').length;
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{t('contracts.packTitle')}</CardTitle>
        <div className="flex gap-2">
          {hasPermission('contract:manage') && (facs.data?.data.length ?? 0) > 0 && (
            <Button
              loading={busy === 'pack'}
              data-testid="generate-pack"
              onClick={() => run('pack', async () => {
                const r = await unwrap(api.POST('/v1/blocks/{id}/contracts/actions/generate-pack', { params: { path: { id: season.blockId } }, body: { seasonId: season.id, send: true } }));
                await qc.invalidateQueries({ queryKey: ['contracts'] });
                return r;
              }, t('contracts.packDone'))}
            >
              {t('contracts.generatePack')}
            </Button>
          )}
          <Link className={buttonVariants({ variant: 'secondary' })} href={`/app/contracts?seasonId=${season.id}`}>{t('contracts.title')}</Link>
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <p className="text-sm text-neutral-600" data-testid="pack-progress">{t('contracts.packProgress', { signed, total: contracts.length })}</p>
        <ul className="space-y-1 text-sm">
          {(facs.data?.data ?? []).map((f) => (
            <li key={f.id}>
              <Link className="font-medium text-brand-700 hover:underline" href={`/app/facilities/${f.id}`}>{f.ref}</Link> · {f.lenderName} · {formatXof(f.principalXof)} · <Badge>{t(`facility.status.${f.status}`)}</Badge>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
