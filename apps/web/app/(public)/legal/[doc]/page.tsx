import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

export default async function Legal({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  if (doc !== 'terms' && doc !== 'privacy') notFound();
  const t = await getTranslations('public.footer');
  // Text is managed by the platform admin in /admin/settings (legal.terms_text / legal.privacy_text).
  let body = '';
  try {
    const r = await fetch(`${process.env.API_INTERNAL_URL ?? 'http://localhost:4000'}/v1/legal/${doc}`, { cache: 'no-store' });
    if (r.ok) body = ((await r.json()) as { text: string }).text;
  } catch {
    body = '';
  }
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-semibold">{doc === 'terms' ? t('terms') : t('privacy')}</h1>
      <div className="mt-6 whitespace-pre-line text-sm leading-6 text-neutral-700">{body || t('rights')}</div>
    </article>
  );
}
