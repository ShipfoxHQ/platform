import {and, asc, inArray} from 'drizzle-orm';
import type {WorkflowExecutionEvent} from '#core/entities/job-execution.js';
import type {db, Tx} from './db.js';
import {normalizeListenerEvent} from './job-listener-events.js';
import type {JobExecutionDb} from './schema/job-executions.js';
import {jobListenerEvents} from './schema/job-listener-events.js';

/**
 * Hydrates execution rows from the canonical listener-event table.
 *
 * The legacy trigger-events array remains the fallback for executions retained
 * from before canonical event reads were deployed.
 */
export async function loadJobExecutionsWithCanonicalTriggerEvents(
  source: ReturnType<typeof db> | Tx,
  executions: readonly JobExecutionDb[],
): Promise<ReadonlyMap<string, JobExecutionDb>> {
  if (executions.length === 0) return new Map();

  const eventRows = await source
    .select()
    .from(jobListenerEvents)
    .where(
      and(
        inArray(
          jobListenerEvents.consumedByExecutionId,
          executions.map((execution) => execution.id),
        ),
        inArray(jobListenerEvents.jobId, [
          ...new Set(executions.map((execution) => execution.jobId)),
        ]),
      ),
    )
    .orderBy(asc(jobListenerEvents.receivedAt), asc(jobListenerEvents.id));
  const eventsByExecutionId = new Map<string, WorkflowExecutionEvent[]>();
  for (const eventRow of eventRows) {
    if (eventRow.consumedByExecutionId === null) continue;
    const events = eventsByExecutionId.get(eventRow.consumedByExecutionId) ?? [];
    events.push(normalizeListenerEvent(eventRow));
    eventsByExecutionId.set(eventRow.consumedByExecutionId, events);
  }

  return new Map(
    executions.map((execution) => {
      const canonicalEvents = eventsByExecutionId.get(execution.id);
      return [
        execution.id,
        canonicalEvents === undefined ? execution : {...execution, triggerEvents: canonicalEvents},
      ] as const;
    }),
  );
}
