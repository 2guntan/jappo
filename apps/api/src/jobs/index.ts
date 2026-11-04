import { and, asc, eq, isNull, lt, sql } from 'drizzle-orm';
import PgBoss from 'pg-boss';
import type { ModuleContext } from '../core/module';
import { eventsOutbox } from '../core/schema';
import { toEnvelope, type DomainEvent } from '../core/events';
import { deliverPendingNotifications } from '../core/notify';
import { verifyAuditChain } from '../core/audit';
import { MODULES } from '../modules';

export type EventHandler = (e: DomainEvent, ctx: ModuleContext) => Promise<void>;
const MAX_ATTEMPTS = 10;

export function collectHandlers(): Map<string, EventHandler[]> {
  const map = new Map<string, EventHandler[]>();
  for (const m of MODULES) {
    for (const [type, h] of Object.entries(m.eventHandlers ?? {})) {
      map.set(type, [...(map.get(type) ?? []), h]);
    }
  }
  return map;
}

/** Dispatch pending outbox events to module handlers (at-least-once; handlers must be idempotent). */
export async function dispatchOutbox(ctx: ModuleContext, handlers = collectHandlers(), batch = 100): Promise<number> {
  return ctx.db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(eventsOutbox)
      .where(and(isNull(eventsOutbox.dispatchedAt), lt(eventsOutbox.attempts, MAX_ATTEMPTS)))
      .orderBy(asc(eventsOutbox.occurredAt), asc(eventsOutbox.id))
      .limit(batch)
      .for('update', { skipLocked: true });
    for (const row of rows) {
      const event = toEnvelope(row);
      try {
        for (const h of handlers.get(row.type) ?? []) await h(event, ctx);
        for (const h of handlers.get('*') ?? []) await h(event, ctx);
        await tx.update(eventsOutbox).set({ dispatchedAt: new Date(), attempts: row.attempts + 1, lastError: null }).where(eq(eventsOutbox.id, row.id));
      } catch (e) {
        await tx.update(eventsOutbox).set({ attempts: row.attempts + 1, lastError: String((e as Error).message).slice(0, 2000) }).where(eq(eventsOutbox.id, row.id));
      }
    }
    return rows.length;
  });
}

export interface ScheduledJob {
  name: string;
  cron: string;
  run: (ctx: ModuleContext) => Promise<unknown>;
}

/** Core scheduled jobs (UTC cron); modules contribute more via JappoModule.jobs. */
export const CORE_JOBS: ScheduledJob[] = [
  {
    name: 'audit.verify-chain',
    cron: '15 2 * * *',
    run: async (ctx) => {
      const r = await verifyAuditChain(ctx.db);
      if (!r.ok) throw new Error(`Audit chain broken at seq ${r.brokenAtSeq}`);
      return r;
    },
  },
  {
    name: 'maintenance.purge-idempotency',
    cron: '30 * * * *',
    run: async (ctx) => ctx.db.execute(sql`delete from idempotency_keys where expires_at < now()`),
  },
];

/** Start the worker: pg-boss for cron jobs, short polling loops for outbox + notifications. */
export async function startWorker(ctx: ModuleContext, log: (msg: string, extra?: unknown) => void = console.log) {
  const boss = new PgBoss({ connectionString: ctx.env.DATABASE_URL, schema: 'pgboss' });
  boss.on('error', (e) => log('pg-boss error', e));
  await boss.start();
  const jobs = [...CORE_JOBS, ...MODULES.flatMap((m) => (m.jobs ?? []).filter((j) => j.cron).map((j) => ({ name: j.name, cron: j.cron!, run: (c: ModuleContext) => j.handler(c, null) })))];
  for (const j of jobs) {
    await boss.createQueue(j.name);
    await boss.schedule(j.name, j.cron, {}, { tz: 'UTC' });
    await boss.work(j.name, async () => {
      const r = await j.run(ctx);
      log(`job ${j.name} done`, r);
    });
  }
  const handlers = collectHandlers();
  let stopped = false;
  const loop = async (name: string, fn: () => Promise<number>, idleMs: number) => {
    while (!stopped) {
      let n = 0;
      try {
        n = await fn();
      } catch (e) {
        log(`${name} failed`, e);
      }
      if (n === 0) await new Promise((r) => setTimeout(r, idleMs));
    }
  };
  void loop('outbox', () => dispatchOutbox(ctx, handlers), 1000);
  void loop('notifications', () => deliverPendingNotifications(ctx), 2000);
  return {
    stop: async () => {
      stopped = true;
      await boss.stop();
    },
  };
}
