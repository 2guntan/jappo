'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ApiError } from '@jappo/sdk';
import { problemMessage } from './errors';

/** Run an async action with busy flag and translated error/success message. */
export function useAction() {
  const t = useTranslations();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, success?: string) => {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      if (success) setMsg({ tone: 'success', text: success });
      return true;
    } catch (e) {
      setMsg({ tone: 'error', text: problemMessage(e, t) });
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { busy, msg, setMsg, run };
}

export const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });

/** Upload a file via POST /v1/files and return its id. */
export async function uploadFile(authedFetch: (p: string, i?: RequestInit) => Promise<Response>, file: File | Blob, name?: string): Promise<string> {
  const fd = new FormData();
  fd.append('file', file, name ?? (file as File).name ?? 'file');
  const r = await authedFetch('/v1/files', { method: 'POST', body: fd });
  const body = await r.json();
  if (!r.ok) throw new ApiError(r.status, body);
  return body.id as string;
}
