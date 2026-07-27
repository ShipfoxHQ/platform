import type {
  CreateRunnerInstancesBodyDto,
  PollDemandBodyDto,
  PollDemandResponseDto,
} from '@shipfox/api-runners-dto';
import type {ProvisionerClient} from '#api-client.js';
import {runProvisionerIteration, startProvisioner} from '#provisioner.js';
import {createInMemoryTracker} from '#tracker.js';
import type {ProvisionerAdapter, ProvisionerTemplate} from '#types.js';

const EXPIRES_AT = '2026-01-01T00:00:00.000Z';

const template: ProvisionerTemplate<null> = {
  key: 'small',
  labels: ['ubuntu22'],
  maxConcurrency: 5,
  cost: 1,
  spec: null,
};

describe('runProvisionerIteration', () => {
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
      degraded: false,
    });

    expect(events).toEqual(['observe', 'poll']);
  });

  it('advertises no free capacity and backs off when onTick fails', async () => {
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
      degraded: false,
    });

    expect(pollBodies[0]?.max_reservations).toBe(0);
    expect(result).toEqual({nextInterval: 1500, degraded: true});
  });

  it('keeps advertising no capacity while startup is degraded and observe still fails', async () => {
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
      degraded: true,
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

    const result = await runProvisionerIteration({
      adapter,
      client,
      templates: [template],
      tracker: createInMemoryTracker(),
      currentInterval: 1000,
      degraded: true,
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
      degraded: false,
    });

    expect(result).toEqual({nextInterval: 1500, degraded: false});
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
      degraded: true,
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
