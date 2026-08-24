import {reapStaleSessionClaims} from './reap-stale-session-claims.js';

const listStaleClaimedSessionsMock = vi.hoisted(() => vi.fn());
const releaseSessionClaimsHeldByStepAttemptsMock = vi.hoisted(() => vi.fn());
const loggerErrorMock = vi.hoisted(() => vi.fn());
const reportErrorMock = vi.hoisted(() => vi.fn());

vi.mock('#db/index.js', () => ({
  listStaleClaimedSessions: listStaleClaimedSessionsMock,
  releaseSessionClaimsHeldByStepAttempts: releaseSessionClaimsHeldByStepAttemptsMock,
}));

vi.mock('@shipfox/node-error-monitoring', () => ({reportError: reportErrorMock}));

vi.mock('@shipfox/node-opentelemetry', () => ({
  logger: () => ({error: loggerErrorMock}),
  instanceMetrics: {getMeter: () => ({createCounter: () => ({add: vi.fn()})})},
}));

function staleRow(stepAttemptId: string | null) {
  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    key: 'main',
    harness: 'pi' as const,
    harnessSessionId: null,
    headSegment: 0,
    headObjectKey: null,
    headSizeBytes: null,
    headCommittedByAttempt: null,
    headRepoRef: null,
    claimedByStepAttempt: stepAttemptId,
    claimedAt: new Date(),
    carriedFromSessionId: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('reapStaleSessionClaims failure path', () => {
  beforeEach(() => {
    listStaleClaimedSessionsMock.mockReset();
    releaseSessionClaimsHeldByStepAttemptsMock.mockReset();
    loggerErrorMock.mockReset();
    reportErrorMock.mockReset();
    releaseSessionClaimsHeldByStepAttemptsMock.mockResolvedValue(1);
  });

  it('logs and skips a failing attempt, still reaping the rest of the batch', async () => {
    const healthy = crypto.randomUUID();
    const poison = crypto.randomUUID();
    listStaleClaimedSessionsMock.mockResolvedValue([staleRow(healthy), staleRow(poison)]);
    releaseSessionClaimsHeldByStepAttemptsMock.mockImplementation((ids: string[]) =>
      ids[0] === poison ? Promise.reject(new Error('induced release failure')) : Promise.resolve(2),
    );

    const result = await reapStaleSessionClaims({olderThanSeconds: 3600, batchLimit: 10});

    expect(result).toEqual({reaped: 2, failed: 1});
    expect(releaseSessionClaimsHeldByStepAttemptsMock).toHaveBeenCalledTimes(2);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({stepAttemptId: poison}),
      'Failed to reap stale agent session claim',
    );
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({boundary: 'agent.maintenance'}),
    );
  });

  it('skips a listed row whose claim is null without bumping reaped or failed', async () => {
    listStaleClaimedSessionsMock.mockResolvedValue([staleRow(null)]);

    const result = await reapStaleSessionClaims({olderThanSeconds: 3600, batchLimit: 10});

    expect(result).toEqual({reaped: 0, failed: 0});
    expect(releaseSessionClaimsHeldByStepAttemptsMock).not.toHaveBeenCalled();
  });

  it('dedupes rows that share one claiming attempt into a single release statement', async () => {
    const attempt = crypto.randomUUID();
    listStaleClaimedSessionsMock.mockResolvedValue([staleRow(attempt), staleRow(attempt)]);
    releaseSessionClaimsHeldByStepAttemptsMock.mockResolvedValue(2);

    const result = await reapStaleSessionClaims({olderThanSeconds: 3600, batchLimit: 10});

    expect(releaseSessionClaimsHeldByStepAttemptsMock).toHaveBeenCalledTimes(1);
    expect(releaseSessionClaimsHeldByStepAttemptsMock).toHaveBeenCalledWith([attempt], {
      olderThanSeconds: 3600,
    });
    expect(result).toEqual({reaped: 2, failed: 0});
  });
});
