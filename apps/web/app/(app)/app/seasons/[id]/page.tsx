'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, use, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { ifMatch, useAction } from '@/lib/hooks';
import { formatDate } from '@/lib/utils';
import { Alert, Badge, Button, Input, PageHeader, Spinner } from '@/components/ui';
import { PlanTab } from '@/components/seasons/plan-tab';
import { BudgetTab } from '@/components/seasons/budget-tab';
import { ModelTab } from '@/components/seasons/model-tab';
import { ReadinessTab } from '@/components/seasons/readiness-tab';
import { DossierTab } from '@/components/seasons/dossier-tab';
import { FinancingTab } from '@/components/seasons/financing-tab';

const TABS = ['plan', 'budget', 'model', 'readiness', 'dossier', 'financing'] as const;

function SeasonInner({ id }: { id: string }) {
  const t = useTranslations();
  const { api } = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const sp = useSearchParams();
  const tab = (TABS as readonly string[]).includes(sp.get('tab') ?? '') ? (sp.get('tab') as (typeof TABS)[number]) : 'plan';
  const { busy, msg, run } = useAction();
  const [selfFinanced, setSelfFinanced] = useState(false);
  const [reason, setReason] = useState('');
  const season = useQuery({ queryKey: ['season', id], queryFn: () => unwrap(api.GET('/v1/seasons/{id}', { params: { path: { id } } })) });
  if (season.isLoading || !season.data) return <Spinner />;
  const s = season.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ['season', id] });
  return (
    <>
      <PageHeader
        title={s.name}
        subtitle={<span className="flex flex-wrap items-center gap-2">{t(`seasons.kinds.${s.kind}`)} · {formatDate(s.startDate)} → {formatDate(s.endDate)} <Badge tone="blue" data-testid="season-status">{t(`seasons.status.${s.status}`)}</Badge></span>}
        actions={<Link href={`/app/blocks/${s.blockId}?tab=seasons`} className="text-sm text-brand-700">{t('common.back')}</Link>}
      />
      {msg && <Alert tone={msg.tone} className="mb-4">{msg.text}</Alert>}
      {(s.allowedActions.includes('start') || s.allowedActions.includes('cancel')) && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 bg-white p-3 text-sm">
          {s.allowedActions.includes('start') && (
            <>
              <label className="flex items-center gap-2"><input type="checkbox" checked={selfFinanced} onChange={(e) => setSelfFinanced(e.target.checked)} /> {t('seasons.selfFinanced')}</label>
              <Button size="sm" loading={busy === 'start'} onClick={() => run('start', async () => { await unwrap(api.POST('/v1/seasons/{id}/actions/start', { params: { path: { id } }, headers: ifMatch(s.version), body: { selfFinanced } })); await refresh(); })}>{t('seasons.start')}</Button>
            </>
          )}
          {s.allowedActions.includes('cancel') && (
            <span className="ml-auto flex items-center gap-2">
              <Input className="h-8 w-48" placeholder={t('seasons.reason')} aria-label={t('seasons.reason')} value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button size="sm" variant="ghost" disabled={reason.length < 3} onClick={() => run('cancel', async () => { await unwrap(api.POST('/v1/seasons/{id}/actions/cancel', { params: { path: { id } }, headers: ifMatch(s.version), body: { reason } })); await refresh(); })}>{t('seasons.cancel')}</Button>
            </span>
          )}
        </div>
      )}
      <nav className="mb-6 flex gap-1 border-b border-neutral-200" role="tablist">
        {TABS.map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => router.replace(`/app/seasons/${id}?tab=${k}`)} className={`border-b-2 px-3 py-2 text-sm ${tab === k ? 'border-brand-600 font-medium text-brand-700' : 'border-transparent text-neutral-600'}`}>
            {t(`seasons.tabs.${k}`)}
          </button>
        ))}
      </nav>
      {tab === 'plan' && <PlanTab season={s} />}
      {tab === 'budget' && <BudgetTab season={s} />}
      {tab === 'model' && <ModelTab season={s} />}
      {tab === 'readiness' && <ReadinessTab season={s} />}
      {tab === 'dossier' && <DossierTab season={s} />}
      {tab === 'financing' && <FinancingTab season={s} />}
    </>
  );
}

export default function SeasonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense>
      <SeasonInner id={id} />
    </Suspense>
  );
}
