import { and, asc, desc, gt, lt, or, eq, type SQL, type AnyColumn } from 'drizzle-orm';
import { badRequest } from './errors';

export interface Cursor {
  v: string | number | null;
  id: string;
}

export const encodeCursor = (c: Cursor): string => Buffer.from(JSON.stringify(c)).toString('base64url');
export function decodeCursor(s: string | undefined): Cursor | null {
  if (!s) return null;
  try {
    const c = JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as Cursor;
    if (typeof c.id !== 'string') throw new Error('bad');
    return c;
  } catch {
    throw badRequest('INVALID_CURSOR', 'Cursor is invalid');
  }
}

export interface SortSpec {
  column: AnyColumn;
  dir: 'asc' | 'desc';
  key: string;
}

/**
 * Resolve `?sort=-createdAt` against an allow-list of sortable columns. Default: newest first by id
 * (UUIDv7 ids are time-ordered so id order ≈ creation order).
 */
export function resolveSort(sort: string | undefined, allowed: Record<string, AnyColumn>, idCol: AnyColumn): SortSpec {
  if (!sort) return { column: idCol, dir: 'desc', key: 'id' };
  const dir = sort.startsWith('-') ? 'desc' : 'asc';
  const key = sort.replace(/^[-+]/, '');
  if (key === 'createdAt' || key === 'id') return { column: idCol, dir, key: 'id' };
  const column = allowed[key];
  if (!column) throw badRequest('INVALID_SORT', `Unsupported sort key '${key}'`);
  return { column, dir, key };
}

/** Keyset condition for the page after `cursor`. */
export function cursorWhere(spec: SortSpec, idCol: AnyColumn, cursor: Cursor | null): SQL | undefined {
  if (!cursor) return undefined;
  const cmp = spec.dir === 'desc' ? lt : gt;
  if (spec.key === 'id') return cmp(idCol, cursor.id);
  return or(cmp(spec.column, cursor.v), and(eq(spec.column, cursor.v), cmp(idCol, cursor.id)));
}

export function orderBy(spec: SortSpec, idCol: AnyColumn): SQL[] {
  const f = spec.dir === 'desc' ? desc : asc;
  return spec.key === 'id' ? [f(idCol)] : [f(spec.column), f(idCol)];
}

/** Build the page envelope from `limit + 1` fetched rows. */
export function toPage<R extends { id: string }, O>(
  rows: R[],
  limit: number,
  map: (r: R) => O,
  sortValue?: (r: R) => string | number | null,
): { data: O[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const last = slice[slice.length - 1];
  return {
    data: slice.map(map),
    nextCursor: hasMore && last ? encodeCursor({ id: last.id, v: sortValue ? sortValue(last) : null }) : null,
  };
}

/** Read `filter[key]` query parameters. */
export function filterValue(q: Record<string, unknown>, key: string): string | undefined {
  const v = q[`filter[${key}]`];
  return typeof v === 'string' && v !== '' ? v : undefined;
}
