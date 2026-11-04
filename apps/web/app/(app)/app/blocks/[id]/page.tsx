'use client';

import { AlertsTab } from '@/components/blocks/alerts-tab';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { statusTone } from '@/lib/utils';
import { Badge, PageHeader, Spinner } from '@/components/ui';
import { OverviewTab } from '@/components/blocks/overview-tab';
import { LandTab } from '@/components/blocks/land-tab';
import { PlotsTab } from '@/components/blocks/plots-tab';
import { BlockFarmersTab } from '@/components/blocks/farmers-tab';
import { AssetsTab, CommunityTab } from '@/components/blocks/assets-community';
import { SeasonsTab } from '@/components/blocks/seasons-tab';
import { OfftakeTab } from '@/components/blocks/offtake-tab';
import { InvestmentTab } from '@/components/blocks/investment-tab';
import { RiskTab } from '@/components/blocks/risk-tab';

const TABS = ['overview', 'land', 'plots', 'farmers', 'seasons', 'offtake', 'investment', 'risk', 'alerts', 'assets', 'community'] as const;
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
        title={b.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{b.ref}</span>·<span>{[b.village, b.commune, b.region].filter(Boolean).join(', ')}</span>
            <Badge tone={statusTone(b.status)} data-testid="block-status">{t(`blockStatus.${b.status}`)}</Badge>
          </span>
        }
        actions={<Link href="/app/blocks" className="text-sm text-brand-700">{t('common.back')}</Link>}
      />
      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-neutral-200" role="tablist">
        {TABS.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => router.replace(`/app/blocks/${id}?tab=${k}`)}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${tab === k ? 'border-brand-600 font-medium text-brand-700' : 'border-transparent text-neutral-600 hover:text-neutral-900'}`}
          >
            {t(`blocks.tabs.${k}`)}
          </button>
        ))}
      </nav>
      {tab === 'overview' && <OverviewTab block={b} />}
      {tab === 'alerts' && <AlertsTab block={b} />}
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
