'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations('nav');
  const set = (l: string) => {
    document.cookie = `NEXT_LOCALE=${l}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };
  return (
    <div className="flex items-center gap-1 text-xs" role="group" aria-label={t('language')}>
      {(['fr', 'en'] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => set(l)}
          aria-pressed={locale === l}
          className={`rounded px-2 py-1 font-semibold uppercase ${locale === l ? 'bg-brand-100 text-brand-700' : 'text-neutral-500 hover:bg-neutral-100'}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
