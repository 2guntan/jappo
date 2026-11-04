'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { SEASON_KINDS } from '@jappo/contracts';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import { formatDate, formatXof } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Field, Input, Select, Table, Td, Th } from '@/components/ui';
import type { BlockT } from './types';

export function SeasonsTab({ block }: { block: BlockT }) {
  const t = useTranslations();
  const { api, hasPermission } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const [f, setF] = useState({ name: '', kind: 'cold_dry', startDate: '', endDate: '' });
  const q = useQuery({ queryKey: ['seasons', block.id], queryFn: () => unwrap(api.GET('/v1/blocks/{id}/seasons', { params: { path: { id: block.id } } })) });
  const rows = q.data?.data ?? [];
  const canCreate = hasPermission('season:create') && block.allowedActions.includes('update');
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        {rows.length === 0 ? (
          <EmptyState title={t('seasons.title')} description={t('seasons.empty')} />
        ) : (
          <Card>
            <CardBody className="p-0">
              <Table>
                <thead><tr><Th>{t('seasons.name')}</Th><Th>{t('seasons.kind')}</Th><Th>{t('seasons.start')}</Th><Th>{t('seasons.plantedHa')}</Th><Th>{t('seasons.budget')}</Th><Th>{t('common.status')}</Th></tr></thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id}>
                      <Td><Link className="font-medium text-brand-700 hover:underline" href={`/app/seasons/${s.id}`}>{s.name}</Link></Td>
                      <Td>{t(`seasons.kinds.${s.kind}`)}</Td>
                      <Td>{formatDate(s.startDate)} → {formatDate(s.endDate)}</Td>
                      <Td>{s.stats.plantedHa.toFixed(2)} ha</Td>
                      <Td>{formatXof(s.stats.budgetXof)}</Td>
                      <Td><Badge tone="blue">{t(`seasons.status.${s.status}`)}</Badge></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </CardBody>
          </Card>
        )}
      </div>
      {canCreate && (
        <Card>
          <CardHeader><CardTitle>{t('seasons.new')}</CardTitle></CardHeader>
          <CardBody>
            {msg && <Alert tone={msg.tone} className="mb-3">{msg.text}</Alert>}
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void run('s', async () => { const s = await unwrap(api.POST('/v1/blocks/{id}/seasons', { params: { path: { id: block.id } }, body: f as never })); await qc.invalidateQueries({ queryKey: ['seasons', block.id] }); window.location.href = `/app/seasons/${s.id}`; }); }}>
              <Field label={t('seasons.name')} htmlFor="s-name"><Input id="s-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <Field label={t('seasons.kind')} htmlFor="s-kind"><Select id="s-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{SEASON_KINDS.map((k) => <option key={k} value={k}>{t(`seasons.kinds.${k}`)}</option>)}</Select></Field>
              <Field label={t('seasons.start')} htmlFor="s-start"><Input id="s-start" type="date" required value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
              <Field label={t('seasons.end')} htmlFor="s-end"><Input id="s-end" type="date" required value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
              <Button type="submit" loading={busy === 's'}>{t('seasons.create')}</Button>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
