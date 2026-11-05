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
import { ArrowLeft } from 'lucide-react';
import { Alert, Badge, Button, Checkbox, Input, PageHeader, Spinner, Tabs } from '@/components/ui';
import { PlanTab } from '@/components/seasons/plan-tab';
import { BudgetTab } from '@/components/seasons/budget-tab';
import { ModelTab } from '@/components/seasons/model-tab';
import { ReadinessTab } from '@/components/seasons/readiness-tab';
import { DossierTab } from '@/components/seasons/dossier-tab';
import { FinancingTab } from '@/components/seasons/financing-tab';
import { OperationsTab } from '@/components/seasons/operations-tab';
import { HarvestTab } from '@/components/seasons/harvest-tab';

const TABS = ['plan', 'budget', 'model', 'readiness', 'dossier', 'financing', 'operations', 'harvest'] as const;

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
        eyebrow={
          <Link href={`/app/blocks/${s.blockId}?tab=seasons`} className="inline-flex items-center gap-1 normal-case tracking-normal text-neutral-500 hover:text-neutral-900">
            <ArrowLeft className="size-3.5" aria-hidden />
            {t('common.back')}
          </Link>
        }
        title={s.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{t(`seasons.kinds.${s.kind}`)}</span>
            <span className="text-neutral-300">·</span>
            <span className="tabular-nums">{formatDate(s.startDate)} → {formatDate(s.endDate)}</span>
            <Badge tone="blue" data-testid="season-status">{t(`seasons.status.${s.status}`)}</Badge>
          </span>
        }
      />
      {msg && <Alert tone={msg.tone} className="mb-4">{msg.text}</Alert>}
      {(s.allowedActions.includes('start') || s.allowedActions.includes('cancel')) && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200/80 bg-white px-4 py-3 text-sm shadow-xs">
          {s.allowedActions.includes('start') && (
            <>
              <Checkbox label={t('seasons.selfFinanced')} checked={selfFinanced} onChange={(e) => setSelfFinanced(e.target.checked)} />
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
      <Tabs items={TABS.map((k) => ({ key: k, label: t(`seasons.tabs.${k}`) }))} value={tab} onChange={(k) => router.replace(`/app/seasons/${id}?tab=${k}`)} label={s.name} />
      {tab === 'plan' && <PlanTab season={s} />}
      {tab === 'budget' && <BudgetTab season={s} />}
      {tab === 'model' && <ModelTab season={s} />}
      {tab === 'readiness' && <ReadinessTab season={s} />}
      {tab === 'dossier' && <DossierTab season={s} />}
      {tab === 'financing' && <FinancingTab season={s} />}
      {tab === 'operations' && <OperationsTab season={s} />}
      {tab === 'harvest' && <HarvestTab season={s} />}
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
