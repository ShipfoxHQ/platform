import type {ReportRunnerInstancesBodyDto} from '@shipfox/api-runners-dto';
import type {
  ProviderRunnerLaunch,
  ProviderRunnerTracker,
  ProvisionerClient,
  ProvisionerTemplate,
} from '@shipfox/provisioner-core';
import {ProvisionerAuthenticationError} from '@shipfox/provisioner-core';
import {type Ec2Engine, Ec2EngineError, type Ec2InstanceView} from '#ec2-engine.js';
import {createEc2Lifecycle} from '#lifecycle.js';
import type {Ec2TemplateSpec} from '#templates.js';

const observability = vi.hoisted(() => ({
  logger: {error: vi.fn(), info: vi.fn(), warn: vi.fn()},
  recordEc2Launch: vi.fn(),
  recordEc2Termination: vi.fn(),
}));

vi.mock('@shipfox/node-opentelemetry', () => ({logger: () => observability.logger}));
vi.mock('#metrics/instance.js', () => ({
  recordEc2Launch: observability.recordEc2Launch,
  recordEc2Termination: observability.recordEc2Termination,
}));

const NOW = new Date('2026-01-01T00:10:00.000Z');
const RECONCILE_INTERVAL_MS = 60_000;
const TERMINAL_REPORT_ABSENCE_GRACE_MS = 60 * 60 * 1000;
const RUNNER_INSTANCE_ID = '00000000-0000-4000-8000-000000000004';

const template: ProvisionerTemplate<Ec2TemplateSpec> = {
  key: 'spot-small',
  labels: ['ubuntu22'],
  maxConcurrency: 10,
  cost: 1,
  spec: {
    ami: 'ami-0123456789abcdef0',
    instanceType: 'm6i.large',
    market: 'spot',
    spotMaxPrice: null,
    subnets: ['subnet-a', 'subnet-b'],
    securityGroups: ['sg-runner'],
    associatePublicIp: false,
    rootVolumeGb: 100,
    rootDeviceName: '/dev/sda1',
  },
};

describe('createEc2Lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('attaches its provider identity and reports starting before launching an instance', async () => {
    const engine = fakeEngine();
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.launch(launch());

    expect(client.attachments).toEqual([
      {runnerInstanceId: RUNNER_INSTANCE_ID, providerRunnerId: 'runner-1'},
    ]);
    expect(client.reportBodies[0]?.events[0]).toMatchObject({
      runner_instance_id: RUNNER_INSTANCE_ID,
      provider_runner_id: 'runner-1',
      state: 'starting',
      provider_kind: 'ec2',
    });
    expect(engine.runArgs[0]).toMatchObject({
      clientToken: 'runner-1',
      ami: 'ami-0123456789abcdef0',
      market: 'spot',
      tags: {'shipfox.provider_runner_id': 'runner-1'},
    });
    expect(observability.recordEc2Launch).toHaveBeenCalledWith('spot', 'launched');
    expect(observability.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        provisioned_runner_id: 'runner-1',
        aws_instance_id: 'i-123',
      }),
      'Launched EC2 runner instance',
    );
  });

  it('reports a classified failure and rethrows when EC2 launch fails', async () => {
    const error = new Ec2EngineError('insufficient-capacity', 'no capacity');
    const lifecycle = makeLifecycle({engine: fakeEngine({runError: error})});

    await expect(lifecycle.launch(launch())).rejects.toThrow(error);

    expect(lifecycle).toBeDefined();
  });

  it('reports the classified failure when EC2 launch fails', async () => {
    const client = fakeClient();
    const lifecycle = makeLifecycle({
      engine: fakeEngine({runError: new Ec2EngineError('throttled', 'slow down')}),
      client,
    });

    await expect(lifecycle.launch(launch())).rejects.toThrow(Ec2EngineError);

    expect(client.reportBodies.flatMap((body) => body.events)).toMatchObject([
      {state: 'starting'},
      {state: 'failed', reason: 'throttled'},
    ]);
    expect(observability.recordEc2Launch).toHaveBeenCalledWith('spot', 'throttled');
  });

  it('preserves a just-launched instance in the tracker while DescribeInstances lags', async () => {
    const tracker = testTracker();
    const lifecycle = makeLifecycle({engine: fakeEngine(), tracker});

    await lifecycle.launch(launch());
    await lifecycle.observe();

    expect(tracker.countsByTemplate()).toEqual(
      new Map([['spot-small', {starting: 1, running: 0}]]),
    );
  });

  it('reports a locally launched runner as terminated after the DescribeInstances grace window', async () => {
    const now = new Date(NOW);
    const client = fakeClient();
    const lifecycle = makeLifecycle({client, now: () => now});

    await lifecycle.launch(launch());
    now.setTime(now.getTime() + RECONCILE_INTERVAL_MS);
    await lifecycle.observe();

    expect(client.reportBodies.flatMap((body) => body.events)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({state: 'starting'}),
        expect.objectContaining({provider_runner_id: 'runner-1', state: 'terminated'}),
      ]),
    );
  });

  it('rebuilds the tracker and reports observed running instances', async () => {
    const tracker = testTracker();
    const client = fakeClient();
    const lifecycle = makeLifecycle({
      engine: fakeEngine({instances: [instance({state: 'running'})]}),
      client,
      tracker,
    });

    await lifecycle.observe();
    await lifecycle.observe();

    expect(tracker.countsByTemplate()).toEqual(
      new Map([['spot-small', {starting: 0, running: 1}]]),
    );
    expect(client.reportBodies.flatMap((body) => body.events)).toEqual([
      expect.objectContaining({state: 'running'}),
      expect.objectContaining({state: 'running'}),
    ]);
  });

  it('reports a terminal instance once across observation passes', async () => {
    const client = fakeClient();
    const lifecycle = makeLifecycle({
      engine: fakeEngine({instances: [instance({state: 'terminated'})]}),
      client,
    });

    await lifecycle.observe();
    await lifecycle.observe();

    expect(client.reportBodies.flatMap((body) => body.events)).toHaveLength(1);
    expect(observability.logger.info).toHaveBeenCalledTimes(1);
    expect(observability.recordEc2Termination).toHaveBeenCalledTimes(1);
  });

  it('keeps terminal deduplication through a transient listing gap', async () => {
    const instances = [instance({state: 'terminated'})];
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine: fakeEngine({instances}), client});

    await lifecycle.observe();
    instances.length = 0;
    await lifecycle.observe();
    instances.push(instance({state: 'terminated'}));
    await lifecycle.observe();

    expect(client.reportBodies.flatMap((body) => body.events)).toHaveLength(1);
    expect(observability.logger.info).toHaveBeenCalledTimes(1);
    expect(observability.recordEc2Termination).toHaveBeenCalledTimes(1);
  });

  it('reports a terminal instance again after the listing-gap grace period', async () => {
    const now = new Date(NOW);
    const instances = [instance({state: 'terminated'})];
    const client = fakeClient();
    const lifecycle = makeLifecycle({
      engine: fakeEngine({instances}),
      client,
      now: () => now,
    });

    await lifecycle.observe();
    instances.length = 0;
    now.setTime(now.getTime() + TERMINAL_REPORT_ABSENCE_GRACE_MS + 1);
    await lifecycle.observe();
    instances.push(instance({state: 'terminated'}));
    await lifecycle.observe();

    expect(client.reportBodies.flatMap((body) => body.events)).toHaveLength(2);
    expect(observability.logger.info).toHaveBeenCalledTimes(2);
    expect(observability.recordEc2Termination).toHaveBeenCalledTimes(2);
  });

  it('assigns an enrolled observed runner through its EC2 identity', async () => {
    const client = fakeClient();
    const lifecycle = makeLifecycle({
      engine: fakeEngine({instances: [instance({state: 'running'})]}),
      client,
    });

    await lifecycle.observe();

    expect(client.assignmentBodies).toEqual([
      {
        reservationId: '00000000-0000-4000-8000-000000000003',
        runnerInstanceIds: [RUNNER_INSTANCE_ID],
      },
    ]);
  });

  it('continues reporting and terminating runners when assignment is rejected', async () => {
    const engine = fakeEngine({
      instances: [
        instance({state: 'running'}),
        instance({
          state: 'running',
          instanceId: 'i-terminate',
          providerRunnerId: 'runner-terminate',
        }),
      ],
    });
    const client = fakeClient({
      assignmentErrors: [httpError(503)],
      reconcileResponse: {
        runners: [reconciledRunner('runner-terminate', 'terminate')],
        terminated_absent_provider_runner_ids: [],
      },
    });
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.reconcile();

    expect(client.reportBodies.flatMap((body) => body.events)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({provider_runner_id: 'runner-1', state: 'running'}),
        expect.objectContaining({
          provider_runner_id: 'runner-terminate',
          state: 'terminated',
          reason: 'backend-terminate',
        }),
      ]),
    );
    expect(engine.terminated).toEqual(['i-terminate']);
    expect(observability.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: '00000000-0000-4000-8000-000000000003',
        status: 503,
        retryable: true,
      }),
      'Reservation assignment rejected; will retry',
    );
  });

  it('stops retrying assignment after the reservation is released', async () => {
    const client = fakeClient({assignmentErrors: [httpError(404)]});
    const lifecycle = makeLifecycle({
      engine: fakeEngine({instances: [instance({state: 'running'})]}),
      client,
    });

    await lifecycle.observe();
    await lifecycle.observe();

    expect(client.assignmentBodies).toHaveLength(1);
    expect(observability.logger.warn).toHaveBeenCalledTimes(1);
    expect(observability.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: '00000000-0000-4000-8000-000000000003',
        status: 404,
        retryable: false,
      }),
      'Reservation assignment stopped because reservation was released',
    );
  });

  it('keeps released reservation suppression while its runner remains observed', async () => {
    const instances = [instance({state: 'running'})];
    const client = fakeClient({assignmentErrors: [httpError(404)]});
    const lifecycle = makeLifecycle({engine: fakeEngine({instances}), client});

    await lifecycle.observe();
    instances[0] = instance({state: 'stopped'});
    await lifecycle.observe();
    instances[0] = instance({state: 'running'});
    await lifecycle.observe();

    expect(client.assignmentBodies).toHaveLength(1);
  });

  it('forgets a released reservation after its runner leaves the observed fleet', async () => {
    const instances = [instance({state: 'running'})];
    const client = fakeClient({assignmentErrors: [httpError(404)]});
    const lifecycle = makeLifecycle({engine: fakeEngine({instances}), client});

    await lifecycle.observe();
    instances.length = 0;
    await lifecycle.observe();
    instances.push(instance({state: 'running'}));
    await lifecycle.observe();

    expect(client.assignmentBodies).toHaveLength(2);
  });

  it('retries a transient assignment failure on a later observation', async () => {
    const client = fakeClient({assignmentErrors: [httpError(503)]});
    const lifecycle = makeLifecycle({
      engine: fakeEngine({instances: [instance({state: 'running'})]}),
      client,
    });

    await lifecycle.observe();
    await lifecycle.observe();

    expect(client.assignmentBodies).toHaveLength(2);
  });

  it('reports a Spot-reclaimed terminated instance as failed once', async () => {
    const client = fakeClient();
    const lifecycle = makeLifecycle({
      engine: fakeEngine({
        instances: [
          instance({
            state: 'terminated',
            stateTransitionReason: 'Server.SpotInstanceTermination: capacity reclaimed',
          }),
        ],
      }),
      client,
    });

    await lifecycle.observe();
    await lifecycle.observe();

    expect(client.reportBodies.flatMap((body) => body.events)).toEqual([
      expect.objectContaining({state: 'failed', reason: 'spot-interruption'}),
    ]);
    expect(observability.recordEc2Termination).toHaveBeenCalledWith('spot-interruption');
    expect(observability.recordEc2Termination).toHaveBeenCalledTimes(1);
  });

  it('propagates observation failures so the core loop degrades capacity to zero', async () => {
    const error = new Ec2EngineError('unreachable', 'EC2 unavailable');
    const lifecycle = makeLifecycle({engine: fakeEngine({listError: error})});

    await expect(lifecycle.observe()).rejects.toThrow(error);
  });

  it('retries transiently failed reports on the next observation', async () => {
    const client = fakeClient({reportErrors: [new Error('API unavailable')]});
    const lifecycle = makeLifecycle({
      engine: fakeEngine({instances: [instance({state: 'running'})]}),
      client,
    });

    await lifecycle.observe();
    await lifecycle.observe();

    expect(client.reportBodies).toHaveLength(3);
    expect(client.reportBodies[1]?.events[0]).toMatchObject({state: 'running'});
  });

  it('does not retry permanently invalid report batches', async () => {
    const client = fakeClient({reportErrors: [httpError(400)]});
    const lifecycle = makeLifecycle({
      engine: fakeEngine({instances: [instance({state: 'running'})]}),
      client,
    });

    await lifecycle.observe();
    await lifecycle.flush();

    expect(client.reportBodies).toHaveLength(1);
  });

  it('does not deduplicate a terminal report that the API rejects as invalid', async () => {
    const client = fakeClient({reportErrors: [httpError(400)]});
    const lifecycle = makeLifecycle({
      engine: fakeEngine({instances: [instance({state: 'terminated'})]}),
      client,
    });

    await lifecycle.observe();
    await lifecycle.observe();

    expect(client.reportBodies.flatMap((body) => body.events)).toHaveLength(2);
    expect(observability.logger.info).toHaveBeenCalledTimes(2);
    expect(observability.recordEc2Termination).toHaveBeenCalledTimes(2);
  });

  it('keeps authentication report failures fatal', async () => {
    const lifecycle = makeLifecycle({
      client: fakeClient({reportErrors: [new ProvisionerAuthenticationError(401)]}),
    });

    await expect(lifecycle.launch(launch())).rejects.toThrow(ProvisionerAuthenticationError);
  });

  it('terminates an overdue instance before authentication failures can block reporting', async () => {
    const engine = fakeEngine({
      instances: [instance({state: 'pending', launchTime: new Date('2026-01-01T00:00:00.000Z')})],
    });
    const client = fakeClient({
      reportErrors: [new ProvisionerAuthenticationError(401)],
    });
    const lifecycle = makeLifecycle({engine, client, registrationDeadlineMs: 60_000});

    await expect(lifecycle.observe()).rejects.toThrow(ProvisionerAuthenticationError);

    expect(engine.terminated).toEqual(['i-123']);
  });

  it('reaps an overdue instance before a failed reconcile request from tick', async () => {
    const engine = fakeEngine({
      instances: [instance({state: 'pending', launchTime: new Date('2026-01-01T00:00:00.000Z')})],
    });
    const reconcileError = new ProvisionerAuthenticationError(401);
    const client = fakeClient({reconcileErrors: [reconcileError, reconcileError]});
    const lifecycle = makeLifecycle({engine, client, registrationDeadlineMs: 60_000});

    await expect(lifecycle.tick()).rejects.toThrow(ProvisionerAuthenticationError);
    await expect(lifecycle.tick()).rejects.toThrow(ProvisionerAuthenticationError);

    expect(engine.terminated).toEqual(['i-123']);
    expect(client.reconcileBodies).toHaveLength(2);
  });

  it('reports a failed launch and does not launch when provider identity attachment is rejected', async () => {
    const engine = fakeEngine();
    const client = fakeClient({attachResult: {attached: false}});
    const lifecycle = makeLifecycle({engine, client});

    await expect(lifecycle.launch(launch())).rejects.toThrow(
      `Provider identity was not attached for runner instance ${RUNNER_INSTANCE_ID}`,
    );

    expect(engine.runArgs).toHaveLength(0);
    expect(client.reportBodies.flatMap((body) => body.events)).toMatchObject([{state: 'failed'}]);
  });

  it('rejects and reports a failure when the template has no subnets', async () => {
    const emptySubnetsTemplate: ProvisionerTemplate<Ec2TemplateSpec> = {
      ...template,
      spec: {...template.spec, subnets: []},
    };
    const engine = fakeEngine();
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client});

    await expect(lifecycle.launch({...launch(), template: emptySubnetsTemplate})).rejects.toThrow(
      'Template spot-small has no subnets.',
    );

    expect(engine.runArgs).toHaveLength(0);
    expect(client.reportBodies.flatMap((body) => body.events)).toMatchObject([
      {state: 'starting'},
      {state: 'failed'},
    ]);
  });

  it('chunks report batches at 1000 events', async () => {
    const client = fakeClient();
    const lifecycle = makeLifecycle({
      engine: fakeEngine({
        instances: Array.from({length: 1500}, () => instance({state: 'running'})),
      }),
      client,
    });

    await lifecycle.observe();

    expect(client.reportBodies).toHaveLength(2);
    expect(client.reportBodies[0]?.events).toHaveLength(1000);
    expect(client.reportBodies[1]?.events).toHaveLength(500);
  });

  it('skips reporting and tracking an instance whose labels cannot be resolved', async () => {
    const client = fakeClient();
    const tracker = testTracker();
    const unlabeledInstance: Ec2InstanceView = {
      instanceId: 'i-999',
      state: 'running',
      tags: {
        'shipfox.provider_runner_id': 'runner-unlabeled',
        'shipfox.provisioner_id': '00000000-0000-4000-8000-000000000001',
      },
    };
    const lifecycle = makeLifecycle({
      engine: fakeEngine({instances: [unlabeledInstance]}),
      client,
      tracker,
    });

    await lifecycle.observe();

    expect(client.reportBodies.flatMap((body) => body.events)).toHaveLength(0);
    expect(tracker.countsByTemplate().size).toBe(0);
  });

  it('reports an instance with resolved labels but keeps it out of the tracker when the template key is unknown', async () => {
    const client = fakeClient();
    const tracker = testTracker();
    const instanceWithoutTemplateKey: Ec2InstanceView = {
      instanceId: 'i-888',
      state: 'running',
      tags: {
        'shipfox.provider_runner_id': 'runner-no-template',
        'shipfox.provisioner_id': '00000000-0000-4000-8000-000000000001',
        'shipfox.labels': 'ubuntu22',
      },
    };
    const lifecycle = makeLifecycle({
      engine: fakeEngine({instances: [instanceWithoutTemplateKey]}),
      client,
      tracker,
    });

    await lifecycle.observe();

    expect(client.reportBodies[0]?.events[0]).toMatchObject({state: 'running'});
    expect(tracker.countsByTemplate().size).toBe(0);
  });

  it('reconciles adopted instances and sends their observed ids to the backend', async () => {
    const client = fakeClient({
      reconcileResponse: {
        runners: [reconciledRunner('runner-1', 'keep')],
        terminated_absent_provider_runner_ids: [],
      },
    });
    const tracker = testTracker();
    const lifecycle = makeLifecycle({
      client,
      engine: fakeEngine({instances: [instance({state: 'running'})]}),
      tracker,
    });

    await lifecycle.reconcile();

    expect(client.reconcileBodies).toEqual([{observed_provider_runner_ids: ['runner-1']}]);
    expect(tracker.countsByTemplate()).toEqual(
      new Map([['spot-small', {starting: 0, running: 1}]]),
    );
  });

  it('reconcile falls back to local observe when the observed id count exceeds the API limit', async () => {
    const engine = fakeEngine({
      instances: Array.from({length: 5001}, (_, index) =>
        instance({state: 'running', instanceId: `i-${index}`, providerRunnerId: `runner-${index}`}),
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

  it('terminates and reports instances with backend terminate intent', async () => {
    const engine = fakeEngine({instances: [instance({state: 'running'})]});
    const client = fakeClient({
      reconcileResponse: {
        runners: [reconciledRunner('runner-1', 'terminate')],
        terminated_absent_provider_runner_ids: [],
      },
    });
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.reconcile();

    expect(engine.terminated).toEqual(['i-123']);
    expect(client.reportBodies.flatMap((body) => body.events)).toEqual([
      expect.objectContaining({
        provider_runner_id: 'runner-1',
        state: 'terminated',
        reason: 'backend-terminate',
      }),
    ]);
    expect(observability.recordEc2Termination).toHaveBeenCalledWith('backend-terminate');
    expect(observability.recordEc2Termination).toHaveBeenCalledTimes(1);
  });

  it('keeps successful termination actions when a later instance fails', async () => {
    const engine = fakeEngine({
      instances: [
        instance({state: 'running'}),
        instance({state: 'running', instanceId: 'i-456', providerRunnerId: 'runner-2'}),
      ],
      terminateErrors: [undefined, new Error('EC2 unavailable')],
    });
    const client = fakeClient({
      reconcileResponse: {
        runners: [
          reconciledRunner('runner-1', 'terminate'),
          reconciledRunner('runner-2', 'terminate'),
        ],
        terminated_absent_provider_runner_ids: [],
      },
    });
    const lifecycle = makeLifecycle({engine, client});

    await expect(lifecycle.reconcile()).rejects.toThrow('EC2 unavailable');
    await lifecycle.reconcile();

    expect(engine.terminated).toEqual(['i-123', 'i-456']);
    expect(observability.recordEc2Termination).toHaveBeenCalledTimes(2);
  });

  it('reports the first terminal observation before handling backend terminate intent', async () => {
    const engine = fakeEngine({instances: [instance({state: 'terminated'})]});
    const client = fakeClient({
      reconcileResponse: {
        runners: [reconciledRunner('runner-1', 'terminate')],
        terminated_absent_provider_runner_ids: [],
      },
    });
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.reconcile();

    expect(engine.terminated).toEqual([]);
    expect(client.reportBodies.flatMap((body) => body.events)).toEqual([
      expect.objectContaining({provider_runner_id: 'runner-1', state: 'terminated'}),
    ]);
  });

  it('does not terminate or re-report an already-terminated instance with backend intent', async () => {
    const engine = fakeEngine({instances: [instance({state: 'terminated'})]});
    const client = fakeClient({
      reconcileResponse: {
        runners: [reconciledRunner('runner-1', 'terminate')],
        terminated_absent_provider_runner_ids: [],
      },
    });
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.reconcile();
    await lifecycle.reconcile();

    expect(engine.terminated).toEqual([]);
    expect(client.reportBodies.flatMap((body) => body.events)).toHaveLength(1);
  });

  it('reports a stopped instance once and still terminates it under backend intent', async () => {
    const engine = fakeEngine({instances: [instance({state: 'stopped'})]});
    const client = fakeClient({
      reconcileResponse: {
        runners: [reconciledRunner('runner-1', 'terminate')],
        terminated_absent_provider_runner_ids: [],
      },
    });
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.reconcile();

    expect(engine.terminated).toEqual(['i-123']);
    expect(client.reportBodies.flatMap((body) => body.events)).toEqual([
      expect.objectContaining({provider_runner_id: 'runner-1', state: 'terminated'}),
    ]);
  });

  it('reports shutting-down instances without calling terminate again', async () => {
    const engine = fakeEngine({instances: [instance({state: 'shutting-down'})]});
    const client = fakeClient({
      reconcileResponse: {
        runners: [reconciledRunner('runner-1', 'terminate')],
        terminated_absent_provider_runner_ids: [],
      },
    });
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.reconcile();

    expect(engine.terminated).toEqual([]);
    expect(client.reportBodies.flatMap((body) => body.events)).toEqual([
      expect.objectContaining({provider_runner_id: 'runner-1', state: 'stopping'}),
    ]);
  });

  it('terminates an instance with backend terminate intent even when its labels are unresolvable', async () => {
    const engine = fakeEngine({
      instances: [instance({state: 'running', templateKey: 'unknown-template', labels: ''})],
    });
    const client = fakeClient({
      reconcileResponse: {
        runners: [reconciledRunner('runner-1', 'terminate')],
        terminated_absent_provider_runner_ids: [],
      },
    });
    const lifecycle = makeLifecycle({engine, client});

    await lifecycle.reconcile();
    await lifecycle.reconcile();

    expect(engine.terminated).toEqual(['i-123']);
    expect(observability.recordEc2Termination).toHaveBeenCalledWith('backend-terminate');
    expect(observability.recordEc2Termination).toHaveBeenCalledTimes(1);
  });

  it('reaps a pending instance past its registration deadline even when its labels are unresolvable', async () => {
    const engine = fakeEngine({
      instances: [
        instance({
          state: 'pending',
          launchTime: new Date('2026-01-01T00:00:00.000Z'),
          templateKey: 'unknown-template',
          labels: '',
        }),
      ],
    });
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client, registrationDeadlineMs: 60_000});

    await lifecycle.observe();
    await lifecycle.observe();

    expect(engine.terminated).toEqual(['i-123']);
    expect(observability.recordEc2Termination).toHaveBeenCalledWith('registration-deadline');
    expect(observability.recordEc2Termination).toHaveBeenCalledTimes(1);
  });

  it('reaps a pending instance past its registration deadline', async () => {
    const instances = [
      instance({state: 'pending', launchTime: new Date('2026-01-01T00:00:00.000Z')}),
    ];
    const engine = fakeEngine({
      instances,
    });
    const client = fakeClient();
    const lifecycle = makeLifecycle({engine, client, registrationDeadlineMs: 60_000});

    await lifecycle.observe();
    instances[0] = instance({state: 'terminated'});
    await lifecycle.observe();

    expect(engine.terminated).toEqual(['i-123']);
    expect(client.reportBodies.flatMap((body) => body.events)).toEqual([
      expect.objectContaining({state: 'terminated', reason: 'registration-deadline'}),
    ]);
    expect(observability.recordEc2Termination).toHaveBeenCalledWith('registration-deadline');
    expect(observability.recordEc2Termination).toHaveBeenCalledTimes(1);
  });

  it('periodically reconciles and otherwise observes', async () => {
    const now = new Date(NOW);
    const client = fakeClient({
      reconcileResponse: {runners: [], terminated_absent_provider_runner_ids: []},
    });
    const lifecycle = makeLifecycle({client, now: () => now});

    await lifecycle.tick();
    now.setTime(now.getTime() + RECONCILE_INTERVAL_MS - 1);
    await lifecycle.tick();
    now.setTime(now.getTime() + 1);
    await lifecycle.tick();

    expect(client.reconcileBodies).toHaveLength(2);
  });

  it('logs backend absent ids while reconciling an empty observed set', async () => {
    const client = fakeClient({
      reconcileResponse: {runners: [], terminated_absent_provider_runner_ids: ['vanished-runner']},
    });
    const lifecycle = makeLifecycle({client});

    await lifecycle.reconcile();

    expect(client.reconcileBodies).toEqual([{observed_provider_runner_ids: []}]);
  });

  it('terminates only managed instances matching requested ids', async () => {
    const engine = fakeEngine({
      instances: [
        instance({state: 'running'}),
        instance({state: 'running', instanceId: 'i-456', providerRunnerId: 'runner-2'}),
      ],
    });
    const lifecycle = makeLifecycle({engine});

    await lifecycle.terminate(['runner-2', 'absent-runner']);

    expect(engine.terminated).toEqual(['i-456']);
  });
});

function makeLifecycle(
  args: {
    engine?: ReturnType<typeof fakeEngine>;
    client?: ReturnType<typeof fakeClient>;
    tracker?: ProviderRunnerTracker;
    registrationDeadlineMs?: number;
    now?: () => Date;
  } = {},
) {
  return createEc2Lifecycle({
    engine: args.engine ?? fakeEngine(),
    client: args.client ?? fakeClient(),
    identity: {id: '00000000-0000-4000-8000-000000000001', workspaceId: null},
    tracker: args.tracker ?? testTracker(),
    templates: [template],
    providerKind: 'ec2',
    registrationDeadlineMs: args.registrationDeadlineMs ?? 300_000,
    reconcileIntervalMs: RECONCILE_INTERVAL_MS,
    now: args.now ?? (() => NOW),
  });
}

function launch(): ProviderRunnerLaunch<Ec2TemplateSpec> {
  return {
    runnerInstanceId: RUNNER_INSTANCE_ID,
    providerRunnerId: 'runner-1',
    reservationId: '00000000-0000-4000-8000-000000000003',
    bootstrapToken: 'sf_rbt_secret',
    runnerEnv: {SHIPFOX_RUNNER_BOOTSTRAP_TOKEN: 'sf_rbt_secret'},
    template,
  };
}

function instance(args: {
  state: Ec2InstanceView['state'];
  stateTransitionReason?: string;
  launchTime?: Date;
  instanceId?: string;
  providerRunnerId?: string;
  templateKey?: string;
  labels?: string;
}): Ec2InstanceView {
  return {
    instanceId: args.instanceId ?? 'i-123',
    state: args.state,
    tags: {
      'shipfox.runner_instance_id': RUNNER_INSTANCE_ID,
      'shipfox.provider_runner_id': args.providerRunnerId ?? 'runner-1',
      'shipfox.provisioner_id': '00000000-0000-4000-8000-000000000001',
      'shipfox.reservation_id': '00000000-0000-4000-8000-000000000003',
      'shipfox.template_key': args.templateKey ?? 'spot-small',
      'shipfox.labels': args.labels ?? 'ubuntu22',
    },
    ...(args.stateTransitionReason ? {stateTransitionReason: args.stateTransitionReason} : {}),
    ...(args.launchTime ? {launchTime: args.launchTime} : {}),
  };
}

function fakeEngine(
  options: {
    instances?: Ec2InstanceView[];
    runError?: Error;
    listError?: Error;
    terminateErrors?: Array<Error | undefined>;
  } = {},
): Ec2Engine & {runArgs: Parameters<Ec2Engine['runInstance']>[0][]; terminated: string[]} {
  const runArgs: Parameters<Ec2Engine['runInstance']>[0][] = [];
  const terminated: string[] = [];
  const terminateErrors = [...(options.terminateErrors ?? [])];
  return {
    runArgs,
    terminated,
    runInstance: (args) => {
      runArgs.push(args);
      return options.runError
        ? Promise.reject(options.runError)
        : Promise.resolve(instance({state: 'pending'}));
    },
    listManaged: () =>
      options.listError
        ? Promise.reject(options.listError)
        : Promise.resolve(options.instances ?? []),
    terminate: (instanceIds) => {
      const error = terminateErrors.shift();
      if (error) return Promise.reject(error);
      terminated.push(...instanceIds);
      return Promise.resolve();
    },
  };
}

function fakeClient(
  options: {
    reportErrors?: Error[];
    assignmentErrors?: Error[];
    reconcileErrors?: Error[];
    attachResult?: {attached: boolean};
    reconcileResponse?: Awaited<ReturnType<ProvisionerClient['reconcileRunnerInstances']>>;
  } = {},
): ProvisionerClient & {
  reportBodies: ReportRunnerInstancesBodyDto[];
  reconcileBodies: Array<{observed_provider_runner_ids: string[]}>;
  assignmentBodies: Array<{reservationId: string; runnerInstanceIds: string[]}>;
  attachments: Array<{runnerInstanceId: string; providerRunnerId: string}>;
} {
  const reportBodies: ReportRunnerInstancesBodyDto[] = [];
  const reconcileBodies: Array<{observed_provider_runner_ids: string[]}> = [];
  const assignmentBodies: Array<{reservationId: string; runnerInstanceIds: string[]}> = [];
  const attachments: Array<{runnerInstanceId: string; providerRunnerId: string}> = [];
  const reportErrors = [...(options.reportErrors ?? [])];
  const assignmentErrors = [...(options.assignmentErrors ?? [])];
  const reconcileErrors = [...(options.reconcileErrors ?? [])];
  return {
    reportBodies,
    reconcileBodies,
    assignmentBodies,
    attachments,
    getIdentity: () =>
      Promise.resolve({id: 'provisioner', scope: 'installation', workspace_id: null}),
    pollDemand: () =>
      Promise.resolve({stats: [], reservations: [], terminate_provider_runner_ids: []}),
    createRunnerInstances: () => Promise.resolve({runner_instances: []}),
    reconcileRunnerInstances: (body) => {
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
    attachRunnerInstanceProviderId: (runnerInstanceId, providerRunnerId) => {
      attachments.push({runnerInstanceId, providerRunnerId});
      return Promise.resolve(options.attachResult ?? {attached: true});
    },
    assignRunnerInstances: (reservationId, runnerInstanceIds) => {
      assignmentBodies.push({reservationId, runnerInstanceIds});
      const error = assignmentErrors.shift();
      if (error) return Promise.reject(error);
      return Promise.resolve({runner_instance_ids: runnerInstanceIds});
    },
    reportRunnerInstances: (body) => {
      reportBodies.push(body);
      const error = reportErrors.shift();
      return error
        ? Promise.reject(error)
        : Promise.resolve({accepted: body.events.length, reservations_released: 0});
    },
  };
}

function reconciledRunner(providerRunnerId: string, desiredIntent: 'keep' | 'terminate') {
  return {
    provider_runner_id: providerRunnerId,
    state: 'running' as const,
    reservation_id: '00000000-0000-4000-8000-000000000003',
    runner_session_id: null,
    bound_job: null,
    desired_intent: desiredIntent,
  };
}

function testTracker(): ProviderRunnerTracker {
  const runners = new Map<string, {templateKey: string; state: 'starting' | 'running'}>();
  return {
    recordStarting: ({providerRunnerId, templateKey}) =>
      runners.set(providerRunnerId, {templateKey, state: 'starting'}),
    markRunning: (providerRunnerId) => {
      const runner = runners.get(providerRunnerId);
      if (runner) runner.state = 'running';
    },
    remove: (providerRunnerId) => runners.delete(providerRunnerId),
    replaceAll: (nextRunners) => {
      runners.clear();
      for (const runner of nextRunners) runners.set(runner.providerRunnerId, {...runner});
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

function httpError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), {response: {status}});
}
