'use client';

import Link from 'next/link';
import { Bell } from 'lucide-react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { cn, formatDateTime } from '@/lib/utils';
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
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t('notifications.title')} subtitle={t('notifications.unread', { count: q.data?.pages[0]?.unreadCount ?? 0 })} />
      {items.length === 0 ? (
        <EmptyState title={t('notifications.empty')} icon={<Bell aria-hidden />} />
      ) : (
        <Card>
          <ul className="divide-y divide-neutral-200/60">
            {items.map((n) => (
              <li key={n.id} className="flex items-start gap-4 px-5 py-4">
                <span className={cn('mt-2 size-1.5 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-brand-600')} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm', n.readAt ? 'text-neutral-700' : 'font-medium text-neutral-900')}>
                    {n.link ? (
                      <Link href={n.link} className="hover:underline">
                        {n.title}
                      </Link>
                    ) : (
                      n.title
                    )}
                  </p>
                  <p className="mt-0.5 whitespace-pre-line text-sm leading-relaxed text-neutral-500">{n.body}</p>
                  <p className="mt-1.5 text-xs text-neutral-400 tabular-nums">{formatDateTime(n.createdAt)}</p>
                </div>
                {!n.readAt && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    onClick={async () => {
                      await unwrap(api.POST('/v1/notifications/{id}/actions/read', { params: { path: { id: n.id } } }));
                      await qc.invalidateQueries({ queryKey: ['notifications'] });
                    }}
                  >
                    {t('notifications.markRead')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {q.hasNextPage && (
        <Button variant="secondary" className="mt-4" onClick={() => q.fetchNextPage()}>
          {t('common.loadMore')}
        </Button>
      )}
    </div>
  );
}
