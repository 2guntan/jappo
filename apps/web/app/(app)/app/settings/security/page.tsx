'use client';

import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/ui';
import { MfaEnrolPanel } from '@/components/security/mfa-enrol';

export default function SecurityPage() {
  const t = useTranslations('security');
  return (
    <>
      <PageHeader title={t('title')} />
      <div className="max-w-lg">
        <MfaEnrolPanel />
      </div>
    </>
  );
}
