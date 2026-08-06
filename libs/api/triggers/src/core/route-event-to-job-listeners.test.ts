import {workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {jobListenerSubscriptionFactory} from '#test/index.js';
import type {TriggerHistoryRecorder} from './record-trigger-history.js';

const deliverEventToListener = vi.fn();
const resolveWorkflowRunTriggerReference = vi.fn();
const findMatchingJobListenerSubscriptions = vi.fn();
const listenerTriggered = vi.fn();
const listenerFilterErrored = vi.fn();
const listenerDispatchErrored = vi.fn();
const loggerWarn = vi.fn();

vi.mock('@shipfox/node-opentelemetry', () => ({
  logger: () => ({warn: loggerWarn}),
}));

vi.mock('#db/job-listener-subscriptions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#db/job-listener-subscriptions.js')>();
  return {
    ...actual,
    findMatchingJobListenerSubscriptions: (
      ...args: Parameters<typeof actual.findMatchingJobListenerSubscriptions>
    ) => {
      if (findMatchingJobListenerSubscriptions.getMockImplementation()) {
        return findMatchingJobListenerSubscriptions(...args);
      }
      return actual.findMatchingJobListenerSubscriptions(...args);
    },
  };
});

const {routeEventToJobListeners} = await import('./route-event-to-job-listeners.js');

const workflows = {
  deliverEventToJobListener: (...args: unknown[]) => deliverEventToListener(...args),
  resolveWorkflowRunTriggerReference: (...args: unknown[]) =>
    resolveWorkflowRunTriggerReference(...args),
} as never;

interface RouteOverrides {
  eventRef?: string;
  workspaceId?: string;
  connectionId?: string;
  source?: string;
  event?: string;
  payload?: unknown;
}

function route(overrides: RouteOverrides = {}) {
  return routeEventToJobListeners({
    workflows,
    history: buildHistory(),
    eventRef: overrides.eventRef ?? crypto.randomUUID(),
    workspaceId: overrides.workspaceId ?? crypto.randomUUID(),
    connectionId: overrides.connectionId ?? crypto.randomUUID(),
    provider: 'github',
    source: overrides.source ?? 'github',
    event: overrides.event ?? 'pull_request_review',
    deliveryId: crypto.randomUUID(),
    payload: overrides.payload ?? {action: 'submitted'},
    receivedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
}

function buildHistory(): TriggerHistoryRecorder {
  return {
    triggered: vi.fn(),
    filterErrored: vi.fn(),
    dispatchErrored: vi.fn(),
    listenerTriggered,
    listenerFilterErrored,
    listenerDispatchErrored,
    discarded: vi.fn(),
    routed: vi.fn(),
    failed: vi.fn(),
    allErrored: vi.fn(),
  };
}

describe('routeEventToJobListeners', () => {
  beforeEach(() => {
    deliverEventToListener.mockReset();
    resolveWorkflowRunTriggerReference.mockReset();
    findMatchingJobListenerSubscriptions.mockReset();
    listenerTriggered.mockReset();
    listenerFilterErrored.mockReset();
    listenerDispatchErrored.mockReset();
    loggerWarn.mockReset();
    deliverEventToListener.mockResolvedValue({buffered: true, skipped: false});
    resolveWorkflowRunTriggerReference.mockResolvedValue(null);
  });

  it('computes resolve as the effective disposition when on and until match one job', async () => {
    const workspaceId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      jobId,
      kind: 'on',
      matcherOrdinal: 0,
      source: 'github',
      event: 'pull_request_review',
    });
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      jobId,
      kind: 'until',
      matcherOrdinal: 0,
      source: 'github',
      event: 'pull_request_review',
    });

    const result = await route({workspaceId});

    expect(deliverEventToListener).toHaveBeenCalledTimes(1);
    expect(deliverEventToListener).toHaveBeenCalledWith(
      expect.objectContaining({jobId, disposition: 'resolve'}),
    );
    expect(listenerTriggered).toHaveBeenCalledTimes(1);
    expect(listenerTriggered).toHaveBeenCalledWith(expect.objectContaining({kind: 'until'}));
    expect(result).toMatchObject({
      engagedCount: 1,
      matchedJobCount: 1,
      acceptedJobCount: 1,
      deliveredCount: 1,
      transientErrored: false,
    });
  });

  it('passes the source connection to listener delivery', async () => {
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      jobId,
      kind: 'on',
      matcherOrdinal: 0,
      source: 'github',
      event: 'pull_request_review',
    });

    await route({workspaceId, connectionId});

    expect(deliverEventToListener).toHaveBeenCalledWith(
      expect.objectContaining({jobId, triggerConnectionId: connectionId}),
    );
  });

  it('resolves one trigger reference for all fire deliveries', async () => {
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    const triggerReference = {
      project: {id: crypto.randomUUID()},
      repository: 'acme/api',
      ref: 'refs/heads/main',
      commit: 'a'.repeat(40),
    };
    for (const jobId of [crypto.randomUUID(), crypto.randomUUID()]) {
      await jobListenerSubscriptionFactory.create({
        workspaceId,
        jobId,
        kind: 'on',
        matcherOrdinal: 0,
        source: 'github',
        event: 'pull_request_review',
      });
    }
    resolveWorkflowRunTriggerReference.mockResolvedValue(triggerReference);

    await route({workspaceId, connectionId});

    expect(resolveWorkflowRunTriggerReference).toHaveBeenCalledTimes(1);
    expect(resolveWorkflowRunTriggerReference).toHaveBeenCalledWith({
      workspaceId,
      triggerConnectionId: connectionId,
      triggerPayload: {
        provider: 'github',
        source: 'github',
        event: 'pull_request_review',
        deliveryId: expect.any(String),
        data: {action: 'submitted'},
      },
    });
    expect(deliverEventToListener).toHaveBeenCalledTimes(2);
    expect(deliverEventToListener).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({triggerReference}),
    );
    expect(deliverEventToListener).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({triggerReference}),
    );
  });

  it('does not deliver when no listener subscription matches', async () => {
    const workspaceId = crypto.randomUUID();
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
    });

    const result = await route({workspaceId, event: 'pull_request'});

    expect(deliverEventToListener).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      engagedCount: 0,
      matchedJobCount: 0,
      acceptedJobCount: 0,
      deliveredCount: 0,
      transientErrored: false,
    });
  });

  it('does not count skipped stale subscriptions as accepted deliveries', async () => {
    const workspaceId = crypto.randomUUID();
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'pull_request_review',
    });
    deliverEventToListener.mockResolvedValueOnce({buffered: false, skipped: true});

    const result = await route({workspaceId});

    expect(result).toMatchObject({
      engagedCount: 0,
      matchedJobCount: 1,
      acceptedJobCount: 0,
      deliveredCount: 0,
      transientErrored: false,
    });
  });

  it('surfaces transient delivery errors after attempting every matched job', async () => {
    const workspaceId = crypto.randomUUID();
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      jobId: crypto.randomUUID(),
      source: 'github',
      event: 'pull_request_review',
    });
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      jobId: crypto.randomUUID(),
      source: 'github',
      event: 'pull_request_review',
    });
    const error = new Error('workflow db down');
    deliverEventToListener.mockRejectedValueOnce(error);

    const result = await route({workspaceId});

    expect(deliverEventToListener).toHaveBeenCalledTimes(2);
    expect(listenerDispatchErrored).toHaveBeenCalledTimes(1);
    expect(listenerDispatchErrored).toHaveBeenCalledWith(
      expect.objectContaining({source: 'github', event: 'pull_request_review'}),
      'workflow db down',
    );
    expect(listenerTriggered).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      engagedCount: 2,
      matchedJobCount: 2,
      acceptedJobCount: 1,
      deliveredCount: 1,
      transientErrored: true,
      transientError: error,
    });
  });

  it.each([
    'workspace-not-found',
    'workspace-suspended',
    'workspace-deleted',
  ] as const)('does not retry a %s workspace listener delivery', async (code) => {
    const workspaceId = crypto.randomUUID();
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'pull_request_review',
    });
    const error = createInterModuleKnownError(
      workflowsInterModuleContract.methods.deliverEventToJobListener,
      code,
      {workspaceId},
    );
    deliverEventToListener.mockRejectedValueOnce(error);

    const result = await route({workspaceId});

    expect(listenerDispatchErrored).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      engagedCount: 1,
      acceptedJobCount: 0,
      transientErrored: false,
    });
  });

  it('delivers only when a listener filter matches the payload and snapshot', async () => {
    const workspaceId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      jobId,
      source: 'github',
      event: 'pull_request_review',
      config: {
        filter: 'event.issue.number == jobs.build.outputs.pr_number',
        filter_snapshot: {jobs: {build: {outputs: {pr_number: 42}}}},
      },
    });

    const result = await route({workspaceId, payload: {issue: {number: 42}}});

    expect(deliverEventToListener).toHaveBeenCalledTimes(1);
    expect(listenerTriggered).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({engagedCount: 1, matchedJobCount: 1, acceptedJobCount: 1});
  });

  it.each([
    {
      name: 'integer output',
      filter: 'jobs.build.outputs.count + 1 == 43',
      filterSnapshot: {jobs: {build: {outputs: {count: 42}}}},
      filterOutputTypes: {build: {count: 'int'}},
    },
    {
      name: 'timestamp output',
      filter: 'jobs.build.outputs.createdAt < timestamp("2026-07-01T00:00:00Z")',
      filterSnapshot: {jobs: {build: {outputs: {createdAt: '2026-06-30T12:00:00.000Z'}}}},
      filterOutputTypes: {build: {createdAt: 'timestamp'}},
    },
    {
      name: 'integer execution output',
      filter: 'jobs.build.executions[0].outputs.count + 1 == 43',
      filterSnapshot: {jobs: {build: {executions: [{outputs: {count: 42}}]}}},
      filterOutputTypes: {build: {count: 'int'}},
    },
    {
      name: 'timestamp execution output',
      filter: 'jobs.build.executions[0].outputs.createdAt < timestamp("2026-07-01T00:00:00Z")',
      filterSnapshot: {
        jobs: {build: {executions: [{outputs: {createdAt: '2026-06-30T12:00:00.000Z'}}]}},
      },
      filterOutputTypes: {build: {createdAt: 'timestamp'}},
    },
    {
      name: 'nested output',
      filter: 'jobs.build.outputs.details.count + 1 == 43',
      filterSnapshot: {jobs: {build: {outputs: {details: {count: 42}}}}},
      filterOutputTypes: {
        build: {details: {kind: 'object', fields: {count: 'int'}}},
      },
    },
  ])('rehydrates a $name in listener filters', async ({
    filter,
    filterSnapshot,
    filterOutputTypes,
  }) => {
    const workspaceId = crypto.randomUUID();
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'pull_request_review',
      config: {
        filter,
        filter_snapshot: filterSnapshot,
        filter_output_types: filterOutputTypes,
      },
    });

    const result = await route({workspaceId});

    expect(deliverEventToListener).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({engagedCount: 1, matchedJobCount: 1, acceptedJobCount: 1});
  });

  it('does not deliver or record a decision when a listener filter returns false', async () => {
    const workspaceId = crypto.randomUUID();
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'pull_request_review',
      config: {
        filter: 'event.issue.number == jobs.build.outputs.pr_number',
        filter_snapshot: {jobs: {build: {outputs: {pr_number: 42}}}},
      },
    });

    const result = await route({workspaceId, payload: {issue: {number: 7}}});

    expect(deliverEventToListener).not.toHaveBeenCalled();
    expect(listenerTriggered).not.toHaveBeenCalled();
    expect(listenerFilterErrored).not.toHaveBeenCalled();
    expect(result).toMatchObject({engagedCount: 0, matchedJobCount: 0, acceptedJobCount: 0});
  });

  it.each([
    'on',
    'until',
  ] as const)('fails closed when a %s listener snapshot contains a foreign root', async (kind) => {
    const workspaceId = crypto.randomUUID();
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      kind,
      source: 'github',
      event: 'pull_request_review',
      config: {
        filter: 'executions.size() > 0',
        filter_snapshot: {executions: [{status: 'succeeded'}]},
      },
    });

    const result = await route({workspaceId});

    expect(deliverEventToListener).not.toHaveBeenCalled();
    expect(listenerFilterErrored).toHaveBeenCalledWith(
      expect.objectContaining({kind}),
      'Listener filter evaluation failed',
    );
    expect(result).toMatchObject({engagedCount: 1, matchedJobCount: 0, acceptedJobCount: 0});
  });

  it.each([
    {name: 'missing jobs snapshot', filterSnapshot: {}},
    {name: 'empty jobs snapshot', filterSnapshot: {jobs: {}}},
  ])('records filter-error when listener filter evaluation fails with $name', async ({
    filterSnapshot,
  }) => {
    const workspaceId = crypto.randomUUID();
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'pull_request_review',
      config: {
        filter: 'event.issue.number == jobs.build.outputs.pr_number',
        filter_snapshot: filterSnapshot,
      },
    });

    const result = await route({workspaceId, payload: {issue: {number: 42}}});

    expect(deliverEventToListener).not.toHaveBeenCalled();
    expect(listenerFilterErrored).toHaveBeenCalledTimes(1);
    expect(listenerFilterErrored).toHaveBeenCalledWith(
      expect.objectContaining({source: 'github', event: 'pull_request_review'}),
      'Listener filter evaluation failed',
    );
    expect(result).toMatchObject({engagedCount: 1, matchedJobCount: 0, acceptedJobCount: 0});
  });

  it('records filter-error when a listener snapshot is malformed', async () => {
    const workspaceId = crypto.randomUUID();
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'pull_request_review',
      config: {
        filter: 'event.issue.number == jobs.build.outputs.pr_number',
        filter_snapshot: ['not-object'],
      },
    });

    const result = await route({workspaceId, payload: {issue: {number: 42}}});

    expect(deliverEventToListener).not.toHaveBeenCalled();
    expect(listenerFilterErrored).toHaveBeenCalledWith(
      expect.anything(),
      'Listener filter snapshot must be an object when set',
    );
    expect(result).toMatchObject({engagedCount: 1, matchedJobCount: 0});
  });

  it('chooses the lowest ordinal when multiple same-kind matchers pass for one job', async () => {
    const workspaceId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      jobId,
      kind: 'on',
      matcherOrdinal: 1,
      source: 'github',
      event: 'pull_request_review',
    });
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      jobId,
      kind: 'on',
      matcherOrdinal: 0,
      source: 'github',
      event: 'pull_request_review',
    });

    await route({workspaceId});

    expect(deliverEventToListener).toHaveBeenCalledTimes(1);
    expect(listenerTriggered).toHaveBeenCalledWith(
      expect.objectContaining({jobId, kind: 'on', matcherOrdinal: 0}),
    );
  });

  it('chooses a deterministic subscription id order for duplicate matcher keys', async () => {
    const workspaceId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const kept = jobListenerSubscriptionFactory.build({
      id: '00000000-0000-7000-8000-000000000001',
      workspaceId,
      jobId,
      kind: 'on',
      matcherOrdinal: 0,
      source: 'github',
      event: 'pull_request_review',
    });
    const first = jobListenerSubscriptionFactory.build({
      id: '00000000-0000-7000-8000-000000000002',
      workspaceId,
      jobId,
      kind: 'on',
      matcherOrdinal: 0,
      source: 'github',
      event: 'pull_request_review',
    });
    findMatchingJobListenerSubscriptions.mockResolvedValueOnce([first, kept]);

    const result = await route({workspaceId});

    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId,
        keptSubscriptionId: first.id,
        candidateSubscriptionId: kept.id,
        matcherKind: 'on',
        matcherOrdinal: 0,
      }),
      'duplicate job listener matcher key encountered; choosing deterministic subscription id order',
    );
    expect(listenerTriggered).toHaveBeenCalledWith(expect.objectContaining({id: kept.id}));
    expect(result).toMatchObject({engagedCount: 1, matchedJobCount: 1, acceptedJobCount: 1});
  });

  it('does not record triggered for skipped stale listener jobs', async () => {
    const workspaceId = crypto.randomUUID();
    await jobListenerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'pull_request_review',
    });
    deliverEventToListener.mockResolvedValueOnce({buffered: false, skipped: true});

    const result = await route({workspaceId});

    expect(listenerTriggered).not.toHaveBeenCalled();
    expect(result).toMatchObject({engagedCount: 0, matchedJobCount: 1, acceptedJobCount: 0});
  });
});
