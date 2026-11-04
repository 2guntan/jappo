'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslations } from 'next-intl';
import { unwrap } from '@jappo/sdk';
import { useSession } from '@/lib/session';
import { fieldDb, kvGet, kvSet, newClientId, type LocalFarmer, type QueuedOp } from '@/lib/field-db';
import { formatDateTime } from '@/lib/utils';
import { Alert, Badge, Button, Field, Input, Select } from '@/components/ui';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { SignContractsScreen } from '@/components/field/sign-contracts';

type Screen = 'home' | 'enrol' | 'map' | 'allocate' | 'queue' | 'sign';

function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

async function enqueue(op: Omit<QueuedOp, 'status' | 'createdAt'>) {
  await fieldDb().queue.put({ ...op, status: 'pending', createdAt: new Date().toISOString() });
}

export default function FieldApp() {
  const t = useTranslations('field');
  const tc = useTranslations();
  const { status, api, me } = useSession();
  const online = useOnline();
  const [screen, setScreen] = useState<Screen>('home');
  const [msg, setMsg] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const blocks = useLiveQuery(() => fieldDb().blocks.toArray(), []) ?? [];
  const plots = useLiveQuery(() => fieldDb().plots.toArray(), []) ?? [];
  const farmers = useLiveQuery(() => fieldDb().farmers.toArray(), []) ?? [];
  const queue = useLiveQuery(() => fieldDb().queue.orderBy('createdAt').toArray(), []) ?? [];
  const pending = queue.filter((q) => q.status === 'pending');
  const [serverBlocks, setServerBlocks] = useState<{ id: string; name: string; ref: string }[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    void kvGet<string>('lastSync').then((v) => setLastSync(v ?? null));
    void kvGet<string[]>('blockIds').then((v) => setChosen(v ?? []));
  }, []);
  useEffect(() => {
    if (status === 'authenticated' && online) {
      unwrap(api.GET('/v1/blocks', { params: { query: { limit: 200 } } }))
        .then((r) => setServerBlocks(r.data.map((b) => ({ id: b.id, name: b.name, ref: b.ref }))))
        .catch(() => undefined);
    }
  }, [status, online, api]);

  const applyServerRows = async (data: { blocks?: Record<string, unknown>[]; plots: Record<string, unknown>[]; farmers: Record<string, unknown>[]; allocations: Record<string, unknown>[] }) => {
    const d = fieldDb();
    await d.transaction('rw', [d.blocks, d.plots, d.farmers, d.allocations], async () => {
      if (data.blocks) await d.blocks.bulkPut(data.blocks as never[]);
      for (const p of data.plots) {
        if (p.archived) await d.plots.delete(p.id as string);
        else await d.plots.put(p as never);
      }
      for (const f of data.farmers) {
        const existing = await d.farmers.where('id').equals(f.id as string).first();
        await d.farmers.put({ key: existing?.key ?? (f.id as string), id: f.id as string, clientId: existing?.clientId ?? null, code: f.code as string, firstName: f.firstName as string, lastName: f.lastName as string, sex: f.sex as string, phone: (f.phone as string) ?? null, village: (f.village as string) ?? null, kycStatus: f.kycStatus as string, version: f.version as number, pending: false });
      }
      for (const a of data.allocations) {
        const fk = (await d.farmers.where('id').equals(a.farmerId as string).first())?.key ?? (a.farmerId as string);
        await d.allocations.put({ key: a.id as string, id: a.id as string, plotId: a.plotId as string, farmerKey: fk, sharePct: a.sharePct as number, status: a.status as string, pending: false });
      }
    });
  };

  const download = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const boot = await unwrap(api.GET('/v1/field/bootstrap', { params: { query: { blockIds: chosen.join(',') } } }));
      await kvSet('blockIds', chosen);
      await kvSet('syncToken', boot.syncToken);
      await applyServerRows(boot);
      await kvSet('lastSync', new Date().toISOString());
      setLastSync(new Date().toISOString());
      setMsg({ tone: 'success', text: t('saved') });
    } catch {
      setMsg({ tone: 'error', text: tc('errors.UNKNOWN') });
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const ops = (await fieldDb().queue.where('status').equals('pending').sortBy('createdAt')).map((q) => ({ clientId: q.clientId, type: q.type, payload: q.payload, createdAt: q.createdAt }));
      const res = await unwrap(api.POST('/v1/field/sync', { body: { syncToken: (await kvGet<string>('syncToken')) ?? undefined, blockIds: (await kvGet<string[]>('blockIds')) ?? [], ops } }));
      const d = fieldDb();
      let applied = 0;
      let rejected = 0;
      for (const r of res.results) {
        const st = r.status === 'rejected' ? 'rejected' : 'applied';
        if (st === 'applied') applied++;
        else rejected++;
        await d.queue.update(r.clientId, { status: st, error: r.error?.message ?? null, entityId: r.entityId });
        if (st === 'applied' && r.entityId) {
          const lf = await d.farmers.where('clientId').equals(r.clientId).first();
          if (lf) await d.farmers.update(lf.key, { id: r.entityId, pending: false });
        }
      }
      await d.allocations.filter((a) => a.pending).delete();
      await applyServerRows(res.changes as never);
      await kvSet('syncToken', res.syncToken);
      await kvSet('lastSync', new Date().toISOString());
      setLastSync(new Date().toISOString());
      setMsg({ tone: rejected ? 'error' : 'success', text: t('syncDone', { applied, rejected }) });
    } catch {
      setMsg({ tone: 'error', text: tc('errors.UNKNOWN') });
    } finally {
      setBusy(false);
    }
  };

  const canSync = online && status === 'authenticated';
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-brand-700 px-4 py-3 text-white">
        <button onClick={() => setScreen('home')} className="font-semibold">{t('title')}</button>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs ${online ? 'bg-brand-500' : 'bg-amber-500'}`} data-testid="online-status">{online ? t('online') : t('offline')}</span>
          <div className="rounded bg-white/90"><LocaleSwitcher /></div>
        </div>
      </header>
      <main className="flex-1 space-y-4 p-4">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        {screen === 'home' && (
          <>
            <div className="rounded-lg border border-neutral-200 p-4 text-sm">
              <p>{t('lastSync')} : {lastSync ? formatDateTime(lastSync) : t('never')}</p>
              <p data-testid="pending-count">{t('pending', { count: pending.length })}</p>
              <Button className="mt-3 w-full" disabled={!canSync || busy} loading={busy} onClick={sync}>{busy ? t('syncing') : t('sync')}</Button>
            </div>
            {canSync && (
              <div className="space-y-2 rounded-lg border border-neutral-200 p-4">
                <p className="text-sm font-medium">{t('chooseBlocks')}</p>
                {serverBlocks.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={chosen.includes(b.id)} onChange={(e) => setChosen(e.target.checked ? [...chosen, b.id] : chosen.filter((x) => x !== b.id))} />
                    {b.ref} · {b.name}
                  </label>
                ))}
                <Button variant="secondary" className="w-full" disabled={!chosen.length || busy} onClick={download}>{t('download')}</Button>
              </div>
            )}
            {blocks.length === 0 ? (
              <p className="text-sm text-neutral-600">{t('noBlocks')}</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {(['enrol', 'map', 'allocate', 'queue'] as const).map((s) => (
                  <button key={s} onClick={() => setScreen(s)} className="rounded-lg border border-brand-100 bg-brand-50 p-4 text-left text-sm font-medium text-brand-900">
                    {s === 'enrol' ? t('enrol') : s === 'map' ? t('mapPlot') : s === 'allocate' ? t('allocate') : t('queue')}
                  </button>
                ))}
              </div>
            )}
            {canSync && <Button variant="secondary" className="w-full" data-testid="field-sign" onClick={() => setScreen('sign')}>{t('signContracts')}</Button>}
            <p className="text-xs text-neutral-500">{t('farmersLocal')} : {farmers.length} · {blocks.map((b) => b.ref).join(', ')}</p>
            {me && <Link href="/app" className="block text-center text-sm text-brand-700">{t('back')}</Link>}
          </>
        )}
        {screen === 'enrol' && <EnrolScreen onDone={(text) => { setMsg({ tone: 'success', text }); setScreen('home'); }} />}
        {screen === 'map' && <MapPlotScreen blocks={blocks} onDone={(text) => { setMsg({ tone: 'success', text }); setScreen('home'); }} />}
        {screen === 'allocate' && <AllocateScreen plots={plots} farmers={farmers} onDone={(text) => { setMsg({ tone: 'success', text }); setScreen('home'); }} />}
        {screen === 'sign' && (canSync ? <SignContractsScreen /> : <Alert tone="info">{t('signOnline')}</Alert>)}
        {screen === 'queue' && (
          <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 text-sm" data-testid="sync-queue">
            {queue.map((q) => (
              <li key={q.clientId} className="flex items-start justify-between gap-2 p-3">
                <div>
                  <p className="font-medium">{q.label}</p>
                  <p className="text-xs text-neutral-500">{q.type} · {formatDateTime(q.createdAt)}</p>
                  {q.error && <p className="text-xs text-red-600">{q.error}</p>}
                </div>
                <Badge tone={q.status === 'applied' ? 'green' : q.status === 'rejected' ? 'red' : 'amber'}>{q.status === 'applied' ? t('applied') : q.status === 'rejected' ? t('rejected') : t('pendingOp')}</Badge>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function EnrolScreen({ onDone }: { onDone: (msg: string) => void }) {
  const t = useTranslations();
  const [f, setF] = useState({ firstName: '', lastName: '', sex: 'F', birthYear: '', phone: '+221', village: '', walletProvider: 'wave', walletNumber: '', consentData: true, consentCreditBureau: true });
  const [gps, setGps] = useState<[number, number] | null>(null);
  const save = async () => {
    const clientId = newClientId('farmer');
    const payload: Record<string, unknown> = {
      firstName: f.firstName.trim(),
      lastName: f.lastName.trim(),
      sex: f.sex,
      birthYear: f.birthYear ? Number(f.birthYear) : null,
      phone: f.phone.length > 5 ? f.phone : null,
      village: f.village || null,
      mobileWalletProvider: f.walletNumber ? f.walletProvider : 'none',
      mobileWalletNumber: f.walletNumber || null,
      consentData: f.consentData,
      consentCreditBureau: f.consentCreditBureau,
      homeLocation: gps ? { type: 'Point', coordinates: gps } : null,
    };
    await fieldDb().farmers.put({ key: clientId, id: null, clientId, code: null, firstName: payload.firstName as string, lastName: payload.lastName as string, sex: f.sex, phone: payload.phone as string | null, village: f.village || null, kycStatus: 'pending', version: 1, pending: true });
    await enqueue({ clientId, type: 'farmer.create', payload, label: `${payload.firstName} ${payload.lastName}` });
    onDone(t('field.saved'));
  };
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <h2 className="font-semibold">{t('field.enrol')}</h2>
      <Field label={t('farmers.firstName')} htmlFor="fe-first"><Input id="fe-first" required value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} /></Field>
      <Field label={t('farmers.lastName')} htmlFor="fe-last"><Input id="fe-last" required value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} /></Field>
      <Field label={t('farmers.sex')} htmlFor="fe-sex"><Select id="fe-sex" value={f.sex} onChange={(e) => setF({ ...f, sex: e.target.value })}><option value="F">{t('enum.sex.F')}</option><option value="M">{t('enum.sex.M')}</option></Select></Field>
      <Field label={t('farmers.birthYear')} htmlFor="fe-year"><Input id="fe-year" type="number" value={f.birthYear} onChange={(e) => setF({ ...f, birthYear: e.target.value })} /></Field>
      <Field label={t('common.phone')} htmlFor="fe-phone"><Input id="fe-phone" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
      <Field label={t('farmers.village')} htmlFor="fe-village"><Input id="fe-village" value={f.village} onChange={(e) => setF({ ...f, village: e.target.value })} /></Field>
      <Field label={t('farmers.walletProvider')} htmlFor="fe-wp"><Select id="fe-wp" value={f.walletProvider} onChange={(e) => setF({ ...f, walletProvider: e.target.value })}>{['wave', 'orange_money', 'free_money', 'other'].map((w) => <option key={w} value={w}>{t(`enum.walletProvider.${w}`)}</option>)}</Select></Field>
      <Field label={t('farmers.walletNumber')} htmlFor="fe-wn"><Input id="fe-wn" type="tel" value={f.walletNumber} onChange={(e) => setF({ ...f, walletNumber: e.target.value })} /></Field>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={f.consentData} onChange={(e) => setF({ ...f, consentData: e.target.checked })} /> {t('farmers.consentData')}</label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={f.consentCreditBureau} onChange={(e) => setF({ ...f, consentCreditBureau: e.target.checked })} /> {t('farmers.consentCreditBureau')}</label>
      <Button type="button" variant="secondary" size="sm" onClick={() => navigator.geolocation?.getCurrentPosition((p) => setGps([p.coords.longitude, p.coords.latitude]), () => setGps(null), { enableHighAccuracy: true, timeout: 10000 })}>
        GPS {gps ? `✓ ${gps[1].toFixed(5)}, ${gps[0].toFixed(5)}` : ''}
      </Button>
      <Button type="submit" className="w-full" disabled={!f.firstName || !f.lastName}>{t('common.save')}</Button>
    </form>
  );
}

function MapPlotScreen({ blocks, onDone }: { blocks: { id: string; ref: string; name: string }[]; onDone: (msg: string) => void }) {
  const t = useTranslations();
  const [blockId, setBlockId] = useState(blocks[0]?.id ?? '');
  const [points, setPoints] = useState<[number, number][]>([]);
  const [manual, setManual] = useState('');
  const [error, setError] = useState<string | null>(null);
  const record = () =>
    navigator.geolocation
      ? navigator.geolocation.getCurrentPosition((p) => setPoints((ps) => [...ps, [p.coords.longitude, p.coords.latitude]]), () => setError(t('field.gpsUnavailable')), { enableHighAccuracy: true, timeout: 15000 })
      : setError(t('field.gpsUnavailable'));
  const save = async () => {
    const ring = [...points, points[0]!];
    const clientId = newClientId('plot');
    await enqueue({ clientId, type: 'plot.create', payload: { blockId, geometry: { type: 'Polygon', coordinates: [ring] } }, label: `${blocks.find((b) => b.id === blockId)?.ref} · ${points.length} pts` });
    onDone(t('field.saved'));
  };
  return (
    <div className="space-y-3">
      <h2 className="font-semibold">{t('field.mapPlot')}</h2>
      {error && <Alert tone="error">{error}</Alert>}
      <Field label={t('adminLand.block')} htmlFor="mp-block"><Select id="mp-block" value={blockId} onChange={(e) => setBlockId(e.target.value)}>{blocks.map((b) => <option key={b.id} value={b.id}>{b.ref} · {b.name}</option>)}</Select></Field>
      <Button variant="secondary" className="w-full" onClick={record}>{t('field.recordPoint')}</Button>
      <Field label="lon,lat" htmlFor="mp-manual">
        <div className="flex gap-2">
          <Input id="mp-manual" placeholder="-16.27,12.58" value={manual} onChange={(e) => setManual(e.target.value)} />
          <Button size="sm" variant="ghost" onClick={() => { const [lo, la] = manual.split(',').map(Number); if (Number.isFinite(lo) && Number.isFinite(la)) { setPoints([...points, [lo!, la!]]); setManual(''); } }}>+</Button>
        </div>
      </Field>
      <p className="text-sm">{t('field.points', { count: points.length })}</p>
      <Button className="w-full" disabled={points.length < 3 || !blockId} onClick={save}>{t('field.savePlot')}</Button>
    </div>
  );
}

function AllocateScreen({ plots, farmers, onDone }: { plots: { id: string; code: string; status: string; blockId: string }[]; farmers: LocalFarmer[]; onDone: (msg: string) => void }) {
  const t = useTranslations();
  const available = useMemo(() => plots.filter((p) => p.status === 'available').sort((a, b) => a.code.localeCompare(b.code)), [plots]);
  const [plotId, setPlotId] = useState('');
  const [farmerKey, setFarmerKey] = useState('');
  const save = async () => {
    const fm = farmers.find((f) => f.key === farmerKey)!;
    const clientId = newClientId('alloc');
    const payload = fm.id ? { plotId, farmerId: fm.id, sharePct: 100 } : { plotId, farmerClientId: fm.clientId, sharePct: 100 };
    await enqueue({ clientId, type: 'allocation.create', payload, label: `${plots.find((p) => p.id === plotId)?.code} → ${fm.firstName} ${fm.lastName}` });
    await fieldDb().plots.update(plotId, { status: 'allocated' });
    await fieldDb().allocations.put({ key: clientId, id: null, plotId, farmerKey, sharePct: 100, status: 'active', pending: true });
    onDone(t('field.saved'));
  };
  return (
    <div className="space-y-3">
      <h2 className="font-semibold">{t('field.allocate')}</h2>
      <Field label={t('blocks.code')} htmlFor="al-plot"><Select id="al-plot" value={plotId} onChange={(e) => setPlotId(e.target.value)}><option value="">—</option>{available.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</Select></Field>
      <Field label={t('blocks.selectFarmer')} htmlFor="al-farmer"><Select id="al-farmer" value={farmerKey} onChange={(e) => setFarmerKey(e.target.value)}><option value="">—</option>{farmers.map((f) => <option key={f.key} value={f.key}>{f.code ?? '…'} · {f.firstName} {f.lastName}</option>)}</Select></Field>
      <Button className="w-full" disabled={!plotId || !farmerKey} onClick={save}>{t('blocks.allocate')}</Button>
    </div>
  );
}
