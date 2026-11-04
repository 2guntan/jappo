'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import { Alert, Button, Card, CardBody, Input, PageHeader, Spinner, Table, Td, Th } from '@/components/ui';

export default function AlertRulesPage() {
  const t = useTranslations();
  const { api } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const [edit, setEdit] = useState<Record<string, Record<string, string>>>({});
  const q = useQuery({ queryKey: ['alert-rules'], queryFn: () => unwrap(api.GET('/v1/alert-rules')) });
  if (q.isLoading) return <Spinner />;
  return (
    <>
      <PageHeader title={t('alerts.rulesTitle')} subtitle={t('alerts.rulesHint')} />
      {msg && <Alert tone={msg.tone} className="mb-4">{msg.text}</Alert>}
      <Card>
        <CardBody className="p-0">
          <Table>
            <thead><tr><Th>{t('alerts.rule')}</Th><Th>{t('alerts.description')}</Th><Th>{t('alerts.params')}</Th><Th>{t('alerts.enabled')}</Th><Th /></tr></thead>
            <tbody>
              {(q.data?.data ?? []).map((r) => {
                const e = edit[r.code] ?? Object.fromEntries(Object.entries(r.params).map(([k, v]) => [k, String(v)]));
                return (
                  <tr key={r.code}>
                    <Td className="font-medium">{r.code}</Td>
                    <Td className="text-xs">{r.description}</Td>
                    <Td className="space-y-1">
                      {Object.keys(r.params).map((k) => (
                        <label key={k} className="flex items-center gap-2 text-xs">
                          <span className="w-28">{k}</span>
                          <Input className="h-8 w-20" inputMode="decimal" aria-label={`${r.code} ${k}`} value={e[k] ?? ''} onChange={(ev) => setEdit({ ...edit, [r.code]: { ...e, [k]: ev.target.value } })} />
                        </label>
                      ))}
                    </Td>
                    <Td>
                      <input type="checkbox" aria-label={`${r.code} ${t('alerts.enabled')}`} checked={r.enabled} onChange={(ev) => run(`en-${r.code}`, async () => { await unwrap(api.PATCH('/v1/alert-rules/{code}', { params: { path: { code: r.code } }, body: { enabled: ev.target.checked } })); await qc.invalidateQueries({ queryKey: ['alert-rules'] }); })} />
                    </Td>
                    <Td>
                      {Object.keys(r.params).length > 0 && <Button size="sm" variant="secondary" disabled={!edit[r.code]} loading={busy === r.code} onClick={() => run(r.code, async () => { await unwrap(api.PATCH('/v1/alert-rules/{code}', { params: { path: { code: r.code } }, body: { params: Object.fromEntries(Object.entries(e).map(([k, v]) => [k, Number(v)])) } })); setEdit({ ...edit, [r.code]: undefined as never }); await qc.invalidateQueries({ queryKey: ['alert-rules'] }); }, t('common.saved'))}>{t('common.save')}</Button>}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </>
  );
}
