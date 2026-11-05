import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { Providers } from './providers';
import './globals.css';

/** Inter (variable, latin subset incl. œ/€) is self-hosted so builds never depend on a font CDN. */
const inter = localFont({
  src: './fonts/inter-latin.woff2',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-inter',
  fallback: ['system-ui', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return { title: { default: 'Jappo', template: '%s · Jappo' }, description: t('description'), manifest: '/manifest.webmanifest' };
}

export const viewport: Viewport = { themeColor: '#1d5639', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale} className={inter.variable}>
      <body className="min-h-screen bg-neutral-50 font-sans text-neutral-900 antialiased">
        <NextIntlClientProvider locale={locale} messages={messages} timeZone="Africa/Dakar">
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
