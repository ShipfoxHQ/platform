import type {DomainEvent, OutboxTable} from '@shipfox/node-outbox';
import {asc, inArray, isNull, sql} from 'drizzle-orm';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';

interface PublisherSource {
  name: string;
  table: OutboxTable;
  db: () => NodePgDatabase<Record<string, unknown>>;
}

export interface DrainedEvent {
  source: string;
  id: string;
  event: DomainEvent;
}

const _sources: PublisherSource[] = [];

const BATCH_SIZE = 100;

export function registerPublisher(config: PublisherSource): void {
  _sources.push(config);
}

export async function drainAll(): Promise<DrainedEvent[]> {
  const results: DrainedEvent[] = [];

  for (const source of _sources) {
    const rows = await source
      .db()
      .select()
      .from(source.table)
      .where(isNull(source.table.dispatchedAt))
      .orderBy(asc(source.table.createdAt))
      .limit(BATCH_SIZE);

    for (const row of rows) {
      results.push({
        source: source.name,
        id: row.id,
        event: {
          id: row.id,
          type: row.eventType,
          payload: row.payload,
          createdAt: row.createdAt,
        },
      });
    }
  }

  return results;
}

export async function markDispatched(source: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const config = _sources.find((s) => s.name === source);
  if (!config) return;

  await config
    .db()
    .update(config.table)
    .set({dispatchedAt: sql`now()`})
    .where(inArray(config.table.id, ids));
}

export function resetPublishers(): void {
  _sources.length = 0;
}
