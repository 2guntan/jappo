import createClient, { type Middleware } from 'openapi-fetch';
import type { paths, components } from './schema';

export type { paths, components };
export type Schemas = components['schemas'];

export interface JappoClientOptions {
  baseUrl: string;
  /** Returns the current access token (or null). */
  getToken?: () => string | null | undefined;
  /** Returns the active organisation id sent as X-Org-Id. */
  getOrgId?: () => string | null | undefined;
  /** Called on 401 to refresh; return true if a retry should be attempted. */
  onUnauthorized?: () => Promise<boolean>;
  fetch?: typeof fetch;
}

export function createJappoClient(opts: JappoClientOptions) {
  const client = createClient<paths>({ baseUrl: opts.baseUrl, fetch: opts.fetch, credentials: 'include' });
  const auth: Middleware = {
    onRequest({ request }) {
      const token = opts.getToken?.();
      if (token && !request.headers.has('Authorization')) request.headers.set('Authorization', `Bearer ${token}`);
      const org = opts.getOrgId?.();
      if (org && !request.headers.has('X-Org-Id')) request.headers.set('X-Org-Id', org);
      return request;
    },
  };
  client.use(auth);
  return client;
}

export type JappoClient = ReturnType<typeof createJappoClient>;

/** Error thrown by `unwrap` carrying the RFC 9457 problem document. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly problem: { code?: string; title?: string; detail?: string; errors?: { path: string; message: string }[] },
  ) {
    super(problem.detail ?? problem.title ?? `HTTP ${status}`);
  }
  get code(): string | undefined {
    return this.problem.code;
  }
}

/** Unwrap an openapi-fetch result: return data or throw ApiError. */
export async function unwrap<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const r = await p;
  if (r.error !== undefined || !r.response.ok) {
    throw new ApiError(r.response.status, (r.error ?? {}) as ApiError['problem']);
  }
  return r.data as T;
}
