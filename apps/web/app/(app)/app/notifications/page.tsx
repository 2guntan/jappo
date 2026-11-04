'use client';

import Link from 'next/link';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { formatDateTime } from '@/lib/utils';
import { Button, Card, EmptyState, PageHeader, Spinner } from '@/components/ui';

export default function NotificationsPage() {
  const t = useTranslations();
  const { api } = useSession();
  const qc = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: ['notifications', 'list'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => unwrap(api.GET('/v1/notifications', { params: { query: { limit: 30, cursor: pageParam } } })),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  if (q.isLoading) return <Spinner />;
  const items = q.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <>
      <PageHeader title={t('notifications.title')} subtitle={t('notifications.unread', { count: q.data?.pages[0]?.unreadCount ?? 0 })} />
      {items.length === 0 ? (
        <EmptyState title={t('notifications.empty')} />
      ) : (
        <Card>
          <ul className="divide-y divide-neutral-100">
            {items.map((n) => (
              <li key={n.id} className={`flex items-start justify-between gap-4 px-5 py-3 ${n.readAt ? '' : 'bg-brand-50/40'}`}>
                <div>
                  <p className="font-medium">{n.link ? <Link href={n.link} className="hover:underline">{n.title}</Link> : n.title}</p>
                  <p className="whitespace-pre-line text-sm text-neutral-600">{n.body}</p>
                  <p className="mt-1 text-xs text-neutral-400">{formatDateTime(n.createdAt)}</p>
                </div>
                {!n.readAt && (
                  <Button size="sm" variant="ghost" onClick={async () => { await unwrap(api.POST('/v1/notifications/{id}/actions/read', { params: { path: { id: n.id } } })); await qc.invalidateQueries({ queryKey: ['notifications'] }); }}>
                    {t('notifications.markRead')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {q.hasNextPage && <Button variant="secondary" className="mt-4" onClick={() => q.fetchNextPage()}>{t('common.loadMore')}</Button>}
    </>
  );
}
