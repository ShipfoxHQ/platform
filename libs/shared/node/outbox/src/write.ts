import type {OutboxTable} from './schema.js';
import type {EventMapLike, EventType} from './types.js';

interface DrizzleInsertable {
  insert: (table: OutboxTable) => {
    values: (values: {eventType: string; payload: unknown}) => Promise<unknown>;
  };
}

export async function writeOutboxEvent<TMap extends EventMapLike>(
  tx: DrizzleInsertable,
  outboxTable: OutboxTable,
  event: {[K in EventType<TMap>]: {type: K; payload: TMap[K]}}[EventType<TMap>],
): Promise<void> {
  await tx.insert(outboxTable).values({
    eventType: event.type,
    payload: event.payload,
  });
}
