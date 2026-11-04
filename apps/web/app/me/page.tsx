'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { createJappoClient, unwrap, type Schemas } from '@jappo/sdk';
import { formatDate, formatXof } from '@/lib/utils';
import { problemMessage } from '@/lib/errors';
import { Alert, Button, Field, Input } from '@/components/ui';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';

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
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between bg-brand-700 px-4 py-3 text-white">
        <span className="font-semibold">{t('farmerPortal.title')}</span>
        <div className="rounded bg-white/90"><LocaleSwitcher /></div>
      </header>
      <main className="flex-1 space-y-4 p-4">
        {err && <Alert tone="error">{err}</Alert>}
        {!token ? (
          <div className="space-y-3">
            <p className="text-sm text-neutral-600">{t('farmerPortal.intro')}</p>
            <Field label={t('farmerPortal.phone')} htmlFor="fp-phone"><Input id="fp-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, ''))} /></Field>
            {!sent ? (
              <Button className="w-full" disabled={phone.length < 9} onClick={() => guard(async () => { await unwrap(api.POST('/v1/auth/farmer/otp/request', { body: { phone } })); setSent(true); })}>{t('farmerPortal.sendCode')}</Button>
            ) : (
              <>
                <Field label={t('farmerPortal.code')} htmlFor="fp-code"><Input id="fp-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></Field>
                <Button className="w-full" disabled={code.length !== 6} onClick={() => guard(async () => {
                  const r = await unwrap(api.POST('/v1/auth/farmer/otp/verify', { body: { phone, code } }));
                  sessionStorage.setItem(KEY, JSON.stringify({ token: r.accessToken, exp: Date.now() + r.expiresIn * 1000 }));
                  setToken(r.accessToken);
                })}>{t('farmerPortal.login')}</Button>
              </>
            )}
          </div>
        ) : (
          <>
            {me && (
              <section className="rounded-lg border border-neutral-200 p-4 text-sm" data-testid="farmer-profile">
                <p className="text-base font-semibold">{me.firstName} {me.lastName}</p>
                <p>{me.code} · {me.village ?? ''} · {me.operatorName}</p>
                <p>{t('farmerPortal.wallet')} : {me.walletMasked ?? '—'} {me.walletVerified ? '✔' : ''}</p>
              </section>
            )}
            <section className="rounded-lg border border-neutral-200 p-4 text-sm">
              <p className="mb-2 font-medium">{t('farmerPortal.plots')}</p>
              <ul className="space-y-1">{plots.map((p) => <li key={p.plotId}>{p.plotCode} · {p.blockName} · {p.areaHa} ha ({p.sharePct} %)</li>)}</ul>
            </section>
            <section className="rounded-lg border border-neutral-200 p-4 text-sm">
              <p className="mb-2 font-medium">{t('farmerPortal.statements')}</p>
              {statements.length === 0 ? <p className="text-neutral-600">{t('farmerPortal.noStatements')}</p> : (
                <ul className="space-y-3">
                  {statements.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2" data-testid={`farmer-statement-${s.runRef}`}>
                      <div>
                        <p className="font-medium">{s.seasonName} · {s.blockName}</p>
                        <p className="text-xs text-neutral-600">{formatDate(s.createdAt)} · {t('farmerPortal.sales')} {formatXof(s.grossCreditXof)} · {t('farmerPortal.paid')} <strong>{formatXof(s.payoutXof)}</strong>{s.arrearsXof ? ` · ${t('farmerPortal.arrears')} ${formatXof(s.arrearsXof)}` : ''}</p>
                      </div>
                      <Button size="sm" variant="secondary" onClick={() => guard(async () => { const r = await unwrap(api.GET('/v1/me/farmer/statements/{id}/pdf', { params: { path: { id: s.id } } })); window.open(r.url, '_blank', 'noopener'); })}>PDF</Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <Button variant="ghost" className="w-full" onClick={() => { sessionStorage.removeItem(KEY); setToken(null); setMe(null); setSent(false); setCode(''); }}>{t('farmerPortal.logout')}</Button>
          </>
        )}
      </main>
    </div>
  );
}
