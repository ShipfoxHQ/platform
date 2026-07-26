import type {
  ReconcileRunnerInstancesBodyDto,
  ReconcileRunnerInstancesResponseDto,
  ReportRunnerInstancesBodyDto,
  ReportRunnerInstancesResponseDto,
} from '@shipfox/api-runners-dto';
import type {
  ProviderRunnerLaunch,
  ProviderRunnerTracker,
  ProvisionerClient,
  ProvisionerTemplate,
} from '@shipfox/provisioner-core';
import {ProvisionerAuthenticationError} from '@shipfox/provisioner-core';
import {type DockerContainerView, type DockerEngine, DockerEngineError} from '#docker-engine.js';
import {createDockerLifecycle} from '#lifecycle.js';
import type {DockerTemplateSpec} from '#templates.js';

const observability = vi.hoisted(() => ({
  logger: {error: vi.fn(), info: vi.fn(), warn: vi.fn()},
}));

vi.mock('@shipfox/node-opentelemetry', () => ({logger: () => observability.logger}));

const NOW = new Date('2026-01-01T00:10:00.000Z');
const RESERVATION_ID = '00000000-0000-4000-8000-000000000003';

const template: ProvisionerTemplate<DockerTemplateSpec> = {
  key: 'small',
  labels: ['ubuntu22'],
  maxConcurrency: 10,
  cost: 1,
  spec: {image: 'runner:latest', cpu: 1.5, memory: '2g'},
};

describe('createDockerLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('launch reports starting and creates a labeled container with resources and env', async () => {
    const engine = fakeEngine();
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.launch(launch());

    expect(client.reportBodies[0]?.events[0]).toMatchObject({
      provider_runner_id: 'runner-1',
      template_key: 'small',
      labels: ['ubuntu22'],
      state: 'starting',
      provider_kind: 'docker',
    });
    expect(engine.created[0]).toMatchObject({
      name: 'runner-1',
      image: 'runner:latest',
      env: {
        SHIPFOX_RUNNER_BOOTSTRAP_TOKEN: 'sf_rbt_secret',
        SHIPFOX_RUNNER_PROVIDER_KIND: 'docker',
      },
      nanoCpus: 1_500_000_000,
      memoryBytes: 2 * 1024 ** 3,
    });
    expect(engine.created[0]?.labels['shipfox.provider_runner_id']).toBe('runner-1');
  });

  it('reports failed and rethrows when the engine fails to launch', async () => {
    const engine = fakeEngine({
      createError: new DockerEngineError('start-failed', 'cannot start'),
    });
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client});

    await expect(lifecycle.launch(launch())).rejects.toThrow(DockerEngineError);

    expect(client.reportBodies.map((body) => body.events[0]?.state)).toEqual(['failed']);
    expect(client.reportBodies[0]?.events[0]?.reason).toBe('start-failed');
  });

  it('assigns an enrolled observed runner through its container identity', async () => {
    const engine = fakeEngine({
      containers: [
        container({
          state: 'running',
          labels: {
            'shipfox.runner_instance_id': '00000000-0000-4000-8000-000000000004',
            'shipfox.provider_runner_id': 'runner-1',
            'shipfox.provisioner_id': '00000000-0000-4000-8000-000000000001',
            'shipfox.reservation_id': RESERVATION_ID,
            'shipfox.template_key': 'small',
            'shipfox.labels': 'ubuntu22',
          },
        }),
      ],
    });
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.observe();

    expect(client.assignmentBodies).toEqual([
      {reservationId: RESERVATION_ID, runnerInstanceIds: ['00000000-0000-4000-8000-000000000004']},
    ]);
  });

  it('observe re-reports running containers every tick', async () => {
    const engine = fakeEngine({
      containers: [container({state: 'running'})],
    });
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.observe();
    await lifecycle.observe();

    expect(client.reportBodies.flatMap((body) => body.events.map((event) => event.state))).toEqual([
      'running',
      'running',
    ]);
  });

  it('reports terminal exited containers and removes them only after report succeeds', async () => {
    const engine = fakeEngine({
      containers: [container({state: 'exited', exitCode: 0})],
    });
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.observe();

    expect(client.reportBodies[0]?.events[0]?.state).toBe('stopped');
    expect(engine.removed).toEqual(['runner-1']);
    expect(observability.logger.error).not.toHaveBeenCalled();
  });

  it('logs an unsuccessful container exit before removing it', async () => {
    const engine = fakeEngine({
      containers: [container({state: 'exited', exitCode: 1})],
    });
    const lifecycle = makeLifecycle({engine});

    await lifecycle.observe();

    expect(observability.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        providerRunnerId: 'runner-1',
        containerId: 'runner-1',
        containerName: 'runner-1',
        exitCode: 1,
        oomKilled: false,
        reason: 'exit-code-1',
      }),
      'Provisioned runner container exited unsuccessfully',
    );
    expect(engine.removed).toEqual(['runner-1']);
  });

  it('buffers terminal reports and still removes containers when reporting transiently fails', async () => {
    const engine = fakeEngine({
      containers: [container({state: 'exited', exitCode: 1})],
    });
    const client = fakeClient({reportErrors: [new Error('api down')]});
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.observe();

    expect(engine.removed).toEqual(['runner-1']);

    await lifecycle.observe();

    expect(client.reportBodies[1]?.events[0]).toMatchObject({
      provider_runner_id: 'runner-1',
      state: 'failed',
    });
  });

  it('buffers non-400 report errors and still removes terminal containers', async () => {
    const engine = fakeEngine({
      containers: [container({state: 'exited', exitCode: 1})],
    });
    const client = fakeClient({reportErrors: [httpError(409)]});
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.observe();

    expect(engine.removed).toEqual(['runner-1']);

    await lifecycle.flush();

    expect(client.reportBodies[1]?.events[0]).toMatchObject({
      provider_runner_id: 'runner-1',
      state: 'failed',
    });
  });

  it('does not report terminal state when Docker remove fails', async () => {
    const error = new DockerEngineError('unknown', 'remove failed');
    const engine = fakeEngine({
      containers: [container({state: 'exited', exitCode: 0})],
      removeError: error,
    });
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client});

    await expect(lifecycle.observe()).rejects.toThrow(error);

    expect(engine.removed).toEqual(['runner-1']);
    expect(client.reportBodies).toEqual([]);
  });

  it('buffers stale-created terminal reports and still kills containers when reporting transiently fails', async () => {
    const engine = fakeEngine({
      containers: [
        container({
          state: 'created',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ],
    });
    const client = fakeClient({reportErrors: [new Error('api down')]});
    const lifecycle = makeLifecycle({engine, client, registrationDeadlineMs: 60_000});

    await lifecycle.observe();

    expect(engine.killedAndRemoved).toEqual(['runner-1']);
  });

  it('marks OOM exits as failed with an oom reason', async () => {
    const engine = fakeEngine({
      containers: [container({state: 'exited', exitCode: 137, oomKilled: true})],
    });
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.observe();

    expect(client.reportBodies[0]?.events[0]).toMatchObject({state: 'failed', reason: 'oom'});
  });

  it('reaps only created containers past the registration deadline', async () => {
    const engine = fakeEngine({
      containers: [
        container({
          name: 'created-old',
          state: 'created',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
        container({
          name: 'running-old',
          state: 'running',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ],
    });
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client, registrationDeadlineMs: 60_000});

    await lifecycle.observe();

    expect(engine.killedAndRemoved).toEqual(['created-old']);
    expect(engine.removed).toEqual([]);
    expect(client.reportBodies.flatMap((body) => body.events.map((event) => event.state))).toEqual([
      'running',
      'terminated',
    ]);
  });

  it('reconcile rebuilds tracker counts from listed containers', async () => {
    const engine = fakeEngine({
      containers: [
        container({name: 'starting-1', state: 'created'}),
        container({name: 'running-1', state: 'running'}),
      ],
    });
    const tracker = testTracker();
    const lifecycle = makeLifecycle({engine, tracker});

    await lifecycle.reconcile();

    expect(tracker.countsByTemplate()).toEqual(new Map([['small', {starting: 1, running: 1}]]));
  });

  it('reconcile submits deduped observed ids, including the empty set', async () => {
    const client = fakeClient();
    const lifecycle = makeLifecycle({client});

    await lifecycle.reconcile();

    expect(client.reconcileBodies).toEqual([{observed_provider_runner_ids: []}]);
  });

  it('tick retries backend reconcile until the first success, then observes locally', async () => {
    const engine = fakeEngine({
      containers: [container({state: 'running'})],
    });
    const client = fakeClient({
      reconcileErrors: [new Error('api down')],
      reconcileResponse: {
        runners: [reconciledRunner('runner-1', 'keep')],
        terminated_absent_provider_runner_ids: [],
      },
    });
    const lifecycle = makeLifecycle({engine, client});

    await expect(lifecycle.tick()).rejects.toThrow('api down');
    expect(client.reconcileBodies).toHaveLength(1);
    expect(client.reportBodies).toHaveLength(0);

    await lifecycle.tick();
    await lifecycle.tick();

    expect(client.reconcileBodies).toHaveLength(2);
    expect(client.reportBodies.map((body) => body.events[0]?.state)).toEqual([
      'running',
      'running',
    ]);
  });

  it('reconcile tears down backend terminate-intent containers', async () => {
    const engine = fakeEngine({
      containers: [container({state: 'running'})],
    });
    const client = fakeClient({
      reconcileResponse: {
        runners: [reconciledRunner('runner-1', 'terminate')],
        terminated_absent_provider_runner_ids: [],
      },
    });
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.reconcile();

    expect(client.reconcileBodies[0]).toEqual({observed_provider_runner_ids: ['runner-1']});
    expect(client.reportBodies[0]?.events[0]).toMatchObject({
      provider_runner_id: 'runner-1',
      state: 'terminated',
      reason: 'backend-terminate',
    });
    expect(engine.killedAndRemoved).toEqual(['runner-1']);
  });

  it('does not report backend terminate state when Docker kill fails', async () => {
    const error = new DockerEngineError('unknown', 'kill failed');
    const engine = fakeEngine({
      containers: [container({state: 'running'})],
      killAndRemoveError: error,
    });
    const client = fakeClient({
      reconcileResponse: {
        runners: [reconciledRunner('runner-1', 'terminate')],
        terminated_absent_provider_runner_ids: [],
      },
    });
    const lifecycle = makeLifecycle({engine, client});

    await expect(lifecycle.reconcile()).rejects.toThrow(error);

    expect(engine.killedAndRemoved).toEqual(['runner-1']);
    expect(client.reportBodies).toEqual([]);
  });

  it('reconcile adopts backend keep-intent live containers', async () => {
    const engine = fakeEngine({
      containers: [container({state: 'running'})],
    });
    const tracker = testTracker();
    const client = fakeClient({
      reconcileResponse: {
        runners: [reconciledRunner('runner-1', 'keep')],
        terminated_absent_provider_runner_ids: [],
      },
    });
    const lifecycle = makeLifecycle({engine, client, tracker});

    await lifecycle.reconcile();

    expect(client.reportBodies[0]?.events[0]).toMatchObject({
      provider_runner_id: 'runner-1',
      state: 'running',
    });
    expect(tracker.countsByTemplate()).toEqual(new Map([['small', {starting: 0, running: 1}]]));
  });

  it('reconcile keeps local terminal handling for backend keep-intent exited containers', async () => {
    const engine = fakeEngine({
      containers: [container({state: 'exited', exitCode: 0})],
    });
    const client = fakeClient({
      reconcileResponse: {
        runners: [reconciledRunner('runner-1', 'keep')],
        terminated_absent_provider_runner_ids: [],
      },
    });
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.reconcile();

    expect(client.reportBodies[0]?.events[0]).toMatchObject({state: 'stopped'});
    expect(engine.removed).toEqual(['runner-1']);
  });

  it('reconcile falls back to local observe when the observed id count exceeds the API limit', async () => {
    const engine = fakeEngine({
      containers: Array.from({length: 5001}, (_, index) =>
        container({name: `runner-${index}`, state: 'running'}),
      ),
    });
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.reconcile();

    expect(client.reconcileBodies).toEqual([]);
    expect(client.reportBodies.map((body) => body.events.length)).toEqual([
      1000, 1000, 1000, 1000, 1000, 1,
    ]);
  });

  it('tick retries backend reconcile after an oversized observed set later fits the API limit', async () => {
    const containers = Array.from({length: 5001}, (_, index) =>
      container({name: `runner-${index}`, state: 'running'}),
    );
    const engine = fakeEngine({containers});
    const client = fakeClient({
      reconcileResponse: {
        runners: [reconciledRunner('runner-1', 'keep')],
        terminated_absent_provider_runner_ids: [],
      },
    });
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.tick();
    containers.splice(1);
    await lifecycle.tick();
    await lifecycle.tick();

    expect(client.reconcileBodies).toEqual([{observed_provider_runner_ids: ['runner-0']}]);
  });

  it('terminate kills and reports matching managed containers', async () => {
    const engine = fakeEngine({
      containers: [container({state: 'running'}), container({name: 'runner-2', state: 'running'})],
    });
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.terminate(['runner-1']);

    expect(client.reportBodies[0]?.events[0]).toMatchObject({
      provider_runner_id: 'runner-1',
      state: 'terminated',
      reason: 'backend-terminate',
    });
    expect(engine.killedAndRemoved).toEqual(['runner-1']);
  });

  it('terminate is a true no-op when no managed container matches the id', async () => {
    const engine = fakeEngine({
      containers: [container({name: 'runner-2', state: 'running'})],
    });
    const lifecycle = makeLifecycle({engine});

    await lifecycle.terminate(['runner-1']);

    expect(engine.killedAndRemoved).toEqual([]);
    expect(engine.removed).toEqual([]);
  });

  it('terminate still kills matching containers when labels are unresolvable', async () => {
    const engine = fakeEngine({
      containers: [
        container({state: 'running', labels: {'shipfox.provider_runner_id': 'runner-1'}}),
      ],
    });
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.terminate(['runner-1']);

    expect(client.reportBodies).toEqual([]);
    expect(engine.killedAndRemoved).toEqual(['runner-1']);
  });

  it('terminate does not list Docker for an empty id set', async () => {
    const engine = fakeEngine();
    const lifecycle = makeLifecycle({engine});

    await lifecycle.terminate([]);

    expect(engine.listManagedCalls).toBe(0);
  });

  it('terminate propagates Docker list failures', async () => {
    const lifecycle = makeLifecycle({
      engine: fakeEngine({listError: new DockerEngineError('unknown', 'daemon down')}),
    });

    await expect(lifecycle.terminate(['runner-1'])).rejects.toThrow(DockerEngineError);
  });

  it('chunks report batches at 1000 events', async () => {
    const engine = fakeEngine({
      containers: Array.from({length: 1001}, (_, index) =>
        container({name: `runner-${index}`, state: 'running'}),
      ),
    });
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.observe();

    expect(client.reportBodies.map((body) => body.events.length)).toEqual([1000, 1]);
  });

  it('drops permanent 400 report batches instead of retrying them forever', async () => {
    const engine = fakeEngine({
      containers: [container({state: 'exited', exitCode: 1})],
    });
    const client = fakeClient({reportErrors: [httpError(400)]});
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.observe();
    await lifecycle.flush();

    expect(engine.removed).toEqual(['runner-1']);
    expect(client.reportBodies).toHaveLength(1);
  });

  it('propagates auth failures from report delivery after local cleanup', async () => {
    const engine = fakeEngine({
      containers: [container({state: 'exited', exitCode: 1})],
    });
    const lifecycle = makeLifecycle({
      engine,
      client: fakeClient({reportErrors: [new ProvisionerAuthenticationError(401)]}),
    });

    await expect(lifecycle.observe()).rejects.toThrow(ProvisionerAuthenticationError);
    expect(engine.removed).toEqual(['runner-1']);
  });

  it('preserves terminal reports over live reports when the retry queue overflows', async () => {
    const engine = fakeEngine({
      containers: [
        ...Array.from({length: 5001}, (_, index) =>
          container({name: `runner-${index}`, state: 'running'}),
        ),
        container({name: 'terminal-runner', state: 'exited', exitCode: 0}),
      ],
    });
    const client = fakeClient({reportErrors: [new Error('api down'), new Error('api down')]});
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.observe();
    await lifecycle.flush();

    expect(
      client.reportBodies
        .slice(2)
        .flatMap((body) => body.events)
        .some(
          (event) => event.provider_runner_id === 'terminal-runner' && event.state === 'stopped',
        ),
    ).toBe(true);
  });

  it('flush drains buffered reports', async () => {
    const engine = fakeEngine({
      containers: [container({state: 'exited', exitCode: 1})],
    });
    const client = fakeClient({reportErrors: [new Error('api down')]});
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.observe();
    await lifecycle.flush();

    expect(client.reportBodies[1]?.events[0]).toMatchObject({
      provider_runner_id: 'runner-1',
      state: 'failed',
    });
  });

  it('does not block container creation when the launch starting report is buffered', async () => {
    const engine = fakeEngine();
    const client = fakeClient({reportErrors: [new Error('api down')]});
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.launch(launch());

    expect(engine.created).toHaveLength(1);

    await lifecycle.flush();

    expect(client.reportBodies[1]?.events[0]).toMatchObject({
      provider_runner_id: 'runner-1',
      state: 'starting',
    });
  });

  it('does not block container creation when the launch starting report gets a non-400 error', async () => {
    const engine = fakeEngine();
    const client = fakeClient({reportErrors: [httpError(429)]});
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.launch(launch());

    expect(engine.created).toHaveLength(1);

    await lifecycle.flush();

    expect(client.reportBodies[1]?.events[0]).toMatchObject({
      provider_runner_id: 'runner-1',
      state: 'starting',
    });
  });
});

function makeLifecycle(
  args: {
    engine?: ReturnType<typeof fakeEngine>;
    client?: ReturnType<typeof fakeClient>;
    tracker?: ProviderRunnerTracker;
    registrationDeadlineMs?: number;
  } = {},
) {
  return createDockerLifecycle({
    engine: args.engine ?? fakeEngine(),
    client: args.client ?? fakeClient(),
    identity: {
      id: '00000000-0000-4000-8000-000000000001',
      workspaceId: '00000000-0000-4000-8000-000000000002',
    },
    tracker: args.tracker ?? testTracker(),
    templates: [template],
    now: () => NOW,
    registrationDeadlineMs: args.registrationDeadlineMs ?? 120_000,
    providerKind: 'docker',
  });
}

function launch(): ProviderRunnerLaunch<DockerTemplateSpec> {
  return {
    runnerInstanceId: '00000000-0000-4000-8000-000000000004',
    providerRunnerId: 'runner-1',
    reservationId: RESERVATION_ID,
    bootstrapToken: 'sf_rbt_secret',
    runnerEnv: {SHIPFOX_RUNNER_BOOTSTRAP_TOKEN: 'sf_rbt_secret'},
    template,
  };
}

function fakeClient(
  options: {
    reportErrors?: Error[];
    reconcileErrors?: Error[];
    reconcileResponse?: ReconcileRunnerInstancesResponseDto;
  } = {},
): ProvisionerClient & {
  reportBodies: ReportRunnerInstancesBodyDto[];
  reconcileBodies: ReconcileRunnerInstancesBodyDto[];
  assignmentBodies: Array<{reservationId: string; runnerInstanceIds: string[]}>;
} {
  const reportBodies: ReportRunnerInstancesBodyDto[] = [];
  const reconcileBodies: ReconcileRunnerInstancesBodyDto[] = [];
  const assignmentBodies: Array<{reservationId: string; runnerInstanceIds: string[]}> = [];
  const reportErrors = [...(options.reportErrors ?? [])];
  const reconcileErrors = [...(options.reconcileErrors ?? [])];
  return {
    reportBodies,
    reconcileBodies,
    assignmentBodies,
    getIdentity: () =>
      Promise.resolve({
        id: '00000000-0000-4000-8000-000000000001',
        scope: 'workspace',
        workspace_id: '00000000-0000-4000-8000-000000000002',
      }),
    pollDemand: () =>
      Promise.resolve({stats: [], reservations: [], terminate_provider_runner_ids: []}),
    createRunnerInstances: () => Promise.resolve({runner_instances: []}),
    attachRunnerInstanceProviderId: () => Promise.resolve({attached: true}),
    assignRunnerInstances: (reservationId, runnerInstanceIds) => {
      assignmentBodies.push({reservationId, runnerInstanceIds});
      return Promise.resolve({runner_instance_ids: runnerInstanceIds});
    },
    reportRunnerInstances: (body): Promise<ReportRunnerInstancesResponseDto> => {
      reportBodies.push(body);
      const error = reportErrors.shift();
      if (error) return Promise.reject(error);
      return Promise.resolve({accepted: body.events.length, reservations_released: 0});
    },
    reconcileRunnerInstances: (body): Promise<ReconcileRunnerInstancesResponseDto> => {
      reconcileBodies.push(body);
      const error = reconcileErrors.shift();
      if (error) return Promise.reject(error);
      return Promise.resolve(
        options.reconcileResponse ?? {
          runners: [],
          terminated_absent_provider_runner_ids: [],
        },
      );
    },
  };
}

function fakeEngine(
  options: {
    containers?: DockerContainerView[];
    createError?: Error;
    listError?: Error;
    removeError?: Error;
    killAndRemoveError?: Error;
  } = {},
): DockerEngine & {
  created: Parameters<DockerEngine['createAndStart']>[0][];
  removed: string[];
  killedAndRemoved: string[];
  listManagedCalls: number;
} {
  const created: Parameters<DockerEngine['createAndStart']>[0][] = [];
  const removed: string[] = [];
  const killedAndRemoved: string[] = [];
  let listManagedCalls = 0;

  return {
    created,
    removed,
    killedAndRemoved,
    get listManagedCalls() {
      return listManagedCalls;
    },
    ensureImage: () => Promise.resolve(),
    createAndStart: (args) => {
      if (options.createError) return Promise.reject(options.createError);
      created.push(args);
      return Promise.resolve();
    },
    listManaged: () => {
      listManagedCalls += 1;
      if (options.listError) return Promise.reject(options.listError);
      return Promise.resolve(options.containers ?? []);
    },
    remove: (name) => {
      removed.push(name);
      if (options.removeError) return Promise.reject(options.removeError);
      return Promise.resolve();
    },
    killAndRemove: (name) => {
      killedAndRemoved.push(name);
      if (options.killAndRemoveError) return Promise.reject(options.killAndRemoveError);
      return Promise.resolve();
    },
  };
}

function testTracker(): ProviderRunnerTracker {
  const runners = new Map<string, {templateKey: string; state: 'starting' | 'running'}>();
  return {
    recordStarting: ({providerRunnerId, templateKey}) => {
      runners.set(providerRunnerId, {templateKey, state: 'starting'});
    },
    markRunning: (providerRunnerId) => {
      const runner = runners.get(providerRunnerId);
      if (runner) runner.state = 'running';
    },
    remove: (providerRunnerId) => {
      runners.delete(providerRunnerId);
    },
    replaceAll: (nextRunners) => {
      runners.clear();
      for (const runner of nextRunners) {
        runners.set(runner.providerRunnerId, {
          templateKey: runner.templateKey,
          state: runner.state,
        });
      }
    },
    countsByTemplate: () => {
      const counts = new Map<string, {starting: number; running: number}>();
      for (const runner of runners.values()) {
        const current = counts.get(runner.templateKey) ?? {starting: 0, running: 0};
        current[runner.state] += 1;
        counts.set(runner.templateKey, current);
      }
      return counts;
    },
  };
}

function container(args: {
  name?: string;
  state: DockerContainerView['state'];
  exitCode?: number;
  oomKilled?: boolean;
  createdAt?: Date;
  labels?: Readonly<Record<string, string>>;
}): DockerContainerView {
  const name = args.name ?? 'runner-1';
  return {
    id: name,
    name,
    labels: args.labels ?? {
      'shipfox.provider_runner_id': name,
      'shipfox.provisioner_id': '00000000-0000-4000-8000-000000000001',
      'shipfox.reservation_id': RESERVATION_ID,
      'shipfox.template_key': 'small',
      'shipfox.workspace_id': '00000000-0000-4000-8000-000000000002',
      'shipfox.labels': 'ubuntu22',
    },
    state: args.state,
    ...(args.exitCode !== undefined ? {exitCode: args.exitCode} : {}),
    ...(args.oomKilled !== undefined ? {oomKilled: args.oomKilled} : {}),
    createdAt: args.createdAt ?? NOW,
  };
}

function reconciledRunner(
  providerRunnerId: string,
  desiredIntent: 'keep' | 'terminate',
): ReconcileRunnerInstancesResponseDto['runners'][number] {
  return {
    provider_runner_id: providerRunnerId,
    state: 'running',
    reservation_id: RESERVATION_ID,
    runner_session_id: null,
    bound_job: null,
    desired_intent: desiredIntent,
  };
}

function httpError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), {response: {status}});
}
