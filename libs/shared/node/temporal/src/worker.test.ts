import type {NativeConnection, State, Worker} from '@temporalio/worker';
import type {CreateWorkerOptions} from './worker.js';
import {
  createTemporalWorker,
  createTemporalWorkerConnection,
  requestTemporalWorkerShutdown,
} from './worker.js';

const mocks = vi.hoisted(() => ({
  nativeConnectionConnect: vi.fn(),
  workerCreate: vi.fn(),
  logger: {error: vi.fn(), info: vi.fn()},
  getTemporalConnectionOptions: vi.fn(),
  temporalConnectionError: vi.fn(),
  getWorkerInterceptors: vi.fn(),
  getWorkflowInterceptorModules: vi.fn(),
  getWorkflowSinks: vi.fn(),
  installTemporalRuntime: vi.fn(),
  loadProductionWorkflowBundle: vi.fn(),
  reportError: vi.fn(),
  temporalConfig: {
    TEMPORAL_NAMESPACE: 'test-namespace',
    TEMPORAL_TASK_QUEUE: 'test-queue',
  },
}));

vi.mock('@temporalio/worker', () => ({
  NativeConnection: {connect: mocks.nativeConnectionConnect},
  Worker: {create: mocks.workerCreate},
}));

vi.mock('@shipfox/node-opentelemetry', () => ({
  logger: () => mocks.logger,
}));

vi.mock('@shipfox/node-error-monitoring', () => ({reportError: mocks.reportError}));

vi.mock('./connection-options.js', () => ({
  getTemporalConnectionOptions: mocks.getTemporalConnectionOptions,
  temporalConnectionError: mocks.temporalConnectionError,
}));

vi.mock('./config.js', () => ({config: mocks.temporalConfig}));

vi.mock('./bundle.js', () => ({
  loadProductionWorkflowBundle: mocks.loadProductionWorkflowBundle,
}));

vi.mock('./interceptors.js', () => ({
  getWorkerInterceptors: mocks.getWorkerInterceptors,
  getWorkflowInterceptorModules: mocks.getWorkflowInterceptorModules,
  getWorkflowSinks: mocks.getWorkflowSinks,
}));

vi.mock('./runtime.js', () => ({installTemporalRuntime: mocks.installTemporalRuntime}));

function workerOptions(overrides: Partial<CreateWorkerOptions> = {}): CreateWorkerOptions {
  return {
    workflowsPath: '/tmp/workflows.js',
    activities: {},
    ...overrides,
  };
}

function temporalWorker(state: State): Worker {
  return {
    getState: vi.fn().mockReturnValue(state),
    shutdown: vi.fn(),
  } as unknown as Worker;
}

describe('createTemporalWorkerConnection', () => {
  beforeEach(() => {
    mocks.nativeConnectionConnect.mockReset();
    mocks.getTemporalConnectionOptions.mockReset();
    mocks.temporalConnectionError.mockReset();
    mocks.installTemporalRuntime.mockReset();
    mocks.getTemporalConnectionOptions.mockReturnValue({address: 'temporal.example.test:7233'});
    mocks.temporalConnectionError.mockImplementation(
      (error) => new Error('Failed to connect to Temporal.', {cause: error}),
    );
  });

  it('connects with the configured Temporal connection options', async () => {
    const connection = {};
    mocks.nativeConnectionConnect.mockResolvedValue(connection);

    const result = await createTemporalWorkerConnection();

    expect(result).toBe(connection);
    expect(mocks.installTemporalRuntime).toHaveBeenCalledOnce();
    expect(mocks.nativeConnectionConnect).toHaveBeenCalledWith({
      address: 'temporal.example.test:7233',
    });
  });

  it('translates connection failures', async () => {
    const failure = new Error('connection refused');
    mocks.nativeConnectionConnect.mockRejectedValue(failure);

    const result = createTemporalWorkerConnection();

    await expect(result).rejects.toThrow('Failed to connect to Temporal.');
    await result.catch((error: unknown) => {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).cause).toBe(failure);
    });
  });
});

describe('requestTemporalWorkerShutdown', () => {
  it('requests shutdown for a running worker', () => {
    const worker = temporalWorker('RUNNING');

    requestTemporalWorkerShutdown(worker);

    expect(worker.shutdown).toHaveBeenCalledOnce();
  });

  it.each([
    'INITIALIZED',
    'STOPPING',
    'DRAINING',
    'DRAINED',
    'STOPPED',
    'FAILED',
  ] as const)('does not request shutdown for a worker in the %s state', (state) => {
    const worker = temporalWorker(state);

    requestTemporalWorkerShutdown(worker);

    expect(worker.shutdown).not.toHaveBeenCalled();
  });
});

describe('createTemporalWorker', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mocks.nativeConnectionConnect.mockReset();
    mocks.workerCreate.mockReset();
    mocks.logger.error.mockReset();
    mocks.logger.info.mockReset();
    mocks.logger.error.mockReset();
    mocks.getTemporalConnectionOptions.mockReset();
    mocks.temporalConnectionError.mockReset();
    mocks.getWorkerInterceptors.mockReset();
    mocks.getWorkflowInterceptorModules.mockReset();
    mocks.getWorkflowSinks.mockReset();
    mocks.installTemporalRuntime.mockReset();
    mocks.loadProductionWorkflowBundle.mockReset();
    mocks.reportError.mockReset();
    mocks.nativeConnectionConnect.mockResolvedValue({});
    mocks.workerCreate.mockResolvedValue({});
    mocks.getTemporalConnectionOptions.mockReturnValue({address: 'temporal.example.test:7233'});
    mocks.getWorkerInterceptors.mockReturnValue({activity: []});
    mocks.getWorkflowInterceptorModules.mockReturnValue(['/tmp/workflow-interceptor.js']);
    mocks.getWorkflowSinks.mockReturnValue({exporter: {}});
    mocks.loadProductionWorkflowBundle.mockReturnValue({codePath: '/tmp/workflows.bundle.js'});
  });

  it('creates a connection when one is not provided', async () => {
    const connection = {};
    mocks.nativeConnectionConnect.mockResolvedValue(connection);

    await createTemporalWorker(workerOptions());

    expect(mocks.workerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        connection,
        namespace: 'test-namespace',
        taskQueue: 'test-queue',
        sinks: expect.objectContaining({exporter: {}}),
      }),
    );
  });

  it('uses a caller-owned connection without creating or closing one', async () => {
    const connection = {close: vi.fn()} as unknown as NativeConnection;
    const worker = {shutdown: vi.fn()};
    mocks.workerCreate.mockResolvedValue(worker);

    const result = await createTemporalWorker(workerOptions({connection}));
    await result.shutdown();

    expect(mocks.nativeConnectionConnect).not.toHaveBeenCalled();
    expect(mocks.installTemporalRuntime).toHaveBeenCalledOnce();
    expect(mocks.workerCreate).toHaveBeenCalledWith(expect.objectContaining({connection}));
    expect(connection.close).not.toHaveBeenCalled();
  });

  it('keeps workspace development workflow resolution source-based', async () => {
    vi.stubEnv('NODE_ENV', 'development');

    await createTemporalWorker(workerOptions());

    const createdWorkerOptions = mocks.workerCreate.mock.calls[0]?.[0];
    expect(createdWorkerOptions).toMatchObject({
      workflowsPath: '/tmp/workflows.js',
      interceptors: {activity: [], workflowModules: ['/tmp/workflow-interceptor.js']},
    });
    expect(createdWorkerOptions).not.toHaveProperty('workflowBundle');
    expect(mocks.loadProductionWorkflowBundle).not.toHaveBeenCalled();
  });

  it('uses a prebuilt workflow bundle in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    await createTemporalWorker(workerOptions());

    const createdWorkerOptions = mocks.workerCreate.mock.calls[0]?.[0];
    expect(createdWorkerOptions).toMatchObject({
      workflowBundle: {codePath: '/tmp/workflows.bundle.js'},
      interceptors: {activity: []},
    });
    expect(createdWorkerOptions).not.toHaveProperty('workflowsPath');
    expect(createdWorkerOptions).not.toHaveProperty('bundlerOptions');
    expect(createdWorkerOptions?.interceptors).not.toHaveProperty('workflowModules');
    expect(mocks.loadProductionWorkflowBundle).toHaveBeenCalledWith('/tmp/workflows.js');
  });

  it('reports workflow defects through a replay-safe sink without workflow input', async () => {
    await createTemporalWorker(workerOptions());

    const createdWorkerOptions = mocks.workerCreate.mock.calls[0]?.[0];
    const sink = createdWorkerOptions.sinks.shipfoxErrorMonitoring.reportWorkflowError;
    const report = {
      name: 'Error',
      message: 'workflow failed',
      stack: 'Error: workflow failed',
      workflowType: 'dispatch',
      taskQueue: 'workflows',
      workflowId: 'workflow-1',
      runId: 'run-1',
      attempt: 3,
    };

    sink.fn({}, report);

    expect(sink.callDuringReplay).toBe(false);
    expect(mocks.reportError).toHaveBeenCalledWith(
      expect.objectContaining({name: 'Error', message: 'workflow failed', stack: report.stack}),
      {
        boundary: 'temporal.workflow',
        tags: {workflowType: 'dispatch', taskQueue: 'workflows'},
        extra: {workflowId: 'workflow-1', runId: 'run-1', attempt: 3},
      },
    );
  });

  it('validates a production bundle before opening an internally owned connection', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const failure = new Error('missing workflow bundle');
    mocks.loadProductionWorkflowBundle.mockImplementation(() => {
      throw failure;
    });

    const result = createTemporalWorker(workerOptions());

    await expect(result).rejects.toThrow(failure);
    expect(mocks.nativeConnectionConnect).not.toHaveBeenCalled();
    expect(mocks.workerCreate).not.toHaveBeenCalled();
  });
});
