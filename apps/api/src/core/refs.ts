import { sql } from 'drizzle-orm';
import { formatRef } from '@jappo/domain';
import type { DbOrTx } from '../db/client';

/** Allocate the next human reference, e.g. BLK-2026-0001, with row locking (SPEC §4.2). */
export async function nextRef(tx: DbOrTx, prefix: string, year = new Date().getUTCFullYear()): Promise<string> {
  const r = await tx.execute<{ last: number }>(sql`
    insert into ref_sequences (prefix, year, last) values (${prefix}, ${year}, 1)
    on conflict (prefix, year) do update set last = ref_sequences.last + 1
    returning last`);
  const last = Number(r.rows[0]?.last);
  return formatRef(prefix, year, last);
}
