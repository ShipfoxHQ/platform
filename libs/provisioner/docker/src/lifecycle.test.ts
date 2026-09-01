import type {
  ReconcileRunnerInstancesBodyDto,
  ReconcileRunnerInstancesResponseDto,
  ReportRunnerInstancesBodyDto,
  ReportRunnerInstancesResponseDto,
} from '@shipfox/api-runners-dto';
import {MAX_TERMINATION_CANDIDATES} from '@shipfox/api-runners-dto';
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
  logger: {debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn()},
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

  it('does not report a started container as failed when starting-report delivery fails', async () => {
    const error = new ProvisionerAuthenticationError(401, 'report runner instances');
    const engine = fakeEngine();
    const client = fakeClient({reportErrors: [error]});
    const lifecycle = makeLifecycle({engine, client});

    await expect(lifecycle.launch(launch())).rejects.toThrow(error);

    expect(engine.created).toHaveLength(1);
    expect(client.reportBodies.flatMap((body) => body.events.map((event) => event.state))).toEqual([
      'starting',
    ]);
    expect(observability.logger.error).not.toHaveBeenCalledWith(
      expect.objectContaining({event: 'runner.container_launch_failed'}),
      expect.any(String),
    );
  });

  it('marks a buffered starting report as incomplete', async () => {
    const engine = fakeEngine();
    const client = fakeClient({reportErrors: [new Error('api unavailable')]});
    const lifecycle = makeLifecycle({engine, client});
    const outcome = await lifecycle.launch(launch());
    expect(outcome).toEqual({containerStarted: true, identityAttached: true, reported: false});
    expect(engine.created).toHaveLength(1);
    expect(client.reportBodies[0]?.events[0]).toMatchObject({state: 'starting'});
  });
  it('reports a failed launch when identity attachment fails before start', async () => {
    const error = new Error('identity API unavailable');
    const events: string[] = [];
    const engine = fakeEngine({events});
    const client = fakeClient({attachErrors: [error]});
    const lifecycle = makeLifecycle({engine, client});

    await expect(lifecycle.launch(launch())).rejects.toThrow(error);

    expect(engine.created).toHaveLength(1);
    expect(events).not.toContain('start');
    expect(client.reportBodies.map((body) => body.events[0]?.state)).toEqual(['failed']);
    expect(observability.logger.error).not.toHaveBeenCalledWith(
      expect.objectContaining({event: 'runner.container_launch_failed'}),
      expect.any(String),
    );
  });

  it('attaches the provider identity before starting the container', async () => {
    const events: string[] = [];
    const engine = fakeEngine({events});
    const client = fakeClient({events});
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.launch(launch());

    expect(events).toEqual(['create', 'attach', 'start']);
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

  it('reports a failure again after the retained container disappears and is recreated', async () => {
    const containers = [container({state: 'exited', exitCode: 1})];
    const engine = fakeEngine({containers});
    const client = fakeClient();
    const lifecycle = makeLifecycle({
      engine,
      client,
      failedContainerRetentionMs: 3_600_000,
      maxRetainedFailedContainers: 20,
    });

    await lifecycle.observe();
    containers.splice(0, 1);
    await lifecycle.observe();
    containers.push(container({state: 'exited', exitCode: 1}));
    await lifecycle.observe();

    expect(
      observability.logger.error.mock.calls.filter(
        ([fields]) => fields?.event === 'runner.container_failed',
      ),
    ).toHaveLength(2);
  });

  it('resets retained failure state when a container becomes live again', async () => {
    const containers = [container({state: 'exited', exitCode: 1})];
    const engine = fakeEngine({containers});
    const client = fakeClient();
    const lifecycle = makeLifecycle({
      engine,
      client,
      failedContainerRetentionMs: 3_600_000,
      maxRetainedFailedContainers: 20,
    });

    await lifecycle.observe();
    containers[0] = container({state: 'running'});
    await lifecycle.observe();
    containers[0] = container({state: 'exited', exitCode: 1});
    await lifecycle.observe();

    expect(
      observability.logger.error.mock.calls.filter(
        ([fields]) => fields?.event === 'runner.container_failed',
      ),
    ).toHaveLength(2);
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
        event: 'runner.container_failed',
        providerRunnerId: 'runner-1',
        containerId: 'runner-1',
        containerName: 'runner-1',
        exitCode: 1,
        oomKilled: false,
        reason: 'exit-code-1',
      }),
      'Runner container failed',
    );
    expect(engine.removed).toEqual(['runner-1']);
  });

  it('uses first-observed time instead of creation time for unknown runtime', async () => {
    const engine = fakeEngine({
      containers: [
        container({
          state: 'exited',
          exitCode: 1,
          createdAt: new Date('2025-01-01T00:00:00.000Z'),
          startedAt: new Date('2026-01-01T00:09:00.000Z'),
        }),
      ],
    });
    const lifecycle = makeLifecycle({engine});

    await lifecycle.observe();

    expect(observability.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({event: 'runner.container_failed', runtimeMs: 60_000}),
      'Runner container failed',
    );
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

  it('keeps stale-created containers when lifecycle report delivery is unavailable', async () => {
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

    expect(engine.killedAndRemoved).toEqual([]);
    expect(client.reconcileBodies[0]).toEqual({
      observed_provider_runner_ids: ['runner-1'],
      termination_candidates: [{provider_runner_id: 'runner-1', reason: 'registration-deadline'}],
    });
  });

  it('keeps stale-created containers when backend reconciliation is unavailable', async () => {
    const error = new Error('api unavailable');
    let currentTime = NOW;
    const containers = [
      container({
        state: 'created',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      container({name: 'running-1', state: 'running'}),
    ];
    const engine = fakeEngine({
      containers,
    });
    const client = fakeClient({reconcileErrors: [error, error]});
    const lifecycle = makeLifecycle({
      engine,
      client,
      now: () => currentTime,
      registrationDeadlineMs: 60_000,
    });

    await expect(lifecycle.observe()).rejects.toThrow(error);
    currentTime = new Date(NOW.getTime() + 1_000);
    await expect(lifecycle.observe()).rejects.toThrow(error);

    expect(engine.killedAndRemoved).toEqual([]);
    expect(engine.removed).toEqual([]);
    expect(client.reconcileBodies).toHaveLength(2);
    expect(client.reportBodies.flatMap((body) => body.events.map((event) => event.state))).toEqual([
      'starting',
      'running',
      'starting',
      'running',
    ]);
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

  it('retains failed containers, releases capacity, and suppresses duplicate failure reports', async () => {
    const engine = fakeEngine({containers: [container({state: 'exited', exitCode: 1})]});
    const tracker = testTracker();
    tracker.recordStarting({providerRunnerId: 'runner-1', templateKey: 'small'});
    const client = fakeClient();
    const lifecycle = makeLifecycle({
      engine,
      client,
      tracker,
      failedContainerRetentionMs: 3_600_000,
      maxRetainedFailedContainers: 20,
    });

    await lifecycle.observe();
    await lifecycle.observe();

    expect(engine.removed).toEqual([]);
    expect(tracker.countsByTemplate()).toEqual(new Map());
    expect(client.reportBodies.flatMap((body) => body.events)).toHaveLength(1);
    expect(observability.logger.error).toHaveBeenCalledTimes(1);
    expect(observability.logger.info).not.toHaveBeenCalledWith(
      expect.objectContaining({event: 'runner.cleanup_pass_completed'}),
      expect.any(String),
    );
  });

  it('removes expired retained failures using FinishedAt', async () => {
    const engine = fakeEngine({
      containers: [
        container({
          state: 'exited',
          exitCode: 1,
          finishedAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ],
    });
    const lifecycle = makeLifecycle({
      engine,
      failedContainerRetentionMs: 60_000,
      maxRetainedFailedContainers: 20,
    });

    await lifecycle.observe();

    expect(engine.removed).toEqual(['runner-1']);
    expect(observability.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'runner.cleanup_pass_completed',
        expired: 1,
      }),
      'Failed runner container cleanup pass completed',
    );
  });

  it('reports an expired failure before removing its container', async () => {
    const operations: string[] = [];
    const engine = fakeEngine({
      containers: [
        container({
          state: 'exited',
          exitCode: 1,
          finishedAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ],
      onRemove: () => operations.push('remove'),
    });
    const client = fakeClient({onReport: () => operations.push('report')});
    const lifecycle = makeLifecycle({
      engine,
      client,
      failedContainerRetentionMs: 60_000,
      maxRetainedFailedContainers: 20,
    });
    await lifecycle.observe();
    expect(operations).toEqual(['report', 'remove']);
  });
  it('evicts the oldest retained failures when the count limit is exceeded', async () => {
    const engine = fakeEngine({
      containers: [
        container({
          name: 'oldest',
          state: 'exited',
          exitCode: 1,
          finishedAt: new Date('2026-01-01T00:00:01.000Z'),
        }),
        container({
          name: 'newer',
          state: 'exited',
          exitCode: 1,
          finishedAt: new Date('2026-01-01T00:00:02.000Z'),
        }),
      ],
    });
    const lifecycle = makeLifecycle({
      engine,
      failedContainerRetentionMs: 3_600_000,
      maxRetainedFailedContainers: 1,
    });

    await lifecycle.observe();

    expect(engine.removed).toEqual(['oldest']);
  });

  it('uses first-observed failure time when FinishedAt is missing', async () => {
    const engine = fakeEngine({
      containers: [
        container({
          state: 'exited',
          exitCode: 1,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ],
    });
    const lifecycle = makeLifecycle({
      engine,
      failedContainerRetentionMs: 60_000,
      maxRetainedFailedContainers: 20,
    });

    await lifecycle.observe();

    expect(engine.removed).toEqual([]);
  });
  it('defers retention cleanup when terminal inspection is unavailable', async () => {
    const engine = fakeEngine({
      containers: [
        container({
          state: 'exited',
          exitCode: 1,
          createdAt: new Date('2025-01-01T00:00:00.000Z'),
          terminalInspectFailed: true,
        }),
      ],
    });
    const lifecycle = makeLifecycle({
      engine,
      failedContainerRetentionMs: 60_000,
      maxRetainedFailedContainers: 20,
    });
    await lifecycle.observe();
    expect(engine.removed).toEqual([]);
    expect(observability.logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'runner.container_failure_timestamp_fallback',
        fallback: 'firstObservedAt',
      }),
      'Failure timestamp unavailable; TTL cleanup is deferred but count-bounded cleanup still applies',
    );
  });

  it('uses a driver-aware forensic log hint', async () => {
    for (const driver of ['local', 'journald', 'none']) {
      vi.clearAllMocks();
      const lifecycle = makeLifecycle({
        engine: fakeEngine({
          containers: [container({state: 'exited', exitCode: 1, loggingDriver: driver})],
        }),
      });

      await lifecycle.observe();

      const failureLog = observability.logger.error.mock.calls.find(
        ([fields]) => fields?.event === 'runner.container_failed',
      )?.[0];
      expect(failureLog).toBeDefined();
      if (driver === 'local') {
        expect(failureLog).toEqual(
          expect.objectContaining({
            dockerLogsCommand:
              'docker --host "$SHIPFOX_PROVISIONER_DOCKER_HOST" logs --timestamps --tail 200 runner-1',
            dockerLogsHostHint:
              'Target the daemon configured by SHIPFOX_PROVISIONER_DOCKER_HOST; omit --host when using the local default',
          }),
        );
      } else if (driver === 'journald') {
        expect(failureLog).toEqual(
          expect.objectContaining({
            journaldCommand: 'journalctl CONTAINER_NAME=runner-1',
            journaldHostHint:
              'Run journalctl on the Docker daemon host configured by SHIPFOX_PROVISIONER_DOCKER_HOST',
          }),
        );
        expect(failureLog).not.toHaveProperty('dockerLogsCommand');
      } else {
        expect(failureLog).toEqual(
          expect.objectContaining({
            loggingBackendHint: 'Container logging is disabled for this driver',
          }),
        );
        expect(failureLog).not.toHaveProperty('dockerLogsCommand');
      }
    }
  });

  it('enforces the retained-failure count bound for inspect failures', async () => {
    const engine = fakeEngine({
      containers: [
        container({
          name: 'inspect-failed',
          state: 'exited',
          exitCode: 1,
          createdAt: new Date('2025-01-01T00:00:00.000Z'),
          terminalInspectFailed: true,
        }),
        container({
          name: 'recent-failure',
          state: 'exited',
          exitCode: 1,
          finishedAt: new Date('2026-01-01T00:09:00.000Z'),
        }),
      ],
    });
    const lifecycle = makeLifecycle({
      engine,
      failedContainerRetentionMs: 3_600_000,
      maxRetainedFailedContainers: 1,
    });
    await lifecycle.observe();
    expect(engine.removed).toEqual(['recent-failure']);
  });

  it('ranks failures without FinishedAt as newly observed for count eviction', async () => {
    const engine = fakeEngine({
      containers: [
        container({
          name: 'unknown-failure-time',
          state: 'exited',
          exitCode: 1,
        }),
        container({
          name: 'known-failure-time',
          state: 'exited',
          exitCode: 1,
          finishedAt: new Date('2026-01-01T00:09:00.000Z'),
        }),
      ],
    });
    const lifecycle = makeLifecycle({
      engine,
      failedContainerRetentionMs: 3_600_000,
      maxRetainedFailedContainers: 1,
    });

    await lifecycle.observe();

    expect(engine.removed).toEqual(['known-failure-time']);
  });

  it('emits one aggregate cleanup error for multiple failures in one pass', async () => {
    const cleanupError = new DockerEngineError('unknown', 'cleanup failed');
    const engine = fakeEngine({
      containers: [
        container({
          name: 'first',
          state: 'exited',
          exitCode: 1,
          finishedAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
        container({
          name: 'second',
          state: 'exited',
          exitCode: 1,
          finishedAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
        container({
          name: 'third',
          state: 'exited',
          exitCode: 1,
          finishedAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ],
      removeErrors: [cleanupError, undefined, cleanupError],
    });
    const lifecycle = makeLifecycle({
      engine,
      failedContainerRetentionMs: 60_000,
      maxRetainedFailedContainers: 20,
    });

    await lifecycle.observe();

    const cleanupErrors = observability.logger.error.mock.calls.filter(
      ([fields]) => fields?.event === 'runner.failed_container_cleanup_failed',
    );
    expect(cleanupErrors).toHaveLength(1);
    expect(cleanupErrors[0]?.[0]).toMatchObject({failedRemoval: 2, attempts: 1});
  });
  it('keeps a failed container when cleanup fails so the next observation can retry', async () => {
    const engine = fakeEngine({
      containers: [
        container({state: 'exited', exitCode: 1, finishedAt: new Date('2026-01-01T00:00:00.000Z')}),
      ],
      removeError: new DockerEngineError('unknown', 'cleanup failed'),
    });
    const lifecycle = makeLifecycle({
      engine,
      failedContainerRetentionMs: 60_000,
      maxRetainedFailedContainers: 20,
    });

    await lifecycle.observe();
    await lifecycle.observe();

    expect(engine.removed).toEqual(['runner-1', 'runner-1']);
    expect(observability.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({event: 'runner.failed_container_cleanup_failed'}),
      'Failed to remove retained failed runner container; will retry',
    );
    expect(observability.logger.info).not.toHaveBeenCalledWith(
      expect.objectContaining({event: 'runner.cleanup_pass_completed'}),
      expect.any(String),
    );
  });
  it('resets cleanup-failure suppression after a successful cleanup', async () => {
    const cleanupError = new DockerEngineError('unknown', 'cleanup failed');
    const engine = fakeEngine({
      containers: [
        container({state: 'exited', exitCode: 1, finishedAt: new Date('2026-01-01T00:00:00.000Z')}),
      ],
      removeErrors: [cleanupError, undefined, cleanupError],
    });
    const lifecycle = makeLifecycle({
      engine,
      failedContainerRetentionMs: 60_000,
      maxRetainedFailedContainers: 20,
    });
    await lifecycle.observe();
    await lifecycle.observe();
    await lifecycle.observe();
    expect(
      observability.logger.error.mock.calls.filter(
        ([fields]) => fields?.event === 'runner.failed_container_cleanup_failed',
      ),
    ).toHaveLength(2);
  });

  it('submits only created containers past the registration deadline as candidates', async () => {
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
    const client = fakeClient({
      reconcileResponse: {
        runners: [reconciledRunner('created-old', 'keep'), reconciledRunner('running-old', 'keep')],
        terminated_absent_provider_runner_ids: [],
      },
    });
    const lifecycle = makeLifecycle({engine, client, registrationDeadlineMs: 60_000});

    await lifecycle.observe();

    expect(engine.killedAndRemoved).toEqual([]);
    expect(engine.removed).toEqual([]);
    expect(client.reportBodies.flatMap((body) => body.events.map((event) => event.state))).toEqual([
      'starting',
      'running',
    ]);
    expect(client.reconcileBodies[0]).toEqual({
      observed_provider_runner_ids: ['created-old', 'running-old'],
      termination_candidates: [
        {provider_runner_id: 'created-old', reason: 'registration-deadline'},
      ],
    });
    expect(observability.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'provisioner.docker.registration_deadline_candidates_submitted',
        requested_count: 1,
        termination_authorization: 'backend-gated',
      }),
      'Sent Docker registration-deadline termination candidates for backend authorization',
    );
  });

  it('backs off unchanged registration-deadline candidate retries', async () => {
    let currentTime = NOW;
    const engine = fakeEngine({
      containers: [
        container({
          state: 'created',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ],
    });
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client, now: () => currentTime});

    await lifecycle.observe();
    currentTime = new Date(NOW.getTime() + 500);
    await lifecycle.observe();
    currentTime = new Date(NOW.getTime() + 1_000);
    await lifecycle.observe();

    expect(client.reconcileBodies).toHaveLength(2);
    expect(
      observability.logger.info.mock.calls.filter(
        ([fields]) =>
          fields?.event === 'provisioner.docker.registration_deadline_candidates_submitted',
      ),
    ).toHaveLength(1);
  });

  it('caps and rotates registration-deadline candidate submissions', async () => {
    const orderedIds = Array.from(
      {length: MAX_TERMINATION_CANDIDATES + 2},
      (_, index) => `runner-${index.toString().padStart(3, '0')}`,
    );
    const containers = orderedIds.map((name) =>
      container({
        name,
        state: 'created',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    );
    const engine = fakeEngine({containers});
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client, registrationDeadlineMs: 60_000});

    await lifecycle.reconcile();
    await lifecycle.reconcile();

    expect(
      client.reconcileBodies[0]?.termination_candidates?.map(
        (candidate) => candidate.provider_runner_id,
      ),
    ).toEqual(orderedIds.slice(0, MAX_TERMINATION_CANDIDATES));
    expect(
      client.reconcileBodies[1]?.termination_candidates?.map(
        (candidate) => candidate.provider_runner_id,
      ),
    ).toEqual([
      ...orderedIds.slice(MAX_TERMINATION_CANDIDATES),
      ...orderedIds.slice(0, MAX_TERMINATION_CANDIDATES - 2),
    ]);
    expect(
      observability.logger.warn.mock.calls.filter(
        ([fields]) => fields?.event === 'provisioner.docker.registration_deadline_candidate_limit',
      ),
    ).toHaveLength(1);

    containers.splice(2);
    await lifecycle.reconcile();

    expect(
      client.reconcileBodies[2]?.termination_candidates?.map(
        (candidate) => candidate.provider_runner_id,
      ),
    ).toEqual(orderedIds.slice(0, 2));
  });

  it('terminates a stale-created container only after backend authorization', async () => {
    const engine = fakeEngine({
      containers: [
        container({
          state: 'created',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ],
    });
    const client = fakeClient({
      reconcileResponse: {
        runners: [reconciledRunner('runner-1', 'terminate', 'registration-deadline')],
        terminated_absent_provider_runner_ids: [],
      },
    });
    const lifecycle = makeLifecycle({engine, client, registrationDeadlineMs: 60_000});

    await lifecycle.observe();

    expect(client.reconcileBodies[0]).toEqual({
      observed_provider_runner_ids: ['runner-1'],
      termination_candidates: [{provider_runner_id: 'runner-1', reason: 'registration-deadline'}],
    });
    expect(engine.killedAndRemoved).toEqual(['runner-1']);
    expect(client.reportBodies[0]?.events[0]).toMatchObject({
      provider_runner_id: 'runner-1',
      state: 'terminated',
      reason: 'registration-deadline',
    });
  });

  it('revalidates a registration-deadline authorization before killing a container', async () => {
    const containers = [
      container({
        state: 'created',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ];
    const engine = fakeEngine({
      containers,
      onList: (call) => {
        if (call === 2) containers[0] = container({state: 'running'});
      },
    });
    const client = fakeClient({
      reconcileResponse: {
        runners: [reconciledRunner('runner-1', 'terminate', 'registration-deadline')],
        terminated_absent_provider_runner_ids: [],
      },
    });
    const lifecycle = makeLifecycle({engine, client, registrationDeadlineMs: 60_000});

    await lifecycle.reconcile();
    await lifecycle.reconcile();

    expect(engine.killedAndRemoved).toEqual([]);
    expect(client.reportBodies.flatMap((body) => body.events.map((event) => event.state))).toEqual([
      'running',
      'running',
    ]);
    expect(observability.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'runner.container_registration_deadline_termination_skipped',
        currentState: 'running',
      }),
      'Skipped backend registration-deadline termination after the container state changed',
    );
  });

  it('revalidates registration-deadline actions with one Docker listing per batch', async () => {
    const containers = [
      container({
        name: 'runner-1',
        state: 'created',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      container({
        name: 'runner-2',
        state: 'created',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ];
    const engine = fakeEngine({
      containers,
      onList: (call) => {
        if (call === 2) containers[0] = container({name: 'runner-1', state: 'running'});
      },
    });
    const client = fakeClient({
      reconcileResponse: {
        runners: [
          reconciledRunner('runner-1', 'terminate', 'registration-deadline'),
          reconciledRunner('runner-2', 'terminate', 'registration-deadline'),
        ],
        terminated_absent_provider_runner_ids: [],
      },
    });
    const lifecycle = makeLifecycle({engine, client, registrationDeadlineMs: 60_000});

    await lifecycle.reconcile();

    expect(engine.listManagedCalls).toBe(2);
    expect(engine.killedAndRemoved).toEqual(['runner-2']);
    expect(client.reportBodies.flatMap((body) => body.events.map((event) => event.state))).toEqual([
      'running',
      'terminated',
    ]);
  });

  it('does not report termination when backend-authorized registration cleanup fails', async () => {
    const error = new DockerEngineError('unknown', 'kill failed');
    const engine = fakeEngine({
      containers: [
        container({
          state: 'created',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ],
      killAndRemoveErrors: [error],
    });
    const client = fakeClient({
      reconcileResponse: {
        runners: [reconciledRunner('runner-1', 'terminate', 'registration-deadline')],
        terminated_absent_provider_runner_ids: [],
      },
    });
    const lifecycle = makeLifecycle({engine, client, registrationDeadlineMs: 60_000});

    await expect(lifecycle.reconcile()).rejects.toThrow(error);
    expect(client.reportBodies.flatMap((body) => body.events.map((event) => event.state))).toEqual(
      [],
    );

    await lifecycle.reconcile();

    expect(engine.killedAndRemoved).toEqual(['runner-1', 'runner-1']);
    expect(client.reportBodies.flatMap((body) => body.events.map((event) => event.state))).toEqual([
      'terminated',
    ]);
  });

  it('reconciles a stale-created container discovered after the first successful tick', async () => {
    const containers = [container({state: 'running'})];
    const engine = fakeEngine({containers});
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client, registrationDeadlineMs: 60_000});

    await lifecycle.tick();
    containers[0] = container({
      state: 'created',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await lifecycle.tick();

    expect(client.reconcileBodies).toHaveLength(2);
    expect(client.reconcileBodies[1]).toEqual({
      observed_provider_runner_ids: ['runner-1'],
      termination_candidates: [{provider_runner_id: 'runner-1', reason: 'registration-deadline'}],
    });
    expect(engine.killedAndRemoved).toEqual([]);
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
    expect(client.reportBodies.map((body) => body.events[0]?.state)).toEqual(['running']);

    await lifecycle.tick();
    await lifecycle.tick();

    expect(client.reconcileBodies).toHaveLength(2);
    expect(client.reportBodies.map((body) => body.events[0]?.state)).toEqual([
      'running',
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
    expect(observability.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({event: 'runner.container_termination_requested', count: 1}),
      'Runner container termination batch requested',
    );
  });

  it('does not retry cleanup for a container terminated during reconcile', async () => {
    const engine = fakeEngine({
      containers: [container({state: 'exited', exitCode: 1})],
    });
    const client = fakeClient({
      reconcileResponse: {
        runners: [reconciledRunner('runner-1', 'terminate')],
        terminated_absent_provider_runner_ids: [],
      },
    });
    const lifecycle = makeLifecycle({
      engine,
      client,
      failedContainerRetentionMs: 3_600_000,
      maxRetainedFailedContainers: 20,
    });

    await lifecycle.reconcile();

    expect(engine.killedAndRemoved).toEqual(['runner-1']);
    expect(engine.removed).toEqual([]);
    expect(observability.logger.info).not.toHaveBeenCalledWith(
      expect.objectContaining({event: 'runner.cleanup_pass_completed'}),
      expect.any(String),
    );
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
    await expect(lifecycle.reconcile()).rejects.toThrow(error);

    client.reconcileRunnerInstances = (body) => {
      client.reconcileBodies.push(body);
      return Promise.resolve({
        runners: [reconciledRunner('runner-1', 'keep')],
        terminated_absent_provider_runner_ids: [],
      });
    };
    await lifecycle.reconcile();
    client.reconcileRunnerInstances = (body) => {
      client.reconcileBodies.push(body);
      return Promise.resolve({
        runners: [reconciledRunner('runner-1', 'terminate')],
        terminated_absent_provider_runner_ids: [],
      });
    };
    await expect(lifecycle.reconcile()).rejects.toThrow(error);

    expect(engine.killedAndRemoved).toEqual(['runner-1', 'runner-1', 'runner-1']);
    expect(client.reportBodies.flatMap((body) => body.events.map((event) => event.state))).toEqual([
      'running',
    ]);
    expect(
      observability.logger.info.mock.calls.filter(
        ([fields]) => fields?.event === 'runner.container_termination_requested',
      ),
    ).toHaveLength(2);
  });

  it('flushes the initial missing-label diagnostic before terminal side effects', async () => {
    const error = new DockerEngineError('unknown', 'kill failed');
    const engine = fakeEngine({
      containers: [
        container({state: 'running', labels: {'shipfox.provider_runner_id': 'runner-1'}}),
      ],
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
    expect(observability.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({event: 'runner.report_skipped', count: 1}),
      'Skipping provisioned runner reports because labels are unavailable',
    );
  });
  it('deduplicates poll-driven termination requests across observations', async () => {
    const error = new DockerEngineError('unknown', 'kill failed');
    const engine = fakeEngine({
      containers: [container({state: 'running'})],
      killAndRemoveError: error,
    });
    const lifecycle = makeLifecycle({engine});

    await lifecycle.observe();
    await expect(lifecycle.terminate(['runner-1'])).rejects.toThrow(error);
    await lifecycle.observe();
    await expect(lifecycle.terminate(['runner-1'])).rejects.toThrow(error);
    await lifecycle.terminate([]);
    await expect(lifecycle.terminate(['runner-1'])).rejects.toThrow(error);

    expect(
      observability.logger.info.mock.calls.filter(
        ([fields]) => fields?.event === 'runner.container_termination_requested',
      ),
    ).toHaveLength(2);
  });

  it('deduplicates the same termination episode across reconcile and poll sources', async () => {
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
    await expect(lifecycle.terminate(['runner-1'])).rejects.toThrow(error);

    client.reconcileRunnerInstances = (body) => {
      client.reconcileBodies.push(body);
      return Promise.resolve({
        runners: [reconciledRunner('runner-1', 'keep')],
        terminated_absent_provider_runner_ids: [],
      });
    };
    await lifecycle.reconcile();
    await lifecycle.terminate([]);
    await expect(lifecycle.terminate(['runner-1'])).rejects.toThrow(error);

    expect(
      observability.logger.info.mock.calls.filter(
        ([fields]) => fields?.event === 'runner.container_termination_requested',
      ),
    ).toHaveLength(2);
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

  it('reports oversized reconciliation as an incomplete provider operation', async () => {
    const engine = fakeEngine({
      containers: [
        container({
          name: 'stale-runner',
          state: 'created',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
        ...Array.from({length: 5000}, (_, index) =>
          container({name: `runner-${index}`, state: 'running'}),
        ),
      ],
    });
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client});

    await expect(lifecycle.reconcile()).rejects.toThrow('exceeding the API limit of 5000');

    expect(client.reconcileBodies).toEqual([]);
    expect(client.reportBodies.map((body) => body.events.length)).toEqual([
      1000, 1000, 1000, 1000, 1000, 1,
    ]);
    expect(observability.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'provisioner.docker.registration_deadline_candidates_skipped',
        candidate_count: 1,
        observed_count: 5001,
        max_observed: 5000,
      }),
      'Skipped Docker registration-deadline candidates because the observed runner set exceeds the API limit',
    );
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

    await expect(lifecycle.tick()).rejects.toThrow('exceeding the API limit of 5000');
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

  it('reports a missing-label episode when labels return', async () => {
    const labels: Record<string, string> = {
      'shipfox.provider_runner_id': 'runner-1',
    };
    const containers = [container({state: 'running', labels})];
    const engine = fakeEngine({containers});
    const lifecycle = makeLifecycle({engine});
    await lifecycle.observe();
    labels['shipfox.template_key'] = 'small';
    labels['shipfox.labels'] = 'ubuntu22';
    await lifecycle.observe();
    expect(observability.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({event: 'runner.report_resumed', providerRunnerId: 'runner-1'}),
      'Runner report resumed after labels became available',
    );
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
        ...Array.from({length: 10001}, (_, index) =>
          container({name: `runner-${index}`, state: 'running'}),
        ),
        container({name: 'terminal-runner', state: 'exited', exitCode: 0}),
      ],
    });
    const client = fakeClient({
      reportErrors: [new Error('api down'), new Error('api down'), new Error('api down')],
    });
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.observe();
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
    expect(observability.logger.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({event: 'runner_report.queue_overflow'}),
      expect.any(String),
    );
    expect(observability.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'runner_report.delivery_degraded',
        queueDropped: expect.any(Number),
      }),
      'Runner report delivery degraded',
    );
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

  it('counts only outage reports in delivery recovery', async () => {
    const engine = fakeEngine({containers: [container({state: 'running'})]});
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client});
    await lifecycle.observe();
    client.reportErrors.push(new Error('api down'));
    await lifecycle.observe();
    await lifecycle.flush();
    expect(observability.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({event: 'runner_report.delivery_recovered', delivered: 1}),
      'Runner report delivery recovered',
    );
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
    now?: () => Date;
    registrationDeadlineMs?: number;
    failedContainerRetentionMs?: number;
    maxRetainedFailedContainers?: number;
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
    now: args.now ?? (() => NOW),
    registrationDeadlineMs: args.registrationDeadlineMs ?? 120_000,
    providerKind: 'docker',
    ...(args.failedContainerRetentionMs !== undefined
      ? {failedContainerRetentionMs: args.failedContainerRetentionMs}
      : {}),
    ...(args.maxRetainedFailedContainers !== undefined
      ? {maxRetainedFailedContainers: args.maxRetainedFailedContainers}
      : {}),
    loggingDriverSource: 'daemon',
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
    attachErrors?: Error[];
    reconcileErrors?: Error[];
    reconcileResponse?: ReconcileRunnerInstancesResponseDto;
    onReport?: () => void;
    events?: string[];
  } = {},
): ProvisionerClient & {
  reportBodies: ReportRunnerInstancesBodyDto[];
  reportErrors: Error[];
  reconcileBodies: ReconcileRunnerInstancesBodyDto[];
  assignmentBodies: Array<{reservationId: string; runnerInstanceIds: string[]}>;
} {
  const reportBodies: ReportRunnerInstancesBodyDto[] = [];
  const reconcileBodies: ReconcileRunnerInstancesBodyDto[] = [];
  const assignmentBodies: Array<{reservationId: string; runnerInstanceIds: string[]}> = [];
  const reportErrors = [...(options.reportErrors ?? [])];
  const attachErrors = [...(options.attachErrors ?? [])];
  const reconcileErrors = [...(options.reconcileErrors ?? [])];
  return {
    reportBodies,
    reportErrors,
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
    attachRunnerInstanceProviderId: () => {
      const error = attachErrors.shift();
      if (error) return Promise.reject(error);
      options.events?.push('attach');
      return Promise.resolve({attached: true});
    },
    assignRunnerInstances: (reservationId, runnerInstanceIds) => {
      assignmentBodies.push({reservationId, runnerInstanceIds});
      return Promise.resolve({runner_instance_ids: runnerInstanceIds});
    },
    reportRunnerInstances: (body): Promise<ReportRunnerInstancesResponseDto> => {
      reportBodies.push(body);
      options.onReport?.();
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
    removeErrors?: Array<Error | undefined>;
    killAndRemoveError?: Error;
    killAndRemoveErrors?: Array<Error | undefined>;
    onList?: (call: number) => void;
    onRemove?: () => void;
    events?: string[];
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
  const removeErrors = [...(options.removeErrors ?? [])];
  const killAndRemoveErrors = [...(options.killAndRemoveErrors ?? [])];
  let listManagedCalls = 0;

  return {
    created,
    removed,
    killedAndRemoved,
    get listManagedCalls() {
      return listManagedCalls;
    },
    ensureImage: () => Promise.resolve(),
    getInfo: () => Promise.resolve({loggingDriver: 'json-file'}),
    createAndStart: (args) => {
      if (options.createError) return Promise.reject(options.createError);
      created.push(args);
      options.events?.push('create');
      return (async () => {
        await args.beforeStart?.();
        options.events?.push('start');
      })();
    },
    listManaged: () => {
      listManagedCalls += 1;
      options.onList?.(listManagedCalls);
      if (options.listError) return Promise.reject(options.listError);
      return Promise.resolve(options.containers ?? []);
    },
    remove: (name) => {
      options.onRemove?.();
      removed.push(name);
      const error = removeErrors.shift() ?? options.removeError;
      if (error) return Promise.reject(error);
      return Promise.resolve();
    },
    killAndRemove: (name) => {
      killedAndRemoved.push(name);
      const error = killAndRemoveErrors.shift() ?? options.killAndRemoveError;
      if (error) return Promise.reject(error);
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
  startedAt?: Date;
  finishedAt?: Date;
  terminalInspectFailed?: boolean;
  image?: string;
  loggingDriver?: string;
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
    ...(args.image !== undefined ? {image: args.image} : {}),
    ...(args.loggingDriver !== undefined ? {loggingDriver: args.loggingDriver} : {}),
    createdAt: args.createdAt ?? NOW,
    ...(args.startedAt !== undefined ? {startedAt: args.startedAt} : {}),
    ...(args.finishedAt !== undefined ? {finishedAt: args.finishedAt} : {}),
    ...(args.terminalInspectFailed ? {terminalInspectFailed: true} : {}),
  };
}

function reconciledRunner(
  providerRunnerId: string,
  desiredIntent: 'keep' | 'terminate',
  terminationReason?: ReconcileRunnerInstancesResponseDto['runners'][number]['termination_reason'],
): ReconcileRunnerInstancesResponseDto['runners'][number] {
  return {
    provider_runner_id: providerRunnerId,
    state: 'running',
    intended_reservation_id: null,
    reservation_id: RESERVATION_ID,
    runner_session_id: null,
    bound_job: null,
    desired_intent: desiredIntent,
    ...(terminationReason !== undefined ? {termination_reason: terminationReason} : {}),
  };
}

function httpError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), {response: {status}});
}
