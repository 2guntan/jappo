'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Bell, LogOut, Menu } from 'lucide-react';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { Select, Spinner } from '@/components/ui';
import { LocaleSwitcher } from './locale-switcher';
import { MfaEnrolPanel } from '@/components/security/mfa-enrol';

const SETTINGS = [
  { href: '/app/settings/organization', key: 'organization', perm: 'org:read' },
  { href: '/app/settings/members', key: 'members', perm: 'member:manage' },
  { href: '/app/settings/api-keys', key: 'apiKeys', perm: 'apikey:manage' },
  { href: '/app/settings/billing', key: 'billing', perm: 'billing:read' },
  { href: '/app/settings/webhooks', key: 'webhooks', perm: 'webhook:manage' },
  { href: '/app/settings/security', key: 'security' },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations('nav');
  const session = useSession();
  const { status, me, api, activeOrgId, setActiveOrg, logout, hasPermission } = session;
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (status === 'anonymous') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, router, pathname]);

  const modules = useQuery({
    queryKey: ['modules', activeOrgId],
    enabled: status === 'authenticated' && !me?.mfaEnrolmentRequired,
    queryFn: () => unwrap(api.GET('/v1/modules')),
  });
  const unread = useQuery({
    queryKey: ['notifications', 'unread', activeOrgId],
    enabled: status === 'authenticated' && !me?.mfaEnrolmentRequired,
    refetchInterval: 60_000,
    queryFn: () => unwrap(api.GET('/v1/notifications', { params: { query: { limit: 1, unread: true } } })),
  });

  if (status !== 'authenticated' || !me) return <Spinner />;
  if (me.mfaEnrolmentRequired) {
    return (
      <div className="mx-auto max-w-lg px-4 py-12">
        <MfaEnrolPanel forced />
      </div>
    );
  }

  const nav = (modules.data?.data ?? []).flatMap((m) => m.navItems).filter((n) => n.key !== 'settings');
  const isActive = (href: string) => (href === '/app' ? pathname === '/app' : pathname.startsWith(href));

  return (
    <div className="flex min-h-screen">
      <aside className={cn('fixed inset-y-0 left-0 z-30 w-64 transform border-r border-neutral-200 bg-white transition-transform md:static md:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
        <div className="flex h-14 items-center gap-2 border-b border-neutral-100 px-4 font-bold text-brand-700">
          <span className="inline-block size-6 rounded bg-brand-600" aria-hidden /> Jappo
        </div>
        <nav className="space-y-1 p-3 text-sm" aria-label="main">
          {nav.map((n) => (
            <Link key={n.key} href={n.href} onClick={() => setOpen(false)} className={cn('block rounded-md px-3 py-2', isActive(n.href) ? 'bg-brand-50 font-medium text-brand-700' : 'text-neutral-700 hover:bg-neutral-100')}>
              {t(n.labelKey.replace(/^nav\./, '') as 'home')}
            </Link>
          ))}
          <p className="px-3 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-neutral-400">{t('settings')}</p>
          {SETTINGS.filter((s) => !('perm' in s) || hasPermission(s.perm)).map((s) => (
            <Link key={s.key} href={s.href} onClick={() => setOpen(false)} className={cn('block rounded-md px-3 py-2', isActive(s.href) ? 'bg-brand-50 font-medium text-brand-700' : 'text-neutral-700 hover:bg-neutral-100')}>
              {t(s.key)}
            </Link>
          ))}
        </nav>
      </aside>
      {open && <button className="fixed inset-0 z-20 bg-black/20 md:hidden" aria-label="close menu" onClick={() => setOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-neutral-200 bg-white px-4">
          <button className="md:hidden" onClick={() => setOpen(true)} aria-label="menu">
            <Menu className="size-5" />
          </button>
          <div className="w-56 max-w-[50vw]">
            <Select aria-label={t('switchOrg')} value={activeOrgId ?? ''} onChange={(e) => setActiveOrg(e.target.value)} data-testid="org-switcher">
              {me.memberships.map((m) => (
                <option key={m.orgId} value={m.orgId}>{m.orgName}</option>
              ))}
            </Select>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <LocaleSwitcher />
            <Link href="/app/notifications" className="relative rounded p-1.5 hover:bg-neutral-100" aria-label={t('notifications')}>
              <Bell className="size-5" />
              {(unread.data?.unreadCount ?? 0) > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white" data-testid="unread-count">
                  {unread.data!.unreadCount}
                </span>
              )}
            </Link>
            <span className="hidden text-sm text-neutral-700 sm:inline">{me.user?.fullName}</span>
            <button
              onClick={async () => {
                await logout();
                router.replace('/login');
              }}
              className="rounded p-1.5 hover:bg-neutral-100"
              aria-label={t('logout')}
            >
              <LogOut className="size-5" />
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
          {session.activeMembership?.billingStatus && session.activeMembership.billingStatus !== 'ok' && (
            <div role="alert" data-testid="billing-banner" className={`mb-4 rounded-md px-4 py-3 text-sm ${session.activeMembership.billingStatus === 'restricted' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}`}>
              {t(session.activeMembership.billingStatus === 'restricted' ? 'billingRestricted' : 'billingOverdue')} <Link className="font-medium underline" href="/app/settings/billing">{t('billing')}</Link>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
