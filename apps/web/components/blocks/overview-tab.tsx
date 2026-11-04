'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Circle } from 'lucide-react';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { BlockMap } from '@/components/map';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui';
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
        <BlockMap features={(map.data?.features ?? []) as never} />
      </div>
      <div className="space-y-4">
        <Card>
          <CardBody className="grid grid-cols-2 gap-4 text-sm">
            <div><p className="text-neutral-500">{t('area')}</p><p className="text-xl font-semibold" data-testid="block-area">{block.areaHa === null ? '—' : `${block.areaHa.toFixed(2)} ha`}</p></div>
            <div><p className="text-neutral-500">{t('plots')}</p><p className="text-xl font-semibold" data-testid="block-plots">{s.plots}</p></div>
            <div><p className="text-neutral-500">{t('farmers')}</p><p className="text-xl font-semibold" data-testid="block-farmers">{s.farmers}</p></div>
            <div><p className="text-neutral-500">{t('women')}</p><p className="text-xl font-semibold">{s.womenFarmers}</p></div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t('nextActions')}</CardTitle></CardHeader>
          <CardBody>
            <ul className="space-y-2 text-sm">
              {steps.map((st) => (
                <li key={st.k}>
                  <Link href={`/app/blocks/${block.id}?tab=${st.tab}`} className="flex items-center gap-2 hover:underline">
                    {st.done ? <CheckCircle2 className="size-4 text-brand-600" /> : <Circle className="size-4 text-neutral-400" />}
                    <span className={st.done ? 'text-neutral-500 line-through' : ''}>{t(`na.${st.k}`)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
