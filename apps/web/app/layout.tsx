import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import { Providers } from './providers';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('meta');
  return { title: { default: 'Jappo', template: '%s · Jappo' }, description: t('description'), manifest: '/manifest.webmanifest' };
}

export const viewport: Viewport = { themeColor: '#23804a', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale}>
      <body className="min-h-screen bg-neutral-50 font-sans text-neutral-900 antialiased">
        <NextIntlClientProvider locale={locale} messages={messages} timeZone="Africa/Dakar">
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
