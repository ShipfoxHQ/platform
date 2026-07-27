import type {
  CreateRunnerInstancesBodyDto,
  PollDemandBodyDto,
  PollDemandResponseDto,
} from '@shipfox/api-runners-dto';
import type {ProvisionerClient} from '#api-client.js';
import {createHealthState} from '#health.js';
import {runProvisionerIteration, startProvisioner} from '#provisioner.js';
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

describe('startProvisioner', () => {
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

function harness(options: {response: PollDemandResponseFixture; onPoll?: () => void}): {
  client: ProvisionerClient;
  pollBodies: PollDemandBodyDto[];
  createBodies: CreateRunnerInstancesBodyDto[];
} {
  const pollBodies: PollDemandBodyDto[] = [];
  const createBodies: CreateRunnerInstancesBodyDto[] = [];

  return {
    pollBodies,
    createBodies,
    client: {
      getIdentity: () =>
        Promise.resolve({id: 'provisioner', scope: 'workspace', workspace_id: 'workspace'}),
      pollDemand: (body) => {
        options.onPoll?.();
        pollBodies.push(body);
        return Promise.resolve({
          ...options.response,
          terminate_provider_runner_ids: options.response.terminate_provider_runner_ids ?? [],
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
