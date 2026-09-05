import {count, sql} from 'drizzle-orm';
import {db} from './db.js';
import {jobExecutions} from './schema/job-executions.js';
import {jobListenerEvents} from './schema/job-listener-events.js';

export interface ListenerEventStorageStats {
  listenerEventRows: number;
  listenerEventPayloadBytes: number;
  consumedListenerEventOldestAgeMilliseconds: number;
  pendingListenerEventOldestAgeMilliseconds: number;
  duplicateTriggerEventsBytes: number;
}

export async function getListenerEventStorageStats(): Promise<ListenerEventStorageStats> {
  const [eventStats, executionStats] = await Promise.all([
    db()
      .select({
        listenerEventRows: count(),
        listenerEventPayloadBytes: sql<number>`coalesce(sum(
          ${jobListenerEvents.storedPayloadBytes}
        ) filter (where ${jobListenerEvents.payload} is not null), 0)`,
        consumedListenerEventOldestAgeMilliseconds: listenerEventOldestAge(
          sql`${jobListenerEvents.consumedByExecutionId} is not null`,
        ),
        pendingListenerEventOldestAgeMilliseconds: listenerEventOldestAge(
          sql`${jobListenerEvents.consumedByExecutionId} is null and ${jobListenerEvents.outcome} = 'pending'`,
        ),
      })
      .from(jobListenerEvents)
      .then(([row]) => row),
    db()
      .select({
        duplicateTriggerEventsBytes: sql<number>`coalesce(sum(
          case
            when jsonb_typeof(${jobExecutions.triggerEvents}) = 'array'
            then octet_length(${jobExecutions.triggerEvents}::text)
            else 0
          end
        ), 0)`,
      })
      .from(jobExecutions)
      .then(([row]) => row),
  ]);

  return {
    listenerEventRows: Number(eventStats?.listenerEventRows ?? 0),
    listenerEventPayloadBytes: Number(eventStats?.listenerEventPayloadBytes ?? 0),
    consumedListenerEventOldestAgeMilliseconds: Number(
      eventStats?.consumedListenerEventOldestAgeMilliseconds ?? 0,
    ),
    pendingListenerEventOldestAgeMilliseconds: Number(
      eventStats?.pendingListenerEventOldestAgeMilliseconds ?? 0,
    ),
    duplicateTriggerEventsBytes: Number(executionStats?.duplicateTriggerEventsBytes ?? 0),
  };
}

function listenerEventOldestAge(condition: ReturnType<typeof sql>) {
  return sql<number>`coalesce(
    extract(epoch from (
      statement_timestamp() - min(${jobListenerEvents.receivedAt}) filter (where ${condition})
    )) * 1000,
    0
  )`;
}
