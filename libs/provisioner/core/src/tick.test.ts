import type {CreateRunnerInstancesBodyDto} from '@shipfox/api-runners-dto';
import type {ProvisionerClient} from './api-client.js';
import {runProvisionerTick} from './tick.js';
import {createInMemoryTracker} from './tracker.js';

describe('runProvisionerTick', () => {
  it('creates runner instances with bootstrap tokens before launching demand-driven runners', async () => {
    const calls: string[] = [];
    const createBodies: CreateRunnerInstancesBodyDto[] = [];
    const client: ProvisionerClient = {
      getIdentity: async () => ({id: 'provisioner', scope: 'workspace', workspace_id: 'workspace'}),
      pollDemand: async () => ({
        stats: [],
        reservations: [
          {
            reservation_id: '018f0d4c-5f42-7b7e-9d9b-4a7d8e6f0001',
            labels: ['linux'],
            count: 1,
            expires_at: '2026-07-21T12:00:00.000Z',
          },
        ],
        newly_reserved_count: 2,
        terminate_provider_runner_ids: [],
      }),
      createRunnerInstances: (body) => {
        calls.push('create');
        createBodies.push(body);
        return Promise.resolve({
          runner_instances: [
            {
              runner_instance_id: '018f0d4c-5f42-7b7e-9d9b-4a7d8e6f0002',
              bootstrap_token: 'sf_rbt_test',
            },
          ],
        });
      },
      attachRunnerInstanceProviderId: async () => ({attached: true}),
      assignRunnerInstances: async (_reservationId, runnerInstanceIds) => ({
        runner_instance_ids: runnerInstanceIds,
      }),
      reportRunnerInstances: async () => ({accepted: 0, reservations_released: 0}),
      reconcileRunnerInstances: async () => ({
        runners: [],
        terminated_absent_provider_runner_ids: [],
      }),
    };
    const launches: string[] = [];

    const result = await runProvisionerTick({
      client,
      templates: [{key: 'linux', labels: ['linux'], maxConcurrency: 1, cost: 1, spec: null}],
      tracker: createInMemoryTracker(),
      launch: (launch) => {
        calls.push('launch');
        launches.push(launch.bootstrapToken ?? '');
        return Promise.resolve({containerStarted: true, identityAttached: false, reported: false});
      },
      buildRunnerEnv: ({bootstrapToken}) => ({
        SHIPFOX_RUNNER_BOOTSTRAP_TOKEN: bootstrapToken ?? '',
      }),
      reservationLimit: 1,
      launchBudget: 1,
      waitSeconds: 0,
      runnerInstanceBatchSize: 1,
    });

    expect(calls).toEqual(['create', 'launch']);
    expect(launches).toEqual(['sf_rbt_test']);
    expect(result).toMatchObject({
      launchedCount: 1,
      providerLaunchFailureCount: 0,
      reservedRunnerCount: 2,
    });
    expect(result.launchLifecycleIncompleteCount).toBe(1);
    expect(createBodies).toEqual([
      {
        runner_instances: [
          {template_key: 'linux', reservation_id: '018f0d4c-5f42-7b7e-9d9b-4a7d8e6f0001'},
        ],
      },
    ]);
  });

  it('counts a warm reservation shortfall without a capacity failure', async () => {
    const client: ProvisionerClient = {
      getIdentity: async () => ({id: 'provisioner', scope: 'workspace', workspace_id: 'workspace'}),
      pollDemand: async () => ({
        stats: [],
        reservations: [],
        terminate_provider_runner_ids: [],
      }),
      createRunnerInstances: async () => ({runner_instances: [], reservation_unavailable: true}),
      attachRunnerInstanceProviderId: async () => ({attached: true}),
      assignRunnerInstances: async (_reservationId, runnerInstanceIds) => ({
        runner_instance_ids: runnerInstanceIds,
      }),
      reportRunnerInstances: async () => ({accepted: 0, reservations_released: 0}),
      reconcileRunnerInstances: async () => ({
        runners: [],
        terminated_absent_provider_runner_ids: [],
      }),
    };

    const result = await runProvisionerTick({
      client,
      templates: [
        {
          key: 'linux',
          labels: ['linux'],
          maxConcurrency: 1,
          targetConcurrency: 1,
          cost: 1,
          spec: null,
        },
      ],
      tracker: createInMemoryTracker(),
      launch: () => Promise.resolve(),
      buildRunnerEnv: ({bootstrapToken}) => ({
        SHIPFOX_RUNNER_BOOTSTRAP_TOKEN: bootstrapToken,
      }),
      reservationLimit: 1,
      launchBudget: 1,
      waitSeconds: 0,
      runnerInstanceBatchSize: 1,
    });

    expect(result).toMatchObject({
      plannedCount: 1,
      launchAttemptedCount: 0,
      launchedCount: 0,
      runnerInstanceCreationFailureCount: 0,
      reservationConsumedOrStaleCount: 1,
    });
  });

  it('keeps a consumed or stale reservation shortfall out of capacity failures for old responses', async () => {
    let createCalls = 0;
    const client: ProvisionerClient = {
      getIdentity: async () => ({id: 'provisioner', scope: 'workspace', workspace_id: 'workspace'}),
      pollDemand: async () => ({
        stats: [],
        reservations: [
          {
            reservation_id: '018f0d4c-5f42-7b7e-9d9b-4a7d8e6f0001',
            labels: ['linux'],
            count: 3,
            expires_at: '2026-07-21T12:00:00.000Z',
          },
        ],
        terminate_provider_runner_ids: [],
      }),
      createRunnerInstances: () => {
        createCalls += 1;
        return Promise.resolve({runner_instances: []});
      },
      attachRunnerInstanceProviderId: async () => ({attached: true}),
      assignRunnerInstances: async (_reservationId, runnerInstanceIds) => ({
        runner_instance_ids: runnerInstanceIds,
      }),
      reportRunnerInstances: async () => ({accepted: 0, reservations_released: 0}),
      reconcileRunnerInstances: async () => ({
        runners: [],
        terminated_absent_provider_runner_ids: [],
      }),
    };

    const result = await runProvisionerTick({
      client,
      templates: [{key: 'linux', labels: ['linux'], maxConcurrency: 3, cost: 1, spec: null}],
      tracker: createInMemoryTracker(),
      launch: () => Promise.resolve(),
      buildRunnerEnv: ({bootstrapToken}) => ({
        SHIPFOX_RUNNER_BOOTSTRAP_TOKEN: bootstrapToken,
      }),
      reservationLimit: 3,
      launchBudget: 3,
      waitSeconds: 0,
      runnerInstanceBatchSize: 1,
    });

    expect(result).toMatchObject({
      plannedCount: 3,
      launchAttemptedCount: 0,
      launchedCount: 0,
      runnerInstanceCreationFailureCount: 0,
      reservationConsumedOrStaleCount: 3,
    });
    expect(createCalls).toBe(1);
  });

  it('propagates an aborted runner-instance creation without counting capacity failure', async () => {
    const controller = new AbortController();
    const client: ProvisionerClient = {
      getIdentity: async () => ({id: 'provisioner', scope: 'workspace', workspace_id: 'workspace'}),
      pollDemand: async () => ({
        stats: [],
        reservations: [
          {
            reservation_id: '018f0d4c-5f42-7b7e-9d9b-4a7d8e6f0001',
            labels: ['linux'],
            count: 1,
            expires_at: '2026-07-21T12:00:00.000Z',
          },
        ],
        terminate_provider_runner_ids: [],
      }),
      createRunnerInstances: () => {
        controller.abort('shutdown');
        return Promise.reject(new Error('create aborted'));
      },
      attachRunnerInstanceProviderId: async () => ({attached: true}),
      assignRunnerInstances: async (_reservationId, runnerInstanceIds) => ({
        runner_instance_ids: runnerInstanceIds,
      }),
      reportRunnerInstances: async () => ({accepted: 0, reservations_released: 0}),
      reconcileRunnerInstances: async () => ({
        runners: [],
        terminated_absent_provider_runner_ids: [],
      }),
    };

    await expect(
      runProvisionerTick({
        client,
        templates: [{key: 'linux', labels: ['linux'], maxConcurrency: 1, cost: 1, spec: null}],
        tracker: createInMemoryTracker(),
        launch: () => Promise.resolve(),
        buildRunnerEnv: ({bootstrapToken}) => ({
          SHIPFOX_RUNNER_BOOTSTRAP_TOKEN: bootstrapToken,
        }),
        reservationLimit: 1,
        launchBudget: 1,
        waitSeconds: 0,
        runnerInstanceBatchSize: 1,
        signal: controller.signal,
      }),
    ).rejects.toThrow('create aborted');
  });

  it('includes target-concurrency launches in the planned count', async () => {
    const client: ProvisionerClient = {
      getIdentity: async () => ({id: 'provisioner', scope: 'workspace', workspace_id: 'workspace'}),
      pollDemand: async ({max_reservations}) => ({
        stats: [],
        reservations:
          max_reservations > 0
            ? [
                {
                  reservation_id: '018f0d4c-5f42-7b7e-9d9b-4a7d8e6f0001',
                  labels: ['linux'],
                  count: 1,
                  expires_at: '2026-07-21T12:00:00.000Z',
                },
              ]
            : [],
        terminate_provider_runner_ids: [],
      }),
      createRunnerInstances: async () => ({
        runner_instances: [
          {
            runner_instance_id: '018f0d4c-5f42-7b7e-9d9b-4a7d8e6f0002',
            bootstrap_token: 'sf_rbt_test',
          },
        ],
      }),
      attachRunnerInstanceProviderId: async () => ({attached: true}),
      assignRunnerInstances: async (_reservationId, runnerInstanceIds) => ({
        runner_instance_ids: runnerInstanceIds,
      }),
      reportRunnerInstances: async () => ({accepted: 0, reservations_released: 0}),
      reconcileRunnerInstances: async () => ({
        runners: [],
        terminated_absent_provider_runner_ids: [],
      }),
    };

    const tickOptions = {
      client,
      templates: [
        {
          key: 'linux',
          labels: ['linux'],
          maxConcurrency: 2,
          targetConcurrency: 2,
          cost: 1,
          spec: null,
        },
      ],
      tracker: createInMemoryTracker(),
      launch: () => Promise.resolve(),
      buildRunnerEnv: ({bootstrapToken}: {bootstrapToken: string}) => ({
        SHIPFOX_RUNNER_BOOTSTRAP_TOKEN: bootstrapToken,
      }),
      reservationLimit: 1,
      launchBudget: 1,
      waitSeconds: 0,
      runnerInstanceBatchSize: 1,
    };
    const closed = await runProvisionerTick({...tickOptions, launchBudget: 0});
    const result = await runProvisionerTick({...tickOptions, launchBudget: 1});
    expect(closed).toMatchObject({plannedCount: 2, launchAttemptedCount: 0, launchedCount: 0});

    expect(result).toMatchObject({plannedCount: 2, launchAttemptedCount: 1, launchedCount: 1});
  });
  it('keeps the reservation poll limit independent from warm-pool admission', async () => {
    let requestedReservations = -1;
    const createBodies: CreateRunnerInstancesBodyDto[] = [];
    const client: ProvisionerClient = {
      getIdentity: async () => ({id: 'provisioner', scope: 'workspace', workspace_id: 'workspace'}),
      pollDemand: (body) => {
        requestedReservations = body.max_reservations;
        return Promise.resolve({stats: [], reservations: [], terminate_provider_runner_ids: []});
      },
      createRunnerInstances: (body) => {
        createBodies.push(body);
        return Promise.resolve({
          runner_instances: [
            {
              runner_instance_id: '018f0d4c-5f42-7b7e-9d9b-4a7d8e6f0002',
              bootstrap_token: 'sf_rbt_test',
            },
          ],
        });
      },
      attachRunnerInstanceProviderId: async () => ({attached: true}),
      assignRunnerInstances: async (_reservationId, runnerInstanceIds) => ({
        runner_instance_ids: runnerInstanceIds,
      }),
      reportRunnerInstances: async () => ({accepted: 0, reservations_released: 0}),
      reconcileRunnerInstances: async () => ({
        runners: [],
        terminated_absent_provider_runner_ids: [],
      }),
    };
    const result = await runProvisionerTick({
      client,
      templates: [
        {
          key: 'linux',
          labels: ['linux'],
          maxConcurrency: 2,
          targetConcurrency: 2,
          cost: 1,
          spec: null,
        },
      ],
      tracker: createInMemoryTracker(),
      launch: () => Promise.resolve(),
      buildRunnerEnv: ({bootstrapToken}) => ({
        SHIPFOX_RUNNER_BOOTSTRAP_TOKEN: bootstrapToken,
      }),
      reservationLimit: 0,
      launchBudget: Number.POSITIVE_INFINITY,
      waitSeconds: 0,
      runnerInstanceBatchSize: 1,
    });
    expect(requestedReservations).toBe(0);
    expect(result).toMatchObject({plannedCount: 2, launchAttemptedCount: 2, launchedCount: 2});
    expect(createBodies).toEqual([
      {runner_instances: [{template_key: 'linux'}]},
      {runner_instances: [{template_key: 'linux'}]},
    ]);
  });

  it('plans from tracker capacity observed after the demand poll', async () => {
    const tracker = createInMemoryTracker();
    let requestedReservations = -1;
    const client = createTestClient({
      pollDemand: (body) => {
        requestedReservations = body.max_reservations;
        tracker.recordStarting({providerRunnerId: 'existing', templateKey: 'linux'});
        return Promise.resolve(demandResponse());
      },
    });

    const result = await runProvisionerTick({
      client,
      templates: [{key: 'linux', labels: ['linux'], maxConcurrency: 1, cost: 1, spec: null}],
      tracker,
      launch: () => Promise.resolve(),
      buildRunnerEnv: ({bootstrapToken}) => ({SHIPFOX_RUNNER_BOOTSTRAP_TOKEN: bootstrapToken}),
      reservationLimit: 1,
      launchBudget: 1,
      waitSeconds: 0,
      runnerInstanceBatchSize: 1,
    });

    expect(requestedReservations).toBe(1);
    expect(result).toMatchObject({reservationCount: 1, plannedCount: 0, launchAttemptedCount: 0});
  });

  it('re-evaluates a lazy launch budget after polling demand', async () => {
    let requestedReservations = -1;
    const budgets = [1, 0];
    const client = createTestClient({
      pollDemand: (body) => {
        requestedReservations = body.max_reservations;
        return Promise.resolve(demandResponse());
      },
      createRunnerInstances: async () => ({
        runner_instances: [{runner_instance_id: 'runner-instance', bootstrap_token: 'sf_rbt_test'}],
      }),
    });

    const result = await runProvisionerTick({
      client,
      templates: [{key: 'linux', labels: ['linux'], maxConcurrency: 1, cost: 1, spec: null}],
      tracker: createInMemoryTracker(),
      launch: () => Promise.resolve(),
      buildRunnerEnv: ({bootstrapToken}) => ({SHIPFOX_RUNNER_BOOTSTRAP_TOKEN: bootstrapToken}),
      reservationLimit: 1,
      launchBudget: () => budgets.shift() ?? 0,
      waitSeconds: 0,
      runnerInstanceBatchSize: 1,
    });

    expect(requestedReservations).toBe(1);
    expect(result).toMatchObject({plannedCount: 1, launchAttemptedCount: 0, launchedCount: 0});
  });

  it('holds completion mutations behind the provider lock', async () => {
    let signalPollStarted!: () => void;
    const pollStarted = new Promise<void>((resolve) => {
      signalPollStarted = resolve;
    });
    let releasePoll!: (response: ReturnType<typeof demandResponse>) => void;
    const pollResponse = new Promise<ReturnType<typeof demandResponse>>((resolve) => {
      releasePoll = resolve;
    });
    const client = createTestClient({
      pollDemand: () => {
        signalPollStarted();
        return pollResponse;
      },
      createRunnerInstances: async () => ({
        runner_instances: [{runner_instance_id: 'runner-instance', bootstrap_token: 'sf_rbt_test'}],
      }),
    });
    const launches: string[] = [];
    let releaseLock!: () => void;
    const lock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    let signalLockEntered!: () => void;
    const lockEntered = new Promise<void>((resolve) => {
      signalLockEntered = resolve;
    });
    const withProviderLock = async <Result>(operation: () => Promise<Result>) => {
      signalLockEntered();
      await lock;
      return operation();
    };

    const tick = runProvisionerTick({
      client,
      templates: [{key: 'linux', labels: ['linux'], maxConcurrency: 1, cost: 1, spec: null}],
      tracker: createInMemoryTracker(),
      launch: () => {
        launches.push('launch');
        return Promise.resolve();
      },
      buildRunnerEnv: ({bootstrapToken}) => ({SHIPFOX_RUNNER_BOOTSTRAP_TOKEN: bootstrapToken}),
      reservationLimit: 1,
      launchBudget: 1,
      waitSeconds: 0,
      runnerInstanceBatchSize: 1,
      withProviderLock,
    });

    await pollStarted;
    releasePoll(demandResponse());
    await lockEntered;
    expect(launches).toEqual([]);

    releaseLock();
    await tick;
    expect(launches).toEqual(['launch']);
  });
});

function createTestClient(options: {
  readonly pollDemand: ProvisionerClient['pollDemand'];
  readonly createRunnerInstances?: ProvisionerClient['createRunnerInstances'];
}): ProvisionerClient {
  return {
    getIdentity: async () => ({id: 'provisioner', scope: 'workspace', workspace_id: 'workspace'}),
    pollDemand: options.pollDemand,
    createRunnerInstances: options.createRunnerInstances ?? (async () => ({runner_instances: []})),
    attachRunnerInstanceProviderId: async () => ({attached: true}),
    assignRunnerInstances: async (_reservationId, runnerInstanceIds) => ({
      runner_instance_ids: runnerInstanceIds,
    }),
    reportRunnerInstances: async () => ({accepted: 0, reservations_released: 0}),
    reconcileRunnerInstances: async () => ({
      runners: [],
      terminated_absent_provider_runner_ids: [],
    }),
  };
}

function demandResponse() {
  return {
    stats: [],
    reservations: [
      {
        reservation_id: '018f0d4c-5f42-7b7e-9d9b-4a7d8e6f0001',
        labels: ['linux'],
        count: 1,
        expires_at: '2026-07-21T12:00:00.000Z',
      },
    ],
    terminate_provider_runner_ids: [],
  };
}
