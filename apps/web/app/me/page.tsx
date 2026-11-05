'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, FileText } from 'lucide-react';
import { createJappoClient, unwrap, type Schemas } from '@jappo/sdk';
import { formatDate, formatXof } from '@/lib/utils';
import { problemMessage } from '@/lib/errors';
import { Alert, Button, Card, CardBody, CardHeader, CardTitle, Field, Input } from '@/components/ui';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { LogoMark } from '@/components/brand/logo';

const KEY = 'jappo.farmerToken';
const read = () => {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as { token: string; exp: number } | null;
    return v && v.exp > Date.now() ? v.token : null;
  } catch {
    return null;
  }
};

/** Farmer self-service (SPEC §12.9): phone + SMS code, profile, plots, statements. Token kept for this tab only. */
export default function FarmerPortal() {
  const t = useTranslations();
  const [token, setToken] = useState<string | null>(null);
  const [phone, setPhone] = useState('+221');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [me, setMe] = useState<Schemas['MeFarmer'] | null>(null);
  const [plots, setPlots] = useState<Schemas['MeFarmerPlot'][]>([]);
  const [statements, setStatements] = useState<Schemas['MeFarmerStatement'][]>([]);
  useEffect(() => setToken(read()), []);
  const api = useMemo(() => createJappoClient({ baseUrl: typeof window === 'undefined' ? '' : window.location.origin, getToken: () => token }), [token]);
  useEffect(() => {
    if (!token) return;
    Promise.all([unwrap(api.GET('/v1/me/farmer')), unwrap(api.GET('/v1/me/farmer/plots')), unwrap(api.GET('/v1/me/farmer/statements'))])
      .then(([m, p, s]) => {
        setMe(m);
        setPlots(p.data);
        setStatements(s.data);
      })
      .catch(() => {
        sessionStorage.removeItem(KEY);
        setToken(null);
      });
  }, [token, api]);
  const guard = async (fn: () => Promise<void>) => {
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(problemMessage(e, t));
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-neutral-200/70 bg-neutral-50/90 px-4 backdrop-blur">
        <span className="inline-flex items-center gap-2.5">
          <LogoMark />
          <span className="text-[15px] font-semibold tracking-tight text-neutral-900">{t('farmerPortal.title')}</span>
        </span>
        <LocaleSwitcher />
      </header>
      <main className="mx-auto w-full max-w-md flex-1 space-y-4 px-4 py-6">
        {err && <Alert tone="error">{err}</Alert>}
        {!token ? (
          <Card>
            <CardBody className="space-y-4 py-6">
              <p className="text-sm leading-relaxed text-neutral-600">{t('farmerPortal.intro')}</p>
              <Field label={t('farmerPortal.phone')} htmlFor="fp-phone">
                <Input id="fp-phone" inputMode="tel" className="h-11 text-base" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, ''))} />
              </Field>
              {!sent ? (
                <Button
                  size="lg"
                  className="w-full"
                  disabled={phone.length < 9}
                  onClick={() =>
                    guard(async () => {
                      await unwrap(api.POST('/v1/auth/farmer/otp/request', { body: { phone } }));
                      setSent(true);
                    })
                  }
                >
                  {t('farmerPortal.sendCode')}
                </Button>
              ) : (
                <>
                  <Field label={t('farmerPortal.code')} htmlFor="fp-code">
                    <Input id="fp-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="h-11 text-center text-lg tracking-[0.3em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
                  </Field>
                  <Button
                    size="lg"
                    className="w-full"
                    disabled={code.length !== 6}
                    onClick={() =>
                      guard(async () => {
                        const r = await unwrap(api.POST('/v1/auth/farmer/otp/verify', { body: { phone, code } }));
                        sessionStorage.setItem(KEY, JSON.stringify({ token: r.accessToken, exp: Date.now() + r.expiresIn * 1000 }));
                        setToken(r.accessToken);
                      })
                    }
                  >
                    {t('farmerPortal.login')}
                  </Button>
                </>
              )}
            </CardBody>
          </Card>
        ) : (
          <>
            {me && (
              <Card data-testid="farmer-profile">
                <CardBody className="py-5">
                  <p className="text-lg font-semibold tracking-tight text-neutral-900">
                    {me.firstName} {me.lastName}
                  </p>
                  <p className="mt-0.5 text-sm text-neutral-500">
                    {me.code} · {me.village ?? ''} · {me.operatorName}
                  </p>
                  <p className="mt-3 flex items-center gap-2 text-sm text-neutral-700">
                    <span className="text-neutral-500">{t('farmerPortal.wallet')}</span>
                    <span className="font-medium tabular-nums">{me.walletMasked ?? '—'}</span>
                    {me.walletVerified && <CheckCircle2 className="size-4 text-brand-600" aria-label="✔" />}
                  </p>
                </CardBody>
              </Card>
            )}
            <Card>
              <CardHeader>
                <CardTitle>{t('farmerPortal.plots')}</CardTitle>
              </CardHeader>
              <ul className="divide-y divide-neutral-200/60 text-sm">
                {plots.map((p) => (
                  <li key={p.plotId} className="flex items-center justify-between gap-3 px-5 py-3">
                    <span>
                      <span className="font-medium text-neutral-900">{p.plotCode}</span>
                      <span className="block text-xs text-neutral-500">{p.blockName}</span>
                    </span>
                    <span className="text-right tabular-nums text-neutral-700">
                      {p.areaHa} ha <span className="text-neutral-400">({p.sharePct} %)</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t('farmerPortal.statements')}</CardTitle>
              </CardHeader>
              {statements.length === 0 ? (
                <CardBody>
                  <p className="text-sm text-neutral-500">{t('farmerPortal.noStatements')}</p>
                </CardBody>
              ) : (
                <ul className="divide-y divide-neutral-200/60">
                  {statements.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-4" data-testid={`farmer-statement-${s.runRef}`}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-neutral-900">
                          {s.seasonName} · {s.blockName}
                        </p>
                        <p className="mt-0.5 text-xs leading-relaxed text-neutral-500 tabular-nums">
                          {formatDate(s.createdAt)} · {t('farmerPortal.sales')} {formatXof(s.grossCreditXof)} · {t('farmerPortal.paid')} <strong className="text-neutral-900">{formatXof(s.payoutXof)}</strong>
                          {s.arrearsXof ? ` · ${t('farmerPortal.arrears')} ${formatXof(s.arrearsXof)}` : ''}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          guard(async () => {
                            const r = await unwrap(api.GET('/v1/me/farmer/statements/{id}/pdf', { params: { path: { id: s.id } } }));
                            window.open(r.url, '_blank', 'noopener');
                          })
                        }
                      >
                        <FileText />
                        PDF
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => {
                sessionStorage.removeItem(KEY);
                setToken(null);
                setMe(null);
                setSent(false);
                setCode('');
              }}
            >
              {t('farmerPortal.logout')}
            </Button>
          </>
        )}
      </main>
    </div>
  );
}
