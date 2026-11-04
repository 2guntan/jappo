'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import { formatDateTime } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Input, Select, Table, Td, Th } from '@/components/ui';
import type { BlockT } from './types';

const sevTone = { critical: 'red', warning: 'amber', info: 'blue' } as const;

export function AlertsTab({ block }: { block: BlockT }) {
  const t = useTranslations();
  const { api, hasPermission } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const [status, setStatus] = useState<'open' | 'acknowledged' | 'resolved' | ''>('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [manual, setManual] = useState({ severity: 'warning' as 'info' | 'warning' | 'critical', message: '' });
  const q = useQuery({ queryKey: ['alerts', block.id, status], queryFn: () => unwrap(api.GET('/v1/blocks/{id}/alerts', { params: { path: { id: block.id }, query: { status: status || undefined } } })) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['alerts', block.id] });
  const manage = hasPermission('alert:manage');
  const rows = q.data?.data ?? [];
  return (
    <div className="space-y-4">
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label={t('common.status')} className="w-48" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="">{t('alerts.allStatuses')}</option>
          {(['open', 'acknowledged', 'resolved'] as const).map((s) => <option key={s} value={s}>{t(`alerts.status.${s}`)}</option>)}
        </Select>
        {manage && <Button variant="secondary" loading={busy === 'eval'} data-testid="evaluate-alerts" onClick={() => run('eval', async () => { const r = await unwrap(api.POST('/v1/blocks/{id}/alerts/actions/evaluate', { params: { path: { id: block.id } } })); await refresh(); return r; }, t('alerts.evaluated'))}>{t('alerts.evaluate')}</Button>}
      </div>
      {rows.length === 0 ? <EmptyState title={t('alerts.title')} description={t('alerts.empty')} /> : (
        <Card>
          <CardBody className="p-0">
            <Table>
              <thead><tr><Th>{t('alerts.severity')}</Th><Th>{t('alerts.message')}</Th><Th>{t('alerts.rule')}</Th><Th>{t('alerts.raisedAt')}</Th><Th>{t('common.status')}</Th><Th /></tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} data-testid={`alert-${a.ruleCode ?? 'manual'}`}>
                    <Td><Badge tone={sevTone[a.severity]}>{t(`alerts.severities.${a.severity}`)}</Badge></Td>
                    <Td>{a.message}{a.resolutionNote && <span className="block text-xs text-neutral-500">{a.resolutionNote}</span>}</Td>
                    <Td className="text-xs">{a.ruleCode ?? t('alerts.manual')}</Td>
                    <Td>{formatDateTime(a.createdAt)}</Td>
                    <Td><Badge>{t(`alerts.status.${a.status}`)}</Badge></Td>
                    <Td className="whitespace-nowrap">
                      {manage && a.status === 'open' && <Button size="sm" variant="ghost" onClick={() => run('ack', async () => { await unwrap(api.POST('/v1/alerts/{id}/actions/acknowledge', { params: { path: { id: a.id } }, body: {} })); await refresh(); })}>{t('alerts.acknowledge')}</Button>}
                      {manage && a.status !== 'resolved' && (
                        <span className="inline-flex gap-1">
                          <Input className="h-8 w-40" aria-label={t('alerts.note')} placeholder={t('alerts.note')} value={notes[a.id] ?? ''} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} />
                          <Button size="sm" variant="secondary" disabled={!notes[a.id]?.trim()} onClick={() => run('res', async () => { await unwrap(api.POST('/v1/alerts/{id}/actions/resolve', { params: { path: { id: a.id } }, body: { note: notes[a.id] } })); await refresh(); })}>{t('alerts.resolve')}</Button>
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      )}
      {manage && (
        <Card>
          <CardHeader><CardTitle>{t('alerts.manualTitle')}</CardTitle></CardHeader>
          <CardBody className="flex flex-wrap gap-2">
            <Select aria-label={t('alerts.severity')} className="w-40" value={manual.severity} onChange={(e) => setManual({ ...manual, severity: e.target.value as typeof manual.severity })}>
              {(['info', 'warning', 'critical'] as const).map((s) => <option key={s} value={s}>{t(`alerts.severities.${s}`)}</option>)}
            </Select>
            <Input className="flex-1" aria-label={t('alerts.message')} placeholder={t('alerts.message')} value={manual.message} onChange={(e) => setManual({ ...manual, message: e.target.value })} />
            <Button disabled={manual.message.trim().length < 3} loading={busy === 'manual'} onClick={() => run('manual', async () => { await unwrap(api.POST('/v1/blocks/{id}/alerts', { params: { path: { id: block.id } }, body: { severity: manual.severity, type: 'manual', message: manual.message } })); setManual({ ...manual, message: '' }); await refresh(); })}>{t('alerts.raise')}</Button>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
