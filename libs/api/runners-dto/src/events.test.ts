import {
  RUNNER_JOB_CLAIMED,
  RUNNER_JOB_LEASE_EXPIRED,
  type RunnersEventMap,
  runnerJobClaimedEventSchema,
  runnerJobLeaseExpiredEventSchema,
  runnersEventSchemas,
} from './events.js';

describe('runners events', () => {
  it('validates the enriched claimed event fields', () => {
    const payload = {
      workflowRunId: crypto.randomUUID(),
      workflowRunAttemptId: crypto.randomUUID(),
      jobId: crypto.randomUUID(),
      jobExecutionId: crypto.randomUUID(),
      claimedAt: '2026-09-02T10:00:00.000Z',
      workspaceId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      runnerLabels: ['linux', 'x64'],
      templateKey: 'standard',
      provisionerId: crypto.randomUUID(),
      provisionerScope: 'installation' as const,
      providerKind: 'ec2',
      launchKind: 'demand' as const,
    };

    expect(runnerJobClaimedEventSchema.parse(payload)).toEqual(payload);
  });

  it('keeps enriched claimed fields optional for existing subscribers', () => {
    const payload = {
      workflowRunId: crypto.randomUUID(),
      workflowRunAttemptId: crypto.randomUUID(),
      jobId: crypto.randomUUID(),
      jobExecutionId: crypto.randomUUID(),
      claimedAt: '2026-09-02T10:00:00.000Z',
    };

    expect(runnerJobClaimedEventSchema.parse(payload)).toEqual(payload);
  });

  it('validates the lease expiry timestamp', () => {
    const payload = {
      workflowRunId: crypto.randomUUID(),
      workflowRunAttemptId: crypto.randomUUID(),
      jobId: crypto.randomUUID(),
      jobExecutionId: crypto.randomUUID(),
      expiredAt: '2026-09-02T10:01:00.000Z',
    };

    expect(runnerJobLeaseExpiredEventSchema.parse(payload)).toEqual(payload);
  });

  it('covers every event map key with a schema', () => {
    expect(Object.keys(runnersEventSchemas)).toEqual([
      RUNNER_JOB_LEASE_EXPIRED,
      RUNNER_JOB_CLAIMED,
    ] satisfies Array<keyof RunnersEventMap>);
  });
});
