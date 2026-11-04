'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { useAction } from '@/lib/hooks';
import { formatDateTime } from '@/lib/utils';
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, Textarea } from '@/components/ui';

export function QaPanel({ rfpId, mode, canAsk }: { rfpId: string; mode: 'operator' | 'lender'; canAsk: boolean }) {
  const t = useTranslations('rfp');
  const { api } = useSession();
  const qc = useQueryClient();
  const { busy, msg, run } = useAction();
  const [q, setQ] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const list = useQuery({ queryKey: ['qa', rfpId], queryFn: () => unwrap(api.GET('/v1/rfps/{id}/questions', { params: { path: { id: rfpId } } })) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['qa', rfpId] });
  return (
    <Card>
      <CardHeader><CardTitle>{t('qa')}</CardTitle></CardHeader>
      <CardBody className="space-y-4">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        {list.data?.data.length === 0 && <p className="text-sm text-neutral-500">{t('noQuestions')}</p>}
        {list.data?.data.map((x) => (
          <div key={x.id} className="rounded-md border border-neutral-200 p-3 text-sm">
            <p className="text-xs text-neutral-500">{x.askedByOrgName ?? (x.askedByMe ? '—' : t('anonymous'))} · {formatDateTime(x.createdAt)} {x.published && <Badge tone="green">{t('publish').split(' ')[0]}</Badge>}</p>
            <p className="mt-1 font-medium">{x.question}</p>
            {x.answer && <p className="mt-2 whitespace-pre-line text-brand-900">↳ {x.answer}</p>}
            {mode === 'operator' && !x.answer && (
              <div className="mt-2 space-y-2">
                <Textarea aria-label={t('answer')} value={answers[x.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [x.id]: e.target.value })} />
                <Button size="sm" loading={busy === x.id} disabled={(answers[x.id] ?? '').length < 2} onClick={() => run(x.id, async () => { await unwrap(api.POST('/v1/rfps/{id}/questions/{qid}/answer', { params: { path: { id: rfpId, qid: x.id } }, body: { answer: answers[x.id]!, publish: true } })); await refresh(); })}>{t('publish')}</Button>
              </div>
            )}
          </div>
        ))}
        {mode === 'lender' && canAsk && (
          <div className="space-y-2">
            <Textarea aria-label={t('question')} placeholder={t('ask')} value={q} onChange={(e) => setQ(e.target.value)} />
            <Button size="sm" disabled={q.length < 5} loading={busy === 'ask'} onClick={() => run('ask', async () => { await unwrap(api.POST('/v1/rfps/{id}/questions', { params: { path: { id: rfpId } }, body: { question: q } })); setQ(''); await refresh(); })}>{t('send')}</Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
