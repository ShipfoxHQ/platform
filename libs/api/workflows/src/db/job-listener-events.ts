import {WORKFLOWS_JOB_EVENT_DELIVERED} from '@shipfox/api-workflows-dto';
import {and, eq, isNull} from 'drizzle-orm';
import {diagnosticValueByteLength} from '#core/diagnostics.js';
import {isJobTerminal} from '#core/entities/job.js';
import {
  normalizeWorkflowExecutionEvent,
  type WorkflowExecutionEvent,
} from '#core/entities/job-execution.js';
import type {
  JobListenerEventDisposition,
  JobListenerEventOutcomeReason,
} from '#core/entities/job-listener-event.js';
import type {WorkflowRunTriggerReference} from '#core/entities/workflow-run.js';
import {serializedListenerEventsByteLength} from '#core/listener-event-batching.js';
import {recordListenerEventReceived} from '#metrics/instance.js';
import {db, type Tx} from './db.js';
import {writeWorkflowsOutboxEvent} from './outbox-writes.js';
import {jobListenerEvents} from './schema/job-listener-events.js';
import {jobs} from './schema/jobs.js';

export interface DeliverEventToListenerParams {
  jobId: string;
  disposition: JobListenerEventDisposition;
  eventRef: string;
  deliveryId: string;
  source: string;
  event: string;
  provider: string;
  triggerReference?: WorkflowRunTriggerReference | null | undefined;
  payload: unknown;
  receivedAt: Date;
}

export interface DeliverEventToListenerResult {
  buffered: boolean;
  skipped: boolean;
}

export interface FinalizedListenerEventCounts {
  honored: number;
  abandoned: number;
}

type ListenerEventMetadata = Pick<
  DeliverEventToListenerParams,
  'source' | 'event' | 'deliveryId' | 'triggerReference' | 'payload' | 'receivedAt'
>;

export function normalizeListenerEvent(event: ListenerEventMetadata): WorkflowExecutionEvent {
  return normalizeWorkflowExecutionEvent({
    source: event.source,
    event: event.event,
    delivery_id: event.deliveryId,
    received_at: event.receivedAt.toISOString(),
    project: event.triggerReference?.project ?? null,
    repository: event.triggerReference?.repository ?? null,
    ref: event.triggerReference?.ref ?? null,
    commit: event.triggerReference?.commit ?? null,
    data: event.payload,
  });
}

export async function finalizePendingListenerEvents(
  tx: Tx,
  params: {jobId: string; reason: Exclude<JobListenerEventOutcomeReason, 'payload_too_large'>},
): Promise<FinalizedListenerEventCounts> {
  const honored =
    params.reason === 'until'
      ? await tx
          .update(jobListenerEvents)
          .set({outcome: 'honored', outcomeReason: null})
          .where(
            and(
              eq(jobListenerEvents.jobId, params.jobId),
              eq(jobListenerEvents.outcome, 'pending'),
              eq(jobListenerEvents.disposition, 'resolve'),
              isNull(jobListenerEvents.consumedByExecutionId),
            ),
          )
          .returning({id: jobListenerEvents.id})
      : [];

  const abandoned = await tx
    .update(jobListenerEvents)
    .set({outcome: 'abandoned', outcomeReason: params.reason})
    .where(
      and(
        eq(jobListenerEvents.jobId, params.jobId),
        eq(jobListenerEvents.outcome, 'pending'),
        isNull(jobListenerEvents.consumedByExecutionId),
      ),
    )
    .returning({id: jobListenerEvents.id});

  return {honored: honored.length, abandoned: abandoned.length};
}

export async function deliverEventToListener(
  params: DeliverEventToListenerParams,
): Promise<DeliverEventToListenerResult> {
  const result = await db().transaction(async (tx) => {
    const [job] = await tx
      .select({id: jobs.id, status: jobs.status})
      .from(jobs)
      .where(eq(jobs.id, params.jobId))
      .for('update')
      .limit(1);

    if (!job || isJobTerminal(job.status)) return {buffered: false, skipped: true};

    const rows = await tx
      .insert(jobListenerEvents)
      .values({
        jobId: params.jobId,
        disposition: params.disposition,
        eventRef: params.eventRef,
        deliveryId: params.deliveryId,
        source: params.source,
        event: params.event,
        triggerReference: params.triggerReference ?? null,
        outcome: 'pending',
        outcomeReason: null,
        payload: params.payload,
        storedPayloadBytes: diagnosticValueByteLength(params.payload),
        normalizedEventBytes: serializedListenerEventsByteLength([normalizeListenerEvent(params)]),
        receivedAt: params.receivedAt,
      })
      .onConflictDoNothing({target: [jobListenerEvents.jobId, jobListenerEvents.eventRef]})
      .returning({id: jobListenerEvents.id});

    if (!rows[0]) return {buffered: false, skipped: false};
    await writeWorkflowsOutboxEvent(tx, {
      type: WORKFLOWS_JOB_EVENT_DELIVERED,
      payload: {
        jobId: params.jobId,
        disposition: params.disposition,
        eventRef: params.eventRef,
        eventName: params.event,
      },
    });
    return {buffered: true, skipped: false};
  });

  if (!result.buffered) return result;

  recordListenerEventReceived(params.provider);
  return result;
}
