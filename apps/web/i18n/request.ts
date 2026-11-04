import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';

export const LOCALES = ['fr', 'en'] as const;
export type AppLocale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = 'fr';

export default getRequestConfig(async () => {
  const c = (await cookies()).get('NEXT_LOCALE')?.value;
  let locale: AppLocale = DEFAULT_LOCALE;
  if (c === 'en' || c === 'fr') locale = c;
  else if ((await headers()).get('accept-language')?.toLowerCase().startsWith('en')) locale = 'en';
  return {
    locale,
    timeZone: 'Africa/Dakar',
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
