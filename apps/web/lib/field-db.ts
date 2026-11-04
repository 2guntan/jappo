'use client';

import Dexie, { type Table } from 'dexie';

export interface LocalBlock { id: string; ref: string; name: string; village: string | null; status: string; boundary: unknown; version: number }
export interface LocalPlot { id: string; blockId: string; code: string; areaHa: number; status: string; geometry: unknown; version: number; archived?: boolean }
export interface LocalFarmer { key: string; id: string | null; clientId: string | null; code: string | null; firstName: string; lastName: string; sex: string; phone: string | null; village: string | null; kycStatus: string; version: number; pending: boolean }
export interface LocalAllocation { key: string; id: string | null; plotId: string; farmerKey: string; sharePct: number; status: string; pending: boolean }
export interface QueuedOp { clientId: string; type: string; payload: Record<string, unknown>; createdAt: string; status: 'pending' | 'applied' | 'rejected'; error?: string | null; entityId?: string | null; label: string }
export interface Kv { key: string; value: unknown }

/** IndexedDB store for the offline field app (SPEC §12.8). */
class FieldDb extends Dexie {
  blocks!: Table<LocalBlock, string>;
  plots!: Table<LocalPlot, string>;
  farmers!: Table<LocalFarmer, string>;
  allocations!: Table<LocalAllocation, string>;
  queue!: Table<QueuedOp, string>;
  kv!: Table<Kv, string>;
  constructor() {
    super('jappo-field');
    this.version(1).stores({
      blocks: 'id',
      plots: 'id, blockId',
      farmers: 'key, id, clientId',
      allocations: 'key, plotId, farmerKey',
      queue: 'clientId, status, createdAt',
      kv: 'key',
    });
  }
}

let db: FieldDb | null = null;
export const fieldDb = (): FieldDb => (db ??= new FieldDb());

export const newClientId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await fieldDb().kv.get(key))?.value as T | undefined;
}
export const kvSet = (key: string, value: unknown) => fieldDb().kv.put({ key, value });
