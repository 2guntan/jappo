'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  Award,
  Banknote,
  Bell,
  BellRing,
  BookOpen,
  ChartColumn,
  ChevronsUpDown,
  CreditCard,
  FileCheck,
  FileSignature,
  Handshake,
  Inbox,
  KeyRound,
  Landmark,
  LayoutDashboard,
  LogOut,
  Map as MapIcon,
  Menu,
  Receipt,
  Scale,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Terminal,
  Truck,
  UserCheck,
  Users,
  Wallet,
  Webhook,
  X,
} from 'lucide-react';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';
import { IconButton, Spinner } from '@/components/ui';
import { Logo } from '@/components/brand/logo';
import { LocaleSwitcher } from './locale-switcher';
import { MfaEnrolPanel } from '@/components/security/mfa-enrol';

type Icon = ComponentType<{ className?: string }>;

const ICONS: Record<string, Icon> = {
  home: LayoutDashboard,
  blocks: MapIcon,
  farmers: Users,
  catalogue: BookOpen,
  quotes: Receipt,
  offtake: Handshake,
  'buyer-contracts': FileSignature,
  opportunities: Inbox,
  awards: Award,
  profiles: SlidersHorizontal,
  financing: Banknote,
  contracts: FileSignature,
  facilities: Wallet,
  'buyer-dispatches': Truck,
  'buyer-invoices': Receipt,
  settlements: Scale,
  reports: ChartColumn,
  portfolio: ShieldCheck,
  'admin-kyc': UserCheck,
  'admin-audit': ScrollText,
  'admin-alert-rules': BellRing,
  'admin-console': Terminal,
  'admin-land': FileCheck,
  'admin-billing': CreditCard,
  billing: CreditCard,
  webhooks: Webhook,
  field: Smartphone,
  organization: Landmark,
  members: Users,
  apiKeys: KeyRound,
  security: ShieldCheck,
};

const SETTINGS = [
  { href: '/app/settings/organization', key: 'organization', perm: 'org:read' },
  { href: '/app/settings/members', key: 'members', perm: 'member:manage' },
  { href: '/app/settings/api-keys', key: 'apiKeys', perm: 'apikey:manage' },
  { href: '/app/settings/billing', key: 'billing', perm: 'billing:read' },
  { href: '/app/settings/webhooks', key: 'webhooks', perm: 'webhook:manage' },
  { href: '/app/settings/security', key: 'security' },
] as const;

const initials = (name?: string | null) =>
  (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || '·';

function NavLink({ href, label, icon: Ic, active, onClick, external }: { href: string; label: string; icon?: Icon; active: boolean; onClick: () => void; external?: boolean }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener' : undefined}
      className={cn(
        'group flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] font-medium transition-colors',
        active ? 'bg-white text-neutral-900 shadow-xs ring-1 ring-neutral-200/80' : 'text-neutral-600 hover:bg-neutral-200/50 hover:text-neutral-900',
      )}
    >
      {Ic && <Ic className={cn('size-4 shrink-0 transition-colors', active ? 'text-brand-700' : 'text-neutral-400 group-hover:text-neutral-600')} />}
      <span className="truncate">{label}</span>
    </Link>
  );
}

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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

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

  if (status !== 'authenticated' || !me) return <Spinner className="min-h-screen items-center" />;
  if (me.mfaEnrolmentRequired) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <Logo className="mb-8" />
        <MfaEnrolPanel forced />
      </div>
    );
  }

  const nav = (modules.data?.data ?? []).flatMap((m) => m.navItems).filter((n) => n.key !== 'settings');
  const isActive = (href: string) => (href === '/app' ? pathname === '/app' : pathname.startsWith(href));
  const unreadCount = unread.data?.unreadCount ?? 0;
  const close = () => setOpen(false);
  const membership = session.activeMembership;
  const billing = membership?.billingStatus;

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between pl-5 pr-3">
        <Link href="/app" onClick={close} className="rounded-md">
          <Logo />
        </Link>
        <IconButton className="md:hidden" aria-label={t('close' as 'home')} onClick={close}>
          <X />
        </IconButton>
      </div>

      <div className="px-3 pb-2">
        <label className="relative block">
          <span className="sr-only">{t('switchOrg')}</span>
          <select
            aria-label={t('switchOrg')}
            value={activeOrgId ?? ''}
            onChange={(e) => setActiveOrg(e.target.value)}
            data-testid="org-switcher"
            className="h-9 w-full cursor-pointer appearance-none truncate rounded-md border border-neutral-200/80 bg-white pl-3 pr-8 text-[13px] font-medium text-neutral-900 shadow-xs transition-colors hover:border-neutral-300 focus:border-brand-500 focus:outline-none focus:ring-3 focus:ring-brand-500/15"
          >
            {me.memberships.map((m) => (
              <option key={m.orgId} value={m.orgId}>
                {m.orgName}
              </option>
            ))}
          </select>
          <ChevronsUpDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-neutral-400" aria-hidden />
        </label>
      </div>

      <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 pb-4" aria-label="main">
        <ul className="space-y-0.5">
          {nav.map((n) => (
            <li key={n.key}>
              <NavLink href={n.href} label={t(n.labelKey.replace(/^nav\./, '') as 'home')} icon={ICONS[n.key]} active={isActive(n.href)} onClick={close} external={!n.href.startsWith('/app')} />
            </li>
          ))}
        </ul>
        <p className="mb-1 mt-6 px-2.5 text-[11px] font-medium uppercase tracking-wider text-neutral-400">{t('settings')}</p>
        <ul className="space-y-0.5">
          {SETTINGS.filter((s) => !('perm' in s) || hasPermission(s.perm)).map((s) => (
            <li key={s.key}>
              <NavLink href={s.href} label={t(s.key)} icon={ICONS[s.key]} active={isActive(s.href)} onClick={close} />
            </li>
          ))}
        </ul>
      </nav>

      <div className="shrink-0 border-t border-neutral-200/70 p-3">
        <div className="mb-2 flex items-center justify-between gap-2 px-1">
          <LocaleSwitcher />
          <Link href="/app/notifications" onClick={close} className="relative inline-flex size-8 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-200/60 hover:text-neutral-900" aria-label={t('notifications')}>
            <Bell className="size-4" />
            {unreadCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white" data-testid="unread-count">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </Link>
        </div>
        <div className="flex items-center gap-2.5 rounded-md px-1 py-1">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[11px] font-semibold text-brand-800" aria-hidden>
            {initials(me.user?.fullName)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-neutral-900">{me.user?.fullName}</span>
            <span className="block truncate text-xs text-neutral-500">{me.user?.email}</span>
          </span>
          <IconButton
            size="sm"
            aria-label={t('logout')}
            title={t('logout')}
            onClick={async () => {
              await logout();
              router.replace('/login');
            }}
          >
            <LogOut />
          </IconButton>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-neutral-50">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-[260px] border-r border-neutral-200/70 bg-neutral-50 transition-transform duration-200 ease-out-quart md:sticky md:top-0 md:h-screen md:w-60 md:translate-x-0 lg:w-64',
          open ? 'translate-x-0 shadow-lg' : '-translate-x-full md:shadow-none',
        )}
      >
        {sidebar}
      </aside>
      {open && <button className="fixed inset-0 z-30 bg-neutral-950/30 backdrop-blur-[2px] md:hidden" aria-label={t('close' as 'home')} onClick={close} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-neutral-200/70 bg-neutral-50/90 px-3 backdrop-blur md:hidden">
          <IconButton onClick={() => setOpen(true)} aria-label="menu">
            <Menu />
          </IconButton>
          <Link href="/app" className="rounded-md">
            <Logo />
          </Link>
          <Link href="/app/notifications" className="relative ml-auto inline-flex size-9 items-center justify-center rounded-md text-neutral-600" aria-label={t('notifications')}>
            <Bell className="size-4" />
            {unreadCount > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-red-600" />}
          </Link>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
          {billing && billing !== 'ok' && (
            <div
              role="alert"
              data-testid="billing-banner"
              className={cn('mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm', billing === 'restricted' ? 'border-red-200/70 bg-red-50 text-red-900' : 'border-amber-200/70 bg-amber-50 text-amber-900')}
            >
              <span>{t(billing === 'restricted' ? 'billingRestricted' : 'billingOverdue')}</span>
              <Link className="font-medium underline underline-offset-4" href="/app/settings/billing">
                {t('billing')}
              </Link>
            </div>
          )}
          <div className="animate-enter">{children}</div>
        </main>
      </div>
    </div>
  );
}
