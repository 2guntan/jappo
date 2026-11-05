'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { BlockMap } from '@/components/map';
import { Card, CardBody, CardHeader, CardTitle, Checklist, Stat } from '@/components/ui';
import type { BlockT } from './types';

export function OverviewTab({ block }: { block: BlockT }) {
  const t = useTranslations('blocks');
  const { api } = useSession();
  const map = useQuery({ queryKey: ['block-map', block.id], queryFn: () => unwrap(api.GET('/v1/blocks/{id}/map', { params: { path: { id: block.id } } })) });
  const s = block.stats;
  const steps = [
    { k: 'boundary', done: !!block.boundary, tab: 'land' },
    { k: 'docs', done: s.landDocsVerified > 0, tab: 'land' },
    { k: 'plots', done: s.plots > 0, tab: 'plots' },
    { k: 'allocate', done: s.farmers > 0, tab: 'plots' },
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <BlockMap features={(map.data?.features ?? []) as never} height={460} />
      </div>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Stat label={t('area')} value={<span data-testid="block-area">{block.areaHa === null ? '—' : `${block.areaHa.toFixed(2)} ha`}</span>} />
          <Stat label={t('plots')} value={<span data-testid="block-plots">{s.plots}</span>} />
          <Stat label={t('farmers')} value={<span data-testid="block-farmers">{s.farmers}</span>} />
          <Stat label={t('women')} value={s.womenFarmers} />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{t('nextActions')}</CardTitle>
          </CardHeader>
          <CardBody>
            <Checklist items={steps.map((st) => ({ key: st.k, label: t(`na.${st.k}`), done: st.done, href: `/app/blocks/${block.id}?tab=${st.tab}` }))} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
