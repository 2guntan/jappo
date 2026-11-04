'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import { Alert, Card, CardBody, CardHeader, CardTitle, EmptyState, PageHeader } from '@/components/ui';
import { OfftakeForm } from '@/components/offtake/offtake-form';
import { OfftakeTable } from '@/components/offtake/offtake-table';

export default function OfftakePage() {
  const t = useTranslations();
  const { api, hasPermission } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const q = useQuery({ queryKey: ['offtake', 'all'], queryFn: () => unwrap(api.GET('/v1/offtake-contracts')) });
  const rows = q.data?.data ?? [];
  return (
    <>
      <PageHeader title={t('offtake.title')} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">{rows.length ? <Card><CardBody className="p-0"><OfftakeTable rows={rows} /></CardBody></Card> : <EmptyState title={t('offtake.title')} description={t('offtake.empty')} />}</div>
        {hasPermission('offtake:manage') && (
          <Card>
            <CardHeader><CardTitle>{t('offtake.new')}</CardTitle></CardHeader>
            <CardBody>
              {msg && <Alert tone={msg.tone} className="mb-3">{msg.text}</Alert>}
              <OfftakeForm busy={busy === 'o'} onSubmit={(v) => void run('o', async () => { await unwrap(api.POST('/v1/offtake-contracts', { body: v })); await qc.invalidateQueries({ queryKey: ['offtake'] }); })} />
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
