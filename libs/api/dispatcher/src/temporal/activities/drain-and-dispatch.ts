import {drainAll, getSubscribers, markDispatched} from '@shipfox/node-module';
import {logger} from '@shipfox/node-opentelemetry';

export async function drainAndDispatch(): Promise<void> {
  const rows = await drainAll();
  if (rows.length === 0) return;

  const dispatched = new Map<string, string[]>();

  for (const row of rows) {
    const handlers = getSubscribers(row.event.type);
    let allSucceeded = true;

    for (const handler of handlers) {
      try {
        await handler(row.event);
      } catch (error) {
        logger().error(
          {err: error, eventType: row.event.type, eventId: row.id},
          'Handler failed for outbox event',
        );
        allSucceeded = false;
      }
    }

    if (allSucceeded) {
      const ids = dispatched.get(row.source) ?? [];
      ids.push(row.id);
      dispatched.set(row.source, ids);
    }
  }

  for (const [source, ids] of dispatched) {
    await markDispatched(source, ids);
  }
}
