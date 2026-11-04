import { ApiError } from '@jappo/sdk';
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

/** Map an API problem to a translated message key or detail text. */
export function problemMessage(e: unknown, t: (key: string) => string): string {
  if (e instanceof ApiError) {
    const key = `errors.${e.code ?? 'UNKNOWN'}`;
    const translated = t(key);
    return translated && translated !== key ? translated : (e.problem.detail ?? e.problem.title ?? t('errors.UNKNOWN'));
  }
  return t('errors.UNKNOWN');
}

/** Push API field errors (`body.email`) into react-hook-form. */
export function applyFieldErrors<T extends FieldValues>(e: unknown, setError: UseFormSetError<T>): boolean {
  if (!(e instanceof ApiError) || !e.problem.errors?.length) return false;
  for (const fe of e.problem.errors) {
    const name = fe.path.replace(/^body\./, '') as Path<T>;
    setError(name, { type: 'server', message: fe.message });
  }
  return true;
}
