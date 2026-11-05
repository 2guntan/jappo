'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { downloadCsv, statusTone } from '@/lib/utils';
import { BlockMap } from '@/components/map';
import { Search } from 'lucide-react';
import { Badge, Button, Card, CardBody, EmptyState, Input, PageHeader, SegmentedControl, Spinner, Table, Td, Th, buttonVariants } from '@/components/ui';

export default function BlocksPage() {
  const t = useTranslations();
  const { api, activeOrgId, hasPermission } = useSession();
  const [view, setView] = useState<'list' | 'map'>('list');
  const [q, setQ] = useState('');
  const blocks = useQuery({ queryKey: ['blocks', activeOrgId, q], queryFn: () => unwrap(api.GET('/v1/blocks', { params: { query: { limit: 200, q: q || undefined } } })) });
  const rows = blocks.data?.data ?? [];
  return (
    <>
      <PageHeader
        title={t('blocks.title')}
        actions={
          <>
            <SegmentedControl
              value={view}
              onChange={setView}
              options={[
                { value: 'list', label: t('blocks.listView') },
                { value: 'map', label: t('blocks.mapView') },
              ]}
            />
            <Button variant="secondary" onClick={() => downloadCsv('blocks.csv', rows.map((b) => ({ ref: b.ref, name: b.name, region: b.region, status: b.status, areaHa: b.areaHa, plots: b.stats.plots, farmers: b.stats.farmers })))}>{t('common.exportCsv')}</Button>
            {hasPermission('block:create') && <Link href="/app/blocks/new" className={buttonVariants()}>{t('blocks.new')}</Link>}
          </>
        }
      />
      <div className="relative mb-4 w-full max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" aria-hidden />
        <Input className="pl-9" placeholder={t('common.search')} aria-label={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {blocks.isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState title={t('blocks.title')} description={t('blocks.empty')} action={hasPermission('block:create') ? <Link href="/app/blocks/new" className={buttonVariants()}>{t('blocks.new')}</Link> : undefined} />
      ) : view === 'map' ? (
        <BlockMap height={520} features={rows.map((b) => ({ type: 'Feature' as const, id: b.id, geometry: b.boundary ?? b.centroid, properties: { kind: 'block', status: b.status, code: b.ref } }))} onSelect={(id) => (window.location.href = `/app/blocks/${id}`)} />
      ) : (
        <Card>
          <CardBody className="p-0">
            <Table>
              <thead><tr><Th>Ref</Th><Th>{t('blocks.name')}</Th><Th>{t('blocks.region')}</Th><Th className="text-right">{t('blocks.area')}</Th><Th className="text-right">{t('blocks.plots')}</Th><Th className="text-right">{t('blocks.farmers')}</Th><Th>{t('common.status')}</Th></tr></thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id}>
                    <Td><Link href={`/app/blocks/${b.id}`} className="font-medium text-brand-700 hover:underline">{b.ref}</Link></Td>
                    <Td>{b.name}</Td>
                    <Td>{b.region}</Td>
                    <Td className="text-right">{b.areaHa === null ? '—' : `${b.areaHa.toFixed(2)} ha`}</Td>
                    <Td className="text-right">{b.stats.plots}</Td>
                    <Td className="text-right">{b.stats.farmers}</Td>
                    <Td><Badge tone={statusTone(b.status)}>{t(`blockStatus.${b.status}`)}</Badge></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}
    </>
  );
}
