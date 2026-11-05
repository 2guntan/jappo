'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useSession } from '@/lib/session';
import { Alert, Card, CardBody, CardHeader, CardTitle, Checklist, PageHeader, buttonVariants } from '@/components/ui';
import { RoleDashboard } from '@/components/monitoring/role-dashboard';

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
              {kyc !== 'submitted' && (
                <Link href="/app/settings/organization" className={buttonVariants({ size: 'sm' })}>
                  {t('kycCta')}
                </Link>
              )}
            </div>
          </Alert>
        )}
      </div>
      <RoleDashboard />
      <Card className="mt-6 max-w-xl">
        <CardHeader>
          <CardTitle>{t('nextSteps')}</CardTitle>
        </CardHeader>
        <CardBody>
          <Checklist items={steps.map((s) => ({ key: s.key, label: t(`steps.${s.key}`), done: s.done, href: s.href }))} />
        </CardBody>
      </Card>
    </>
  );
}
