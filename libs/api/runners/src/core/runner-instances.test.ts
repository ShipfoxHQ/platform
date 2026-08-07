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

  it('terminates active provisioned runners with a cancelled latest bound job', () => {
    const result = reconcileRunnerInstancesFromDbResult({
      observedRunnerInstanceIds: ['provisioned-runner-1'],
      observedRows: [providerRunner({providerRunnerId: 'provisioned-runner-1'})],
      boundJobExecutionsByRunnerInstanceId: new Map([
        [
          'provisioned-runner-1',
          boundJobExecution({
            providerRunnerId: 'provisioned-runner-1',
            cancellationRequestedAt: new Date('2025-01-01T00:01:00.000Z'),
          }),
        ],
      ]),
    });

    expect(result[0]?.desiredIntent).toBe('terminate');
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
    stoppingAt: null,
    stoppedAt: null,
    failedAt: null,
    terminatedAt: null,
    reservationReleasedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function boundJobExecution(params: {
  providerRunnerId: string;
  cancellationRequestedAt?: Date | null;
}) {
  return {
    workflowRunId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    jobId: crypto.randomUUID(),
    jobExecutionId: crypto.randomUUID(),
    providerRunnerId: params.providerRunnerId,
    startedAt: new Date('2025-01-01T00:00:00.000Z'),
    lastHeartbeatAt: new Date('2025-01-01T00:00:00.000Z'),
    cancellationRequestedAt: params.cancellationRequestedAt ?? null,
  };
}
