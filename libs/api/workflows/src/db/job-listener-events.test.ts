import {WORKFLOWS_JOB_EVENT_DELIVERED} from '@shipfox/api-workflows-dto';
import {eq} from 'drizzle-orm';
import type {WorkflowRunTriggerReference} from '#core/entities/workflow-run.js';
import {db} from '#db/db.js';
import {jobListenerEvents} from '#db/schema/job-listener-events.js';
import {jobs} from '#db/schema/jobs.js';
import {workflowsOutbox} from '#db/schema/outbox.js';

const {deliverEventToListener} = await import('./job-listener-events.js');
const {jobFactory} = await import('#test/index.js');

interface DeliverOverrides {
  jobId?: string;
  disposition?: 'fire' | 'resolve';
  eventRef?: string;
  provider?: string;
  triggerReference?: WorkflowRunTriggerReference | null;
}

function deliver(overrides: DeliverOverrides = {}) {
  return deliverEventToListener({
    jobId: overrides.jobId ?? crypto.randomUUID(),
    disposition: overrides.disposition ?? 'fire',
    eventRef: overrides.eventRef ?? crypto.randomUUID(),
    deliveryId: crypto.randomUUID(),
    source: 'github',
    event: 'pull_request_review',
    provider: overrides.provider ?? 'github',
    triggerReference: overrides.triggerReference,
    payload: {action: 'submitted'},
    receivedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
}

function listEvents(jobId: string) {
  return db().select().from(jobListenerEvents).where(eq(jobListenerEvents.jobId, jobId));
}

describe('deliverEventToListener', () => {
  it('buffers a matching event once per job and event ref', async () => {
    const job = await jobFactory.create({}, {transient: {status: 'pending'}});
    const eventRef = crypto.randomUUID();

    const first = await deliver({jobId: job.id, eventRef});
    const second = await deliver({jobId: job.id, eventRef});

    const rows = await listEvents(job.id);
    expect(first).toEqual({buffered: true, skipped: false});
    expect(second).toEqual({buffered: false, skipped: false});
    expect(rows).toHaveLength(1);
  });

  it.each(['fire', 'resolve'] as const)('persists disposition %s', async (disposition) => {
    const job = await jobFactory.create({}, {transient: {status: 'pending'}});

    await deliver({jobId: job.id, disposition});

    const rows = await listEvents(job.id);
    expect(rows[0]?.disposition).toBe(disposition);
  });

  it('persists the normalized trigger reference with the listener event', async () => {
    const job = await jobFactory.create({}, {transient: {status: 'pending'}});
    const triggerReference: WorkflowRunTriggerReference = {
      project: {id: crypto.randomUUID()},
      repository: 'acme/api',
      ref: 'refs/heads/main',
      commit: 'a'.repeat(40),
      actor: 'octocat',
    };

    await deliver({jobId: job.id, triggerReference});

    const rows = await listEvents(job.id);
    expect(rows[0]?.triggerReference).toEqual(triggerReference);
  });

  it('skips terminal jobs without throwing or buffering', async () => {
    const job = await jobFactory.create({}, {transient: {status: 'succeeded'}});

    const result = await deliver({jobId: job.id});

    const rows = await listEvents(job.id);
    expect(result).toEqual({buffered: false, skipped: true});
    expect(rows).toHaveLength(0);
  });

  it('skips a missing job without throwing or buffering', async () => {
    const jobId = crypto.randomUUID();

    const result = await deliver({jobId});

    const rows = await db().select().from(jobListenerEvents);
    expect(result).toEqual({buffered: false, skipped: true});
    expect(rows.some((row) => row.jobId === jobId)).toBe(false);
  });

  it('allows buffering for a job that has not started yet', async () => {
    const job = await jobFactory.create({}, {transient: {status: 'pending'}});

    const result = await deliver({jobId: job.id});

    const [row] = await db().select().from(jobs).where(eq(jobs.id, job.id));
    expect(row?.status).toBe('pending');
    expect(result).toEqual({buffered: true, skipped: false});
  });

  it('writes a delivered outbox event when an event is buffered', async () => {
    const job = await jobFactory.create({}, {transient: {status: 'pending'}});
    const eventRef = crypto.randomUUID();

    const result = await deliver({jobId: job.id, eventRef, disposition: 'resolve'});

    const rows = await db()
      .select()
      .from(workflowsOutbox)
      .where(eq(workflowsOutbox.eventType, WORKFLOWS_JOB_EVENT_DELIVERED));
    const matching = rows.find(
      (row) =>
        (row.payload as Record<string, unknown>).jobId === job.id &&
        (row.payload as Record<string, unknown>).eventRef === eventRef,
    );
    expect(result).toEqual({buffered: true, skipped: false});
    expect(matching?.payload).toMatchObject({
      jobId: job.id,
      disposition: 'resolve',
      eventRef,
      eventName: 'pull_request_review',
    });
    expect(matching?.orderingKey).toBeNull();
  });
});
