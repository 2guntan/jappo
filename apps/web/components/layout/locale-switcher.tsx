'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { SegmentedControl } from '@/components/ui';

export function LocaleSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations('nav');
  const set = (l: string) => {
    document.cookie = `NEXT_LOCALE=${l}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };
  return (
    <SegmentedControl
      size="sm"
      label={t('language')}
      className={className}
      value={locale === 'en' ? 'en' : 'fr'}
      onChange={set}
      options={[
        { value: 'fr', label: 'FR' },
        { value: 'en', label: 'EN' },
      ]}
    />
  );
}
