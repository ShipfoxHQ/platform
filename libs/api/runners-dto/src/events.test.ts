import {
  RUNNER_JOB_CLAIMED,
  RUNNER_JOB_LEASE_EXPIRED,
  type RunnersEventMap,
  runnerJobClaimedEventSchema,
  runnerJobLeaseExpiredEventSchema,
  runnersEventSchemas,
} from './events.js';

const sharedLeasePayload = (overrides: Record<string, unknown> = {}) => ({
  workflowRunId: crypto.randomUUID(),
  workflowRunAttemptId: crypto.randomUUID(),
  jobId: crypto.randomUUID(),
  jobExecutionId: crypto.randomUUID(),
  ...overrides,
});

const validClaimedPayload = () => ({
  workflowRunId: crypto.randomUUID(),
  workflowRunAttemptId: crypto.randomUUID(),
  jobId: crypto.randomUUID(),
  jobExecutionId: crypto.randomUUID(),
  claimedAt: '2026-09-02T10:00:00.000Z',
  runnerLabels: ['linux'],
  provisionerScope: 'installation' as const,
  launchKind: 'manual' as const,
});

describe('runners events', () => {
  it('validates the enriched claimed event fields', () => {
    const payload = {
      ...validClaimedPayload(),
      claimedAt: '2026-09-02T10:00:00.000Z',
      runnerLabels: ['linux', 'x64'],
      workspaceId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      templateKey: 'standard',
      provisionerId: crypto.randomUUID(),
      providerRunnerId: 'runner-1',
      provisionerScope: 'installation' as const,
      providerKind: 'ec2',
      launchKind: 'demand' as const,
    };

    expect(runnerJobClaimedEventSchema.strict().parse(payload)).toEqual(payload);

    expect(
      runnerJobClaimedEventSchema.parse({...payload, provisionerScope: 'workspace'})
        .provisionerScope,
    ).toBe('workspace');
  });

  it('rejects invalid event field values', () => {
    const claimedPayload = validClaimedPayload();

    expect(() =>
      runnerJobClaimedEventSchema.parse({...claimedPayload, claimedAt: 'invalid'}),
    ).toThrow();
    expect(() =>
      runnerJobClaimedEventSchema.parse({...claimedPayload, runnerLabels: []}),
    ).toThrow();
    expect(() =>
      runnerJobClaimedEventSchema.parse({...claimedPayload, provisionerScope: 'region'}),
    ).toThrow();
    expect(() =>
      runnerJobClaimedEventSchema.parse({...claimedPayload, launchKind: 'scheduled'}),
    ).toThrow();
    expect(() =>
      runnerJobLeaseExpiredEventSchema.parse({...sharedLeasePayload(), expiredAt: 'invalid'}),
    ).toThrow();
    expect(() =>
      runnerJobLeaseExpiredEventSchema.parse({...sharedLeasePayload(), expiredAt: 123}),
    ).toThrow();
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
    const payload = sharedLeasePayload({expiredAt: '2026-09-02T10:01:00.000Z'});

    expect(runnerJobLeaseExpiredEventSchema.strict().parse(payload)).toEqual(payload);
  });

  it('covers every event map key with a schema', () => {
    expect(Object.keys(runnersEventSchemas)).toEqual([
      RUNNER_JOB_LEASE_EXPIRED,
      RUNNER_JOB_CLAIMED,
    ] satisfies Array<keyof RunnersEventMap>);
  });
});
