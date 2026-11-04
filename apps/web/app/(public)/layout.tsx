import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('public');
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 text-lg font-bold text-brand-700">
            <span className="inline-block size-7 rounded-md bg-brand-600" aria-hidden /> Jappo
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/#how" className="hidden text-neutral-700 hover:text-brand-700 sm:inline">{t('nav.how')}</Link>
            <Link href="/pricing" className="text-neutral-700 hover:text-brand-700">{t('nav.pricing')}</Link>
            <Link href="/login" className="text-neutral-700 hover:text-brand-700">{t('nav.login')}</Link>
            <Link href="/signup" className="rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-700">{t('nav.signup')}</Link>
            <LocaleSwitcher />
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-4 px-4 py-6 text-xs text-neutral-500">
          <p className="max-w-xl">{t('footer.rights')}</p>
          <div className="flex gap-4">
            <Link href="/legal/terms">{t('footer.terms')}</Link>
            <Link href="/legal/privacy">{t('footer.privacy')}</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
