import type { DbOrTx } from '../db/client';
import { eventsOutbox } from './schema';
import type { ActorContext } from './context';
import { principalId } from './context';
import { newId } from '../db/columns';

export interface DomainEvent<T = Record<string, unknown>> {
  id: string;
  type: string;
  version: number;
  occurredAt: string;
  orgId: string | null;
  aggregate: { type: string; id: string };
  actor: { type: string; id: string | null };
  data: T;
}

/** Write a domain event to the transactional outbox (SPEC §11.1). */
export async function emit(
  tx: DbOrTx,
  actor: ActorContext,
  type: string,
  aggregate: { type: string; id: string },
  data: Record<string, unknown>,
  orgId: string | null = actor.orgId,
): Promise<string> {
  const id = newId();
  await tx.insert(eventsOutbox).values({
    id,
    type,
    version: 1,
    aggregateType: aggregate.type,
    aggregateId: aggregate.id,
    orgId,
    actor: { type: actor.principal.type, id: actor.principal.type === 'anonymous' ? null : principalId(actor) },
    payload: data,
  });
  return id;
}

export function toEnvelope(row: typeof eventsOutbox.$inferSelect): DomainEvent {
  return {
    id: row.id,
    type: row.type,
    version: row.version,
    occurredAt: row.occurredAt.toISOString(),
    orgId: row.orgId,
    aggregate: { type: row.aggregateType, id: row.aggregateId },
    actor: row.actor as DomainEvent['actor'],
    data: row.payload as Record<string, unknown>,
  };
}
