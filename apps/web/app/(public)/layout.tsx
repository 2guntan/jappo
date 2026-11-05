import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { Logo } from '@/components/brand/logo';
import { buttonVariants } from '@/components/ui';

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('public');
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-neutral-200/70 bg-neutral-50/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-5 sm:px-8">
          <Link href="/" className="rounded-md" aria-label="Jappo">
            <Logo />
          </Link>
          <nav className="flex items-center gap-0.5 whitespace-nowrap text-sm sm:gap-1" aria-label="public">
            <Link href="/#how" className="hidden rounded-md px-3 py-2 text-neutral-600 transition-colors hover:text-neutral-900 md:inline">
              {t('nav.how')}
            </Link>
            <Link href="/pricing" className="hidden rounded-md px-3 py-2 text-neutral-600 transition-colors hover:text-neutral-900 sm:inline">
              {t('nav.pricing')}
            </Link>
            <Link href="/login" className="rounded-md px-2.5 py-2 font-medium text-neutral-900 transition-colors hover:text-brand-700 sm:px-3">
              {t('nav.login')}
            </Link>
            <Link href="/signup" className={buttonVariants({ size: 'sm', className: 'ml-1' })}>
              {t('nav.signup')}
            </Link>
            <LocaleSwitcher className="ml-3 hidden sm:inline-flex" />
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-neutral-200/70">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-start sm:justify-between sm:px-8">
          <div className="max-w-md space-y-3">
            <Logo />
            <p className="text-xs leading-relaxed text-neutral-500">{t('footer.rights')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-xs text-neutral-500">
            <Link href="/legal/terms" className="transition-colors hover:text-neutral-900">
              {t('footer.terms')}
            </Link>
            <Link href="/legal/privacy" className="transition-colors hover:text-neutral-900">
              {t('footer.privacy')}
            </Link>
            <LocaleSwitcher className="sm:hidden" />
          </div>
        </div>
      </footer>
    </div>
  );
}
