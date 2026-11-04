'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import { Alert, Card, CardBody, CardHeader, CardTitle, EmptyState } from '@/components/ui';
import { OfftakeForm } from '@/components/offtake/offtake-form';
import { OfftakeTable } from '@/components/offtake/offtake-table';
import type { BlockT } from './types';

export function OfftakeTab({ block }: { block: BlockT }) {
  const t = useTranslations();
  const { api, hasPermission } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const q = useQuery({ queryKey: ['offtake', block.id], queryFn: () => unwrap(api.GET('/v1/offtake-contracts', { params: { query: { blockId: block.id } } })) });
  const rows = q.data?.data ?? [];
  const canManage = hasPermission('offtake:manage') && block.allowedActions.includes('update');
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        {rows.length ? <Card><CardBody className="p-0"><OfftakeTable rows={rows} showBlock={false} showOperatorActions={canManage} /></CardBody></Card> : <EmptyState title={t('offtake.title')} description={t('offtake.empty')} />}
      </div>
      {canManage && (
        <Card>
          <CardHeader><CardTitle>{t('offtake.new')}</CardTitle></CardHeader>
          <CardBody>
            {msg && <Alert tone={msg.tone} className="mb-3">{msg.text}</Alert>}
            <OfftakeForm blockId={block.id} busy={busy === 'o'} onSubmit={(v) => void run('o', async () => { await unwrap(api.POST('/v1/offtake-contracts', { body: v })); await qc.invalidateQueries({ queryKey: ['offtake'] }); })} />
          </CardBody>
        </Card>
      )}
    </div>
  );
}
