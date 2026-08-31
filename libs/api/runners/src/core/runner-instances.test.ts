import {reconcileRunnerInstancesFromDbResult} from './runner-instances.js';

describe('reconcileRunnerInstancesFromDbResult', () => {
  it('keeps active provisioned runners', () => {
    const result = reconcileRunnerInstancesFromDbResult({
      observedRunnerInstanceIds: ['provisioned-runner-1'],
      observedRows: [providerRunner({providerRunnerId: 'provisioned-runner-1'})],
      boundJobExecutionsByRunnerInstanceId: new Map(),
    });

    expect(result[0]?.desiredIntent).toBe('keep');
  });

  it('terminates terminal provisioned runners', () => {
    const result = reconcileRunnerInstancesFromDbResult({
      observedRunnerInstanceIds: ['provisioned-runner-1'],
      observedRows: [
        providerRunner({providerRunnerId: 'provisioned-runner-1', state: 'terminated'}),
      ],
      boundJobExecutionsByRunnerInstanceId: new Map(),
    });

    expect(result[0]?.desiredIntent).toBe('terminate');
  });

  it('keeps orphan observed provisioned runners', () => {
    const result = reconcileRunnerInstancesFromDbResult({
      observedRunnerInstanceIds: ['provisioned-runner-1'],
      observedRows: [],
      boundJobExecutionsByRunnerInstanceId: new Map(),
    });

    expect(result[0]).toMatchObject({
      providerRunnerId: 'provisioned-runner-1',
      state: null,
      desiredIntent: 'keep',
    });
  });

  it('keeps active provisioned runners while a bound job is cleaning up', () => {
    const result = reconcileRunnerInstancesFromDbResult({
      observedRunnerInstanceIds: ['provisioned-runner-1'],
      observedRows: [providerRunner({providerRunnerId: 'provisioned-runner-1'})],
      boundJobExecutionsByRunnerInstanceId: new Map([
        [
          'provisioned-runner-1',
          boundJobExecution({
            providerRunnerId: 'provisioned-runner-1',
            cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
            cancellationReason: 'run_cancelled',
          }),
        ],
      ]),
      now: new Date('2025-01-01T00:02:00.000Z'),
      cleanupGraceSeconds: 120,
    });

    expect(result[0]?.desiredIntent).toBe('keep');
  });

  it('renews cleanup grace after a post-cancellation heartbeat', () => {
    const result = reconcileRunnerInstancesFromDbResult({
      observedRunnerInstanceIds: ['provisioned-runner-1'],
      observedRows: [providerRunner({providerRunnerId: 'provisioned-runner-1'})],
      boundJobExecutionsByRunnerInstanceId: new Map([
        [
          'provisioned-runner-1',
          boundJobExecution({
            providerRunnerId: 'provisioned-runner-1',
            lastHeartbeatAt: new Date('2025-01-01T00:02:00.000Z'),
            cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
            cancellationReason: 'run_cancelled',
          }),
        ],
      ]),
      now: new Date('2025-01-01T00:03:00.000Z'),
      cleanupGraceSeconds: 120,
    });

    expect(result[0]?.desiredIntent).toBe('keep');
  });

  it('terminates terminal provisioned runners with a cancelled job before cleanup grace expires', () => {
    const result = reconcileRunnerInstancesFromDbResult({
      observedRunnerInstanceIds: ['provisioned-runner-1'],
      observedRows: [providerRunner({providerRunnerId: 'provisioned-runner-1', state: 'stopped'})],
      boundJobExecutionsByRunnerInstanceId: new Map([
        [
          'provisioned-runner-1',
          boundJobExecution({
            providerRunnerId: 'provisioned-runner-1',
            cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
            cancellationReason: 'run_cancelled',
          }),
        ],
      ]),
      now: new Date('2025-01-01T00:01:01.000Z'),
      cleanupGraceSeconds: 120,
    });

    expect(result[0]).toMatchObject({
      desiredIntent: 'terminate',
      desiredIntentReason: 'job-cancelled',
    });
  });

  it('keeps a cancelled job with no persisted stop reason', () => {
    const result = reconcileRunnerInstancesFromDbResult({
      observedRunnerInstanceIds: ['provisioned-runner-1'],
      observedRows: [providerRunner({providerRunnerId: 'provisioned-runner-1'})],
      boundJobExecutionsByRunnerInstanceId: new Map([
        [
          'provisioned-runner-1',
          boundJobExecution({
            providerRunnerId: 'provisioned-runner-1',
            cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
            cancellationReason: null,
          }),
        ],
      ]),
      now: new Date('2025-01-01T00:04:00.000Z'),
      cleanupGraceSeconds: 120,
    });

    expect(result[0]).toMatchObject({
      desiredIntent: 'keep',
      desiredIntentReason: null,
    });
  });

  it('terminates active provisioned runners when cleanup grace expires', () => {
    const result = reconcileRunnerInstancesFromDbResult({
      observedRunnerInstanceIds: ['provisioned-runner-1'],
      observedRows: [providerRunner({providerRunnerId: 'provisioned-runner-1'})],
      boundJobExecutionsByRunnerInstanceId: new Map([
        [
          'provisioned-runner-1',
          boundJobExecution({
            providerRunnerId: 'provisioned-runner-1',
            cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
            cancellationReason: 'timed_out',
          }),
        ],
      ]),
      now: new Date('2025-01-01T00:03:00.000Z'),
      cleanupGraceSeconds: 120,
    });

    expect(result[0]).toMatchObject({
      desiredIntent: 'terminate',
      desiredIntentReason: 'job-timeout',
    });
  });

  it('returns the first observed stopping timestamp for an authorized runner', () => {
    const stoppingAt = new Date('2026-01-01T00:00:00.000Z');
    const result = reconcileRunnerInstancesFromDbResult({
      observedRunnerInstanceIds: ['provisioned-runner-1'],
      observedRows: [providerRunner({providerRunnerId: 'provisioned-runner-1', stoppingAt})],
      boundJobExecutionsByRunnerInstanceId: new Map(),
    });

    expect(result[0]?.stoppingAt).toEqual(stoppingAt);
  });

  it('returns the intended reservation when a runner is not assigned yet', () => {
    const intendedReservationId = crypto.randomUUID();
    const result = reconcileRunnerInstancesFromDbResult({
      observedRunnerInstanceIds: ['provisioned-runner-1'],
      observedRows: [
        providerRunner({providerRunnerId: 'provisioned-runner-1', intendedReservationId}),
      ],
      boundJobExecutionsByRunnerInstanceId: new Map(),
    });

    expect(result[0]).toMatchObject({
      reservationId: null,
      intendedReservationId,
    });
  });
});

function providerRunner(params: {
  providerRunnerId: string;
  state?: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed' | 'terminated';
  intendedReservationId?: string | null;
  stoppingAt?: Date | null;
}) {
  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    provisionerId: crypto.randomUUID(),
    providerRunnerId: params.providerRunnerId,
    intendedReservationId: params.intendedReservationId ?? null,
    reservationId: null,
    launchKind: 'manual' as const,
    templateKey: 'linux',
    labels: ['linux'],
    state: params.state ?? 'running',
    reason: null,
    runnerSessionId: null,
    providerKind: 'docker',
    reportedAt: new Date(),
    startedAt: null,
    stoppingAt: params.stoppingAt ?? null,
    stoppedAt: null,
    failedAt: null,
    terminatedAt: null,
    terminationAuthorizedAt: null,
    terminationReason: null,
    reservationReleasedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function boundJobExecution(params: {
  providerRunnerId: string;
  lastHeartbeatAt?: Date;
  cancellationRequestedAt?: Date | null;
  cancellationReason?: 'run_cancelled' | 'timed_out' | null;
}) {
  return {
    workflowRunId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    jobId: crypto.randomUUID(),
    jobExecutionId: crypto.randomUUID(),
    providerRunnerId: params.providerRunnerId,
    startedAt: new Date('2025-01-01T00:00:00.000Z'),
    lastHeartbeatAt: params.lastHeartbeatAt ?? new Date('2025-01-01T00:00:00.000Z'),
    cancellationRequestedAt: params.cancellationRequestedAt ?? null,
    cancellationReason: params.cancellationReason ?? null,
  };
}
