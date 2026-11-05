'use client';

import { AlertsTab } from '@/components/blocks/alerts-tab';
import { MonitoringTab } from '@/components/blocks/monitoring-tab';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { statusTone } from '@/lib/utils';
import { Badge, PageHeader, Spinner, Tabs } from '@/components/ui';
import { OverviewTab } from '@/components/blocks/overview-tab';
import { LandTab } from '@/components/blocks/land-tab';
import { PlotsTab } from '@/components/blocks/plots-tab';
import { BlockFarmersTab } from '@/components/blocks/farmers-tab';
import { AssetsTab, CommunityTab } from '@/components/blocks/assets-community';
import { SeasonsTab } from '@/components/blocks/seasons-tab';
import { OfftakeTab } from '@/components/blocks/offtake-tab';
import { InvestmentTab } from '@/components/blocks/investment-tab';
import { RiskTab } from '@/components/blocks/risk-tab';

const TABS = ['overview', 'land', 'plots', 'farmers', 'seasons', 'offtake', 'investment', 'risk', 'alerts', 'monitoring', 'assets', 'community'] as const;
type Tab = (typeof TABS)[number];

function BlockInner({ id }: { id: string }) {
  const t = useTranslations();
  const { api } = useSession();
  const router = useRouter();
  const sp = useSearchParams();
  const tab = (TABS as readonly string[]).includes(sp.get('tab') ?? '') ? (sp.get('tab') as Tab) : 'overview';
  const block = useQuery({ queryKey: ['block', id], queryFn: () => unwrap(api.GET('/v1/blocks/{id}', { params: { path: { id } } })) });
  if (block.isLoading) return <Spinner />;
  if (!block.data) return <p>{t('errors.UNKNOWN')}</p>;
  const b = block.data;
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/app/blocks" className="inline-flex items-center gap-1 normal-case tracking-normal text-neutral-500 hover:text-neutral-900">
            <ArrowLeft className="size-3.5" aria-hidden />
            {t('blocks.title')}
          </Link>
        }
        title={b.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-neutral-700">{b.ref}</span>
            <span className="text-neutral-300">·</span>
            <span>{[b.village, b.commune, b.region].filter(Boolean).join(', ')}</span>
            <Badge tone={statusTone(b.status)} data-testid="block-status">{t(`blockStatus.${b.status}`)}</Badge>
          </span>
        }
      />
      <Tabs items={TABS.map((k) => ({ key: k, label: t(`blocks.tabs.${k}`) }))} value={tab} onChange={(k) => router.replace(`/app/blocks/${id}?tab=${k}`)} label={b.name} />
      {tab === 'overview' && <OverviewTab block={b} />}
      {tab === 'alerts' && <AlertsTab block={b} />}
      {tab === 'monitoring' && <MonitoringTab block={b} />}
      {tab === 'land' && <LandTab block={b} />}
      {tab === 'plots' && <PlotsTab block={b} />}
      {tab === 'farmers' && <BlockFarmersTab block={b} />}
      {tab === 'seasons' && <SeasonsTab block={b} />}
      {tab === 'offtake' && <OfftakeTab block={b} />}
      {tab === 'investment' && <InvestmentTab block={b} />}
      {tab === 'risk' && <RiskTab block={b} />}
      {tab === 'assets' && <AssetsTab block={b} />}
      {tab === 'community' && <CommunityTab block={b} />}
    </>
  );
}

export default function BlockPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense>
      <BlockInner id={id} />
    </Suspense>
  );
}
