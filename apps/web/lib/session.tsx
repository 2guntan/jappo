'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createJappoClient, unwrap, ApiError, type JappoClient, type Schemas } from '@jappo/sdk';
import { readCookie } from './utils';

export type Me = Schemas['Me'];
type TokenResponse = Schemas['TokenResponse'];

interface SessionState {
  status: 'loading' | 'anonymous' | 'authenticated';
  me: Me | null;
  activeOrgId: string | null;
}

interface SessionApi extends SessionState {
  api: JappoClient;
  /** fetch() with Authorization / X-Org-Id and refresh-on-401 (for multipart uploads and downloads). */
  authedFetch: (path: string, init?: RequestInit) => Promise<Response>;
  /** Store tokens returned by login/signup/accept endpoints and load /me. */
  acceptTokens: (t: TokenResponse) => Promise<Me>;
  logout: () => Promise<void>;
  setActiveOrg: (orgId: string) => void;
  reloadMe: () => Promise<Me | null>;
  hasPermission: (p: string) => boolean;
  activeMembership: Me['memberships'][number] | null;
}

const Ctx = createContext<SessionApi | null>(null);
const ORG_KEY = 'jappo.activeOrg';

function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const tokenRef = useRef<string | null>(null);
  const orgRef = useRef<string | null>(null);
  const refreshing = useRef<Promise<boolean> | null>(null);
  const [state, setState] = useState<SessionState>({ status: 'loading', me: null, activeOrgId: null });

  const refresh = useCallback(async (): Promise<boolean> => {
    refreshing.current ??= (async () => {
      const csrf = readCookie('jappo_csrf');
      if (!csrf) return false;
      const r = await window.fetch('/v1/auth/refresh', { method: 'POST', headers: { 'X-CSRF-Token': csrf }, credentials: 'include' });
      if (!r.ok) return false;
      tokenRef.current = ((await r.json()) as TokenResponse).accessToken;
      return true;
    })().finally(() => {
      setTimeout(() => (refreshing.current = null), 0);
    });
    return refreshing.current;
  }, []);

  const authedFetch = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const build = () => {
        const h = new Headers(init.headers);
        if (tokenRef.current) h.set('Authorization', `Bearer ${tokenRef.current}`);
        if (orgRef.current) h.set('X-Org-Id', orgRef.current);
        return { ...init, headers: h, credentials: 'include' as const };
      };
      let res = await window.fetch(path, build());
      if (res.status === 401 && (await refresh())) res = await window.fetch(path, build());
      return res;
    },
    [refresh],
  );

  const api = useMemo(() => {
    const authFetch: typeof fetch = async (input, init) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const retry = req.clone();
      const res = await window.fetch(req);
      if (res.status === 401 && !new URL(req.url).pathname.startsWith('/v1/auth/') && (await refresh())) {
        retry.headers.set('Authorization', `Bearer ${tokenRef.current}`);
        return window.fetch(retry);
      }
      return res;
    };
    return createJappoClient({
      baseUrl: typeof window === 'undefined' ? '' : window.location.origin,
      getToken: () => tokenRef.current,
      getOrgId: () => orgRef.current,
      fetch: authFetch,
    });
  }, [refresh]);

  const reloadMe = useCallback(async () => {
    if (!tokenRef.current) return null;
    try {
      orgRef.current = safeStorage()?.getItem(ORG_KEY) ?? null;
      let me: Me;
      try {
        me = await unwrap(api.GET('/v1/me'));
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 403) throw e;
        orgRef.current = null; // stale stored organisation
        me = await unwrap(api.GET('/v1/me'));
      }
      if (!me.activeOrgId && me.memberships[0]) {
        orgRef.current = me.memberships[0].orgId;
        me = await unwrap(api.GET('/v1/me'));
      }
      orgRef.current = me.activeOrgId;
      setState({ status: 'authenticated', me, activeOrgId: me.activeOrgId });
      return me;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        tokenRef.current = null;
        setState({ status: 'anonymous', me: null, activeOrgId: null });
        return null;
      }
      throw e;
    }
  }, [api]);

  useEffect(() => {
    void (async () => {
      if (await refresh()) await reloadMe();
      else setState({ status: 'anonymous', me: null, activeOrgId: null });
    })();
  }, [refresh, reloadMe]);

  const acceptTokens = useCallback(
    async (t: TokenResponse) => {
      tokenRef.current = t.accessToken;
      const me = await reloadMe();
      if (!me) throw new Error('session');
      return me;
    },
    [reloadMe],
  );

  const logout = useCallback(async () => {
    const csrf = readCookie('jappo_csrf');
    await window.fetch('/v1/auth/logout', { method: 'POST', headers: csrf ? { 'X-CSRF-Token': csrf } : {}, credentials: 'include' }).catch(() => undefined);
    tokenRef.current = null;
    orgRef.current = null;
    setState({ status: 'anonymous', me: null, activeOrgId: null });
  }, []);

  const setActiveOrg = useCallback(
    (orgId: string) => {
      safeStorage()?.setItem(ORG_KEY, orgId);
      orgRef.current = orgId;
      void reloadMe();
    },
    [reloadMe],
  );

  const value = useMemo<SessionApi>(() => {
    const perms = new Set(state.me?.permissions ?? []);
    return {
      ...state,
      api,
      authedFetch,
      acceptTokens,
      logout,
      setActiveOrg,
      reloadMe,
      hasPermission: (p: string) => perms.has('*') || perms.has(p) || perms.has(`${p.split(':')[0]}:*`),
      activeMembership: state.me?.memberships.find((m) => m.orgId === state.activeOrgId) ?? null,
    };
  }, [state, api, authedFetch, acceptTokens, logout, setActiveOrg, reloadMe]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
