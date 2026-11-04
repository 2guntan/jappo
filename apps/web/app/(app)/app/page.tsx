'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Circle } from 'lucide-react';
import { useSession } from '@/lib/session';
import { Alert, Card, CardBody, CardHeader, CardTitle, PageHeader, buttonVariants } from '@/components/ui';

export default function Home() {
  const t = useTranslations('app');
  const { me, activeMembership } = useSession();
  if (!me) return null;
  const kyc = activeMembership?.kycStatus;
  const isPlatform = activeMembership?.orgType === 'platform';
  const steps = [
    { key: 'kyc', done: kyc === 'verified' || isPlatform, href: '/app/settings/organization' },
    { key: 'members', done: false, href: '/app/settings/members' },
    { key: 'security', done: !!me.user?.mfaEnabled, href: '/app/settings/security' },
  ] as const;
  return (
    <>
      <PageHeader title={t('welcome', { name: me.user?.fullName ?? '' })} subtitle={activeMembership?.orgName} />
      <div className="space-y-3">
        {me.user && !me.user.emailVerified && <Alert tone="info">{t('verifyEmailBanner')}</Alert>}
        {!isPlatform && kyc && kyc !== 'verified' && (
          <Alert tone={kyc === 'rejected' ? 'error' : 'warning'}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{t(`kycBanner.${kyc}` as 'kycBanner.pending')}</span>
              {kyc !== 'submitted' && <Link href="/app/settings/organization" className={buttonVariants({ size: 'sm' })}>{t('kycCta')}</Link>}
            </div>
          </Alert>
        )}
      </div>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t('nextSteps')}</CardTitle>
        </CardHeader>
        <CardBody>
          <ul className="space-y-2">
            {steps.map((s) => (
              <li key={s.key}>
                <Link href={s.href} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-neutral-50">
                  {s.done ? <CheckCircle2 className="size-4 text-brand-600" /> : <Circle className="size-4 text-neutral-400" />}
                  <span className={s.done ? 'text-neutral-500 line-through' : ''}>{t(`steps.${s.key}`)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </>
  );
}
