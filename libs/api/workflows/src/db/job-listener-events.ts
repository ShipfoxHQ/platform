import {WORKFLOWS_JOB_EVENT_DELIVERED} from '@shipfox/api-workflows-dto';
import {eq} from 'drizzle-orm';
import {isJobTerminal} from '#core/entities/job.js';
import type {JobListenerEventDisposition} from '#core/entities/job-listener-event.js';
import type {WorkflowRunTriggerReference} from '#core/entities/workflow-run.js';
import {recordListenerEventReceived} from '#metrics/instance.js';
import {db} from './db.js';
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
        payload: params.payload,
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
