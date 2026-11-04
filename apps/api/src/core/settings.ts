import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { holidays, settings } from './schema';

/** Platform setting with a typed default (SPEC §7.2 `settings`). */
export async function getSetting<T>(db: DbOrTx, key: string, fallback: T): Promise<T> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return (row?.value as T | undefined) ?? fallback;
}

export async function holidayDates(db: DbOrTx): Promise<string[]> {
  return (await db.select({ d: holidays.date }).from(holidays)).map((h) => h.d);
}
