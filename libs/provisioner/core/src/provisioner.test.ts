import type {
  CreateRunnerInstancesBodyDto,
  PollDemandBodyDto,
  PollDemandResponseDto,
} from '@shipfox/api-runners-dto';
import type {ProvisionerClient} from '#api-client.js';
import {createHealthState} from '#health.js';
import {
  createTerminationQueue,
  drainTerminationQueue,
  runConvergeIteration,
  runDemandIteration,
  runProvisionerIteration,
  startProvisioner,
} from '#provisioner.js';
import {createInMemoryTracker} from '#tracker.js';
import type {ProvisionerAdapter, ProvisionerTemplate} from '#types.js';

const observability = vi.hoisted(() => ({
  logger: {debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn()},
}));
vi.mock('@shipfox/node-opentelemetry', () => ({logger: () => observability.logger}));

const EXPIRES_AT = '2026-01-01T00:00:00.000Z';

const template: ProvisionerTemplate<null> = {
  key: 'small',
  labels: ['ubuntu22'],
  maxConcurrency: 5,
  cost: 1,
  spec: null,
};

describe('runProvisionerIteration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards the adapter reservation TTL to demand polling', async () => {
    const {client, pollBodies} = harness({response: {stats: [], reservations: []}});
    const adapter: ProvisionerAdapter<null> = {
      loadTemplates: () => Promise.resolve([template]),
      reservationTtlSeconds: 300,
      launch: () => Promise.resolve(),
    };

    await runDemandIteration({
      adapter,
      client,
      templates: [template],
      tracker: createInMemoryTracker(),
      currentInterval: 1000,
    });

    expect(pollBodies[0]).toMatchObject({reservation_ttl_seconds: 300});
  });

  it('omits the reservation TTL when the adapter does not declare one', async () => {
    const {client, pollBodies} = harness({response: {stats: [], reservations: []}});
    const adapter: ProvisionerAdapter<null> = {
      loadTemplates: () => Promise.resolve([template]),
      launch: () => Promise.resolve(),
    };

    await runDemandIteration({
      adapter,
      client,
      templates: [template],
      tracker: createInMemoryTracker(),
      currentInterval: 1000,
    });

    expect(pollBodies[0]).not.toHaveProperty('reservation_ttl_seconds');
  });

  it('forwards each latest demand snapshot to the adapter', async () => {
    const firstStats = [
      {
        labels: ['ubuntu22'],
        queued: 3,
        reserved: 1,
        oldest_queued_at: '2026-01-01T00:00:00.000Z',
      },
    ];
    const secondStats = [
      {
        labels: ['ubuntu22', 'gpu'],
        queued: 1,
        reserved: 0,
        oldest_queued_at: '2026-01-01T00:01:00.000Z',
      },
    ];
    const {client} = harness({
      responses: [
        {stats: firstStats, reservations: []},
        {stats: secondStats, reservations: []},
        {stats: [], reservations: []},
      ],
    });
    const onDemandStats = vi.fn();
    const adapter: ProvisionerAdapter<null> = {
      loadTemplates: () => Promise.resolve([template]),
      launch: () => Promise.resolve(),
      onDemandStats,
    };

    for (let iteration = 0; iteration < 3; iteration += 1) {
      await runDemandIteration({
        adapter,
        client,
        templates: [template],
        tracker: createInMemoryTracker(),
        currentInterval: 1000,
      });
    }

    expect(onDemandStats).toHaveBeenNthCalledWith(1, firstStats);
    expect(onDemandStats).toHaveBeenNthCalledWith(2, secondStats);
    expect(onDemandStats).toHaveBeenNthCalledWith(3, []);
  });

  it('clears the adapter demand snapshot after a failed poll', async () => {
    const {client} = harness({response: {stats: [], reservations: []}});
    client.pollDemand = () => Promise.reject(new Error('demand poll unavailable'));
    const onDemandStats = vi.fn();
    const adapter: ProvisionerAdapter<null> = {
      loadTemplates: () => Promise.resolve([template]),
      launch: () => Promise.resolve(),
      onDemandStats,
    };

    await expect(
      runDemandIteration({
        adapter,
        client,
        templates: [template],
        tracker: createInMemoryTracker(),
        currentInterval: 1000,
      }),
    ).rejects.toThrow('demand poll unavailable');

    expect(onDemandStats).toHaveBeenCalledWith([]);
  });

  it('contains provider demand snapshot delivery failures and continues the iteration', async () => {
    const {client} = harness({response: {stats: [], reservations: []}});
    const health = createHealthState();
    const adapter: ProvisionerAdapter<null> = {
      loadTemplates: () => Promise.resolve([template]),
      launch: () => Promise.resolve(),
      onDemandStats: () => {
        throw new Error('metrics cache unavailable');
      },
    };

    const result = await runDemandIteration({
      adapter,
      client,
      templates: [template],
      tracker: createInMemoryTracker(),
      currentInterval: 1000,
      health,
    });

    expect(result).toEqual({nextInterval: 1500, degraded: true});
    expect(health.active.has('provider_observation')).toBe(true);
    expect(health.active.get('provider_observation')?.cause).toBe(
      'Demand snapshot delivery failed: metrics cache unavailable',
    );
    expect(observability.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'provisioner.demand_stats_delivery_failed',
        reason: 'metrics cache unavailable',
      }),
      'Provider demand snapshot delivery failed',
    );
  });

  it('preserves an existing provider observation failure across snapshot delivery', async () => {
    const {client} = harness({response: {stats: [], reservations: []}});
    const health = createHealthState();
    health.active = new Map([
      ['provider_observation', {cause: 'reconciliation unavailable', impact: 'capacity'}],
    ]);
    let shouldFail = true;
    const adapter: ProvisionerAdapter<null> = {
      loadTemplates: () => Promise.resolve([template]),
      launch: () => Promise.resolve(),
      onDemandStats: () => {
        if (shouldFail) throw new Error('metrics cache unavailable');
      },
    };

    await runDemandIteration({
      adapter,
      client,
      templates: [template],
      tracker: createInMemoryTracker(),
      currentInterval: 1000,
      health,
    });
    expect(health.active.get('provider_observation')).toEqual({
      cause: 'reconciliation unavailable',
      impact: 'capacity',
    });

    shouldFail = false;
    await runDemandIteration({
      adapter,
      client,
      templates: [template],
      tracker: createInMemoryTracker(),
      currentInterval: 1000,
      health,
    });
    expect(health.active.get('provider_observation')).toEqual({
      cause: 'reconciliation unavailable',
      impact: 'capacity',
    });
  });

  it('runs onTick before polling demand', async () => {
    const events: string[] = [];
    const {client} = harness({
      response: {stats: [], reservations: []},
      onPoll: () => events.push('poll'),
    });
    const adapter: ProvisionerAdapter<null> = {
      loadTemplates: () => Promise.resolve([template]),
      launch: () => Promise.resolve(),
      onTick: () => {
        events.push('observe');
        return Promise.resolve();
      },
    };

    await runProvisionerIteration({
      adapter,
      client,
      templates: [template],
      tracker: createInMemoryTracker(),
      currentInterval: 1000,
    });

    expect(events).toEqual(['observe', 'poll']);
  });

  it('includes the incomplete lifecycle stage in the launch batch log', async () => {
    const {client} = harness({response: {stats: [], reservations: [reservation(1)]}});
    const adapter: ProvisionerAdapter<null> = {
      loadTemplates: () => Promise.resolve([template]),
      launch: () =>
        Promise.resolve({containerStarted: true, identityAttached: false, reported: false}),
      onTick: () => Promise.resolve(),
    };
    await runProvisionerIteration({
      adapter,
      client,
      templates: [template],
      tracker: createInMemoryTracker(),
      currentInterval: 1000,
    });
    const launchBatchLog = observability.logger.info.mock.calls.find(
      ([fields]) => fields?.event === 'runner.launch_batch_completed',
    );
    expect(launchBatchLog?.[0]).toMatchObject({
      lifecycleIncomplete: 1,
      launchLifecycleIncompleteReason: 'Runner launch lifecycle incomplete: identity, report.',
    });
  });
  it('keeps reservations closed and backs off when provider observation fails', async () => {
    const {client, pollBodies} = harness({response: {stats: [], reservations: []}});
    const adapter: ProvisionerAdapter<null> = {
      loadTemplates: () => Promise.resolve([template]),
      launch: () => Promise.resolve(),
      onTick: () => Promise.reject(new Error('docker daemon down')),
    };

    const result = await runProvisionerIteration({
      adapter,
      client,
      templates: [template],
      tracker: createInMemoryTracker(),
      currentInterval: 1000,
    });

    expect(pollBodies[0]?.max_reservations).toBe(0);
    expect(result).toEqual({nextInterval: 1500, degraded: true});
  });

  it('keeps reservations closed while a provider observation still fails', async () => {
    const {client, pollBodies} = harness({response: {stats: [], reservations: []}});
    const adapter: ProvisionerAdapter<null> = {
      loadTemplates: () => Promise.resolve([template]),
      launch: () => Promise.resolve(),
      onTick: () => Promise.reject(new Error('docker daemon down')),
    };

    const result = await runProvisionerIteration({
      adapter,
      client,
      templates: [template],
      tracker: createInMemoryTracker(),
      currentInterval: 1000,
    });

    expect(pollBodies[0]?.max_reservations).toBe(0);
    expect(result).toEqual({nextInterval: 1500, degraded: true});
  });

  it('keeps degraded mode when no observe hook is available', async () => {
    const {client, pollBodies} = harness({response: {stats: [], reservations: []}});
    const adapter: ProvisionerAdapter<null> = {
      loadTemplates: () => Promise.resolve([template]),
      launch: () => Promise.resolve(),
    };
    const health = createHealthState();
    health.active = new Map([
      ['provider_observation', {cause: 'startup reconciliation failed', impact: 'capacity'}],
    ]);

    const result = await runProvisionerIteration({
      adapter,
      client,
      templates: [template],
      tracker: createInMemoryTracker(),
      currentInterval: 1000,
      health,
    });

    expect(pollBodies[0]?.max_reservations).toBe(0);
    expect(result).toEqual({nextInterval: 1500, degraded: true});
  });

  it('backs off when every attempted launch fails', async () => {
    const {client} = harness({response: {stats: [], reservations: [reservation(2)]}});
    const adapter: ProvisionerAdapter<null> = {
      loadTemplates: () => Promise.resolve([template]),
      launch: () => Promise.reject(new Error('start failed')),
      onTick: () => Promise.resolve(),
    };

    const result = await runProvisionerIteration({
      adapter,
      client,
      templates: [template],
      tracker: createInMemoryTracker(),
      currentInterval: 1000,
    });

    expect(result).toEqual({nextInterval: 1500, degraded: true});
  });

  it('logs but does not degrade when a reservation is consumed or stale', async () => {
    const {client} = harness({response: {stats: [], reservations: [reservation(1)]}});
    client.createRunnerInstances = () =>
      Promise.resolve({runner_instances: [], reservation_unavailable: true});
    const adapter: ProvisionerAdapter<null> = {
      loadTemplates: () => Promise.resolve([template]),
      launch: () => Promise.resolve(),
      onTick: () => Promise.resolve(),
    };

    const result = await runDemandIteration({
      adapter,
      client,
      templates: [template],
      tracker: createInMemoryTracker(),
      currentInterval: 1000,
    });

    expect(result).toEqual({nextInterval: 1000, degraded: false});
    expect(observability.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({event: 'runner.reservation_consumed_or_stale', skipped: 1}),
      'Runner reservation was consumed or stale; skipping unavailable launches',
    );
  });

  it('uses the next degraded poll as a launch probe and recovers after it succeeds', async () => {
    const {client, pollBodies} = harness({response: {stats: [], reservations: [reservation(1)]}});
    const health = createHealthState();
    let launchAttempts = 0;
    const adapter: ProvisionerAdapter<null> = {
      loadTemplates: () => Promise.resolve([template]),
      launch: () => {
        launchAttempts += 1;
        return launchAttempts === 1 ? Promise.reject(new Error('start failed')) : Promise.resolve();
      },
      onTick: () => Promise.resolve(),
    };
    const first = await runProvisionerIteration({
      adapter,
      client,
      templates: [template],
      tracker: createInMemoryTracker(),
      currentInterval: 1000,
      health,
    });
    const second = await runProvisionerIteration({
      adapter,
      client,
      templates: [template],
      tracker: createInMemoryTracker(),
      currentInterval: first.nextInterval,
      health,
    });
    expect(pollBodies.map((body) => body.max_reservations)).toEqual([5, 1]);
    expect(second.degraded).toBe(false);
  });
  it('resets to the base interval after a healthy observe and successful launch', async () => {
    const {client} = harness({response: {stats: [], reservations: [reservation(1)]}});
    const adapter: ProvisionerAdapter<null> = {
      loadTemplates: () => Promise.resolve([template]),
      launch: () => Promise.resolve(),
      onTick: () => Promise.resolve(),
    };

    const result = await runProvisionerIteration({
      adapter,
      client,
      templates: [template],
      tracker: createInMemoryTracker(),
      currentInterval: 3000,
    });

    expect(result).toEqual({nextInterval: 1000, degraded: false});
  });
});

describe('split demand and converge loops', () => {
  it('replaces deferred termination snapshots when demand withdraws an intent', async () => {
    const queue = createTerminationQueue();

    await queue.replace(['runner-1']);
    expect(queue.take()).toEqual(['runner-1']);

    await queue.replace([]);
    expect(queue.take()).toEqual([]);
  });

  it('runs convergence while demand polling is blocked', async () => {
    const {client} = harness({response: {stats: [], reservations: []}});
    let signalPollStarted!: () => void;
    const pollStarted = new Promise<void>((resolve) => {
      signalPollStarted = resolve;
    });
    let releasePoll!: (response: PollDemandResponseDto) => void;
    const blockedPoll = new Promise<PollDemandResponseDto>((resolve) => {
      releasePoll = resolve;
    });
    client.pollDemand = () => {
      signalPollStarted();
      return blockedPoll;
    };
    let observed = false;
    const health = createHealthState();
    const adapter: ProvisionerAdapter<null> = {
      loadTemplates: () => Promise.resolve([template]),
      launch: () => Promise.resolve(),
      onTick: () => {
        observed = true;
        return Promise.resolve();
      },
    };

    const demand = runDemandIteration({
      adapter,
      client,
      templates: [template],
      tracker: createInMemoryTracker(),
      currentInterval: 1000,
      health,
    });
    await pollStarted;

    await runConvergeIteration({
      adapter,
      currentInterval: 1000,
      baseInterval: 1000,
      health,
    });
    expect(observed).toBe(true);

    releasePoll({stats: [], reservations: [], terminate_provider_runner_ids: []});
    await demand;
  });

  it('does not run observation concurrently with launch', async () => {
    const {client} = harness({response: {stats: [], reservations: [reservation(1)]}});
    let signalLaunchStarted!: () => void;
    const launchStarted = new Promise<void>((resolve) => {
      signalLaunchStarted = resolve;
    });
    let releaseLaunch!: () => void;
    const blockedLaunch = new Promise<void>((resolve) => {
      releaseLaunch = resolve;
    });
    const events: string[] = [];
    const adapter: ProvisionerAdapter<null> = {
      loadTemplates: () => Promise.resolve([template]),
      launch: async () => {
        events.push('launch-start');
        signalLaunchStarted();
        await blockedLaunch;
        events.push('launch-end');
      },
      onTick: () => {
        events.push('observe');
        return Promise.resolve();
      },
    };
    const health = createHealthState();
    const withProviderLock = createTestMutex();

    const demand = runDemandIteration({
      adapter,
      client,
      templates: [template],
      tracker: createInMemoryTracker(),
      currentInterval: 1000,
      health,
      withProviderLock,
    });
    await launchStarted;

    const converge = runConvergeIteration({
      adapter,
      currentInterval: 1000,
      baseInterval: 1000,
      health,
      withProviderLock,
    });
    await Promise.resolve();
    expect(events).toEqual(['launch-start']);

    releaseLaunch();
    await Promise.all([demand, converge]);
    expect(events).toEqual(['launch-start', 'launch-end', 'observe']);
  });

  it('keeps advertised capacity at zero after a failed convergence pass', async () => {
    const {client, pollBodies} = harness({response: {stats: [], reservations: []}});
    const health = createHealthState();
    const adapter: ProvisionerAdapter<null> = {
      loadTemplates: () => Promise.resolve([template]),
      launch: () => Promise.resolve(),
      onTick: () => Promise.reject(new Error('provider unavailable')),
    };

    await runConvergeIteration({
      adapter,
      currentInterval: 1000,
      baseInterval: 1000,
      health,
    });
    await runDemandIteration({
      adapter,
      client,
      templates: [template],
      tracker: createInMemoryTracker(),
      currentInterval: 1000,
      health,
    });

    expect(pollBodies[0]?.max_reservations).toBe(0);
  });

  it('handles queued termination intents during convergence', async () => {
    const {client} = harness({
      response: {stats: [], reservations: [], terminate_provider_runner_ids: ['runner-1']},
    });
    const pending = new Set<string>();
    const terminated: string[][] = [];
    const adapter: ProvisionerAdapter<null> = {
      loadTemplates: () => Promise.resolve([template]),
      launch: () => Promise.resolve(),
      terminate: (providerRunnerIds) => {
        terminated.push([...providerRunnerIds]);
        return Promise.resolve();
      },
    };

    await runDemandIteration({
      adapter,
      client,
      templates: [template],
      tracker: createInMemoryTracker(),
      currentInterval: 1000,
      deferTermination: (providerRunnerIds) => {
        for (const providerRunnerId of providerRunnerIds) pending.add(providerRunnerId);
        return Promise.resolve();
      },
    });
    await runConvergeIteration({
      adapter,
      currentInterval: 1000,
      baseInterval: 1000,
      takeTerminationIntents: () => {
        const providerRunnerIds = [...pending];
        pending.clear();
        return providerRunnerIds;
      },
    });

    expect(terminated).toEqual([['runner-1']]);
    expect(pending).toEqual(new Set());
  });

  it('requeues termination intents when convergence termination fails', async () => {
    const health = createHealthState();
    const requeued: string[][] = [];
    const adapter: ProvisionerAdapter<null> = {
      loadTemplates: () => Promise.resolve([template]),
      launch: () => Promise.resolve(),
      terminate: () => Promise.reject(new Error('provider unavailable')),
    };

    await runConvergeIteration({
      adapter,
      currentInterval: 1000,
      baseInterval: 1000,
      health,
      takeTerminationIntents: () => ['runner-1'],
      requeueTerminationIntents: (providerRunnerIds) => requeued.push([...providerRunnerIds]),
    });

    expect(requeued).toEqual([['runner-1']]);
  });

  it('best-effort drains deferred terminations before shutdown', async () => {
    const terminated: string[][] = [];
    const adapter: ProvisionerAdapter<null> = {
      loadTemplates: () => Promise.resolve([template]),
      launch: () => Promise.resolve(),
      terminate: (providerRunnerIds) => {
        terminated.push([...providerRunnerIds]);
        return Promise.resolve();
      },
    };

    await drainTerminationQueue(adapter, () => ['runner-1', 'runner-2']);

    expect(terminated).toEqual([['runner-1', 'runner-2']]);
  });

  it('logs and returns when deferred termination draining times out', async () => {
    vi.useFakeTimers();
    try {
      const adapter: ProvisionerAdapter<null> = {
        loadTemplates: () => Promise.resolve([template]),
        launch: () => Promise.resolve(),
        terminate: () =>
          new Promise<void>(() => {
            // Intentionally unresolved to exercise the shutdown deadline.
          }),
      };

      const drain = drainTerminationQueue(adapter, () => ['runner-1']);
      await vi.advanceTimersByTimeAsync(1000);
      await drain;

      expect(observability.logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({event: 'provisioner.termination_drain_timed_out'}),
        expect.any(String),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('startProvisioner', () => {
  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects an invalid adapter reservation TTL of %s', async (reservationTtlSeconds) => {
    const onConfigure = vi.fn();

    await expect(
      startProvisioner({
        adapter: {
          loadTemplates: () => Promise.resolve([template]),
          reservationTtlSeconds,
          launch: () => Promise.resolve(),
          onConfigure,
        },
      }),
    ).rejects.toThrow('reservationTtlSeconds');

    expect(onConfigure).not.toHaveBeenCalled();
  });

  it('rejects more than 1000 templates with a clear error', async () => {
    const templates = Array.from({length: 1001}, (_, index) => ({
      ...template,
      key: `template-${index}`,
    }));

    await expect(
      startProvisioner({
        adapter: {
          loadTemplates: () => Promise.resolve(templates),
          launch: () => Promise.resolve(),
        },
      }),
    ).rejects.toThrow('accepts at most 1000');
  });
});

type PollDemandResponseFixture = Omit<PollDemandResponseDto, 'terminate_provider_runner_ids'> &
  Partial<Pick<PollDemandResponseDto, 'terminate_provider_runner_ids'>>;

function harness(options: {
  response?: PollDemandResponseFixture;
  responses?: readonly PollDemandResponseFixture[];
  onPoll?: () => void;
}): {
  client: ProvisionerClient;
  pollBodies: PollDemandBodyDto[];
  createBodies: CreateRunnerInstancesBodyDto[];
} {
  const pollBodies: PollDemandBodyDto[] = [];
  const createBodies: CreateRunnerInstancesBodyDto[] = [];
  let responseIndex = 0;

  return {
    pollBodies,
    createBodies,
    client: {
      getIdentity: () =>
        Promise.resolve({id: 'provisioner', scope: 'workspace', workspace_id: 'workspace'}),
      pollDemand: (body) => {
        options.onPoll?.();
        pollBodies.push(body);
        const response = options.responses?.[responseIndex++] ?? options.response;
        if (!response) return Promise.reject(new Error('poll demand fixture is exhausted'));
        return Promise.resolve({
          ...response,
          terminate_provider_runner_ids: response.terminate_provider_runner_ids ?? [],
        });
      },
      createRunnerInstances: (body) => {
        createBodies.push(body);
        return Promise.resolve({
          runner_instances: body.runner_instances.map(() => ({
            runner_instance_id: crypto.randomUUID(),
            bootstrap_token: 'sf_rbt_test',
          })),
        });
      },
      attachRunnerInstanceProviderId: () => Promise.resolve({attached: true}),
      assignRunnerInstances: (_reservationId, runnerInstanceIds) =>
        Promise.resolve({runner_instance_ids: runnerInstanceIds}),
      reportRunnerInstances: () => Promise.resolve({accepted: 0, reservations_released: 0}),
      reconcileRunnerInstances: () =>
        Promise.resolve({runners: [], terminated_absent_provider_runner_ids: []}),
    },
  };
}

function reservation(count: number) {
  return {
    reservation_id: '00000000-0000-4000-8000-000000000001',
    labels: ['ubuntu22'],
    count,
    expires_at: EXPIRES_AT,
  };
}

function createTestMutex() {
  let previous = Promise.resolve();
  return async <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const predecessor = previous;
    let release!: () => void;
    previous = new Promise<void>((resolve) => {
      release = resolve;
    });
    await predecessor;
    try {
      return await operation();
    } finally {
      release();
    }
  };
}
