import type {AgentConfigIssueDto, NextStepResponseDto, StepDto} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {HTTPError} from 'ky';

const {AgentRuntimeConfigRequestError, StepSecretsRequestError, resolveWorkingDirectoryMock} =
  vi.hoisted(() => ({
    AgentRuntimeConfigRequestError: class AgentRuntimeConfigRequestError extends Error {
      constructor(
        public readonly status: number,
        public readonly code: string | undefined,
        public readonly agentConfigIssue: AgentConfigIssueDto | undefined = undefined,
      ) {
        super(
          code === undefined
            ? `Agent runtime config request failed with status ${status}.`
            : `Agent runtime config request failed with status ${status}: ${code}.`,
        );
        this.name = 'AgentRuntimeConfigRequestError';
      }
    },
    StepSecretsRequestError: class StepSecretsRequestError extends Error {
      constructor(
        public readonly status: number,
        public readonly code: string | undefined,
      ) {
        super(
          code === undefined
            ? `Step secrets request failed with status ${status}.`
            : `Step secrets request failed with status ${status}: ${code}.`,
        );
        this.name = 'StepSecretsRequestError';
      }
    },
    resolveWorkingDirectoryMock: vi.fn(async (cwd: string, workingDirectory: unknown) =>
      workingDirectory === undefined ? cwd : `${cwd}/${String(workingDirectory)}`,
    ),
  }));

const requestNextStepMock = vi.fn();
const requestAgentRuntimeConfigMock = vi.fn();
const requestStepSecretsMock = vi.fn();
const reportStepMock = vi.fn();
const appendStepLogsMock = vi.fn();
const writeStepAnnotationsMock = vi.fn();
const integrationToolsGatewayUrlMock = vi.fn();
const executeRunStepMock = vi.fn();
const executeSetupStepMock = vi.fn();
const createStepLogStreamMock = vi.fn();
const createSessionLogStreamMock = vi.fn();
const executeAgentStepMock = vi.fn();

vi.mock('@shipfox/runner-protocol', () => ({
  requestNextStep: (...args: unknown[]) => requestNextStepMock(...args),
  requestAgentRuntimeConfig: (...args: unknown[]) => requestAgentRuntimeConfigMock(...args),
  requestStepSecrets: (...args: unknown[]) => requestStepSecretsMock(...args),
  reportStep: (...args: unknown[]) => reportStepMock(...args),
  appendStepLogs: (...args: unknown[]) => appendStepLogsMock(...args),
  writeStepAnnotations: (...args: unknown[]) => writeStepAnnotationsMock(...args),
  integrationToolsGatewayUrl: (...args: unknown[]) => integrationToolsGatewayUrlMock(...args),
  AgentRuntimeConfigRequestError,
  StepSecretsRequestError,
  HTTPError,
}));

vi.mock('@shipfox/runner-execution', () => ({
  executeRunStep: (...args: unknown[]) => executeRunStepMock(...args),
  executeSetupStep: (...args: unknown[]) => executeSetupStepMock(...args),
}));

vi.mock('@shipfox/runner-logs', async () => {
  const actual =
    await vi.importActual<typeof import('@shipfox/runner-logs')>('@shipfox/runner-logs');
  return {
    createStepLogStream: (...args: unknown[]) => createStepLogStreamMock(...args),
    createSessionLogStream: (...args: unknown[]) => createSessionLogStreamMock(...args),
    buildSecretVariants: actual.buildSecretVariants,
  };
});

vi.mock('@shipfox/runner-agent', () => ({
  executeAgentStep: (...args: unknown[]) => executeAgentStepMock(...args),
}));

vi.mock('@shipfox/runner-workspace', () => ({
  resolveWorkingDirectory: (cwd: string, workingDirectory: unknown) =>
    resolveWorkingDirectoryMock(cwd, workingDirectory),
}));

const {executeStep, pullNextStep, publishStepAnnotations, reportStepResult, runJobSteps} =
  await import('#core/step-loop.js');

const JOB_ID = '00000000-0000-0000-0000-0000000000aa';
const RUN_ID = '00000000-0000-0000-0000-0000000000ab';
const LOGS_DIR = '/runner-logs/job-1';
const GIT_CONFIG_PATH = '/runner-cred/job-1/git-cred.config';
const JOB_CONTEXT = {
  workflowRunId: '00000000-0000-0000-0000-000000000004',
  workflowRunAttemptId: RUN_ID,
  jobId: JOB_ID,
  jobExecutionId: '00000000-0000-0000-0000-0000000000ad',
};
const leaseClient = {} as never;
const leaseTokenSource = () => 'lease-current';
const integrationGatewayUrl = new URL(
  'https://api.example.test/runs/jobs/current/integration-tools/mcp',
);
const STREAM_LENGTH = 128;

// Ordered log of stream lifecycle events across all created streams, so tests can
// assert "prior attempt drained before the next opens".
let events: string[];
let createdStreams: Map<string, FakeStream[]>;

interface FakeStream {
  write: ReturnType<typeof vi.fn>;
  addSecrets: ReturnType<typeof vi.fn>;
  setRotatingSecrets: ReturnType<typeof vi.fn>;
  writeGroupStart: ReturnType<typeof vi.fn>;
  writeGroupEnd: ReturnType<typeof vi.fn>;
  writeGroup: ReturnType<typeof vi.fn>;
  writeOutputLine: ReturnType<typeof vi.fn>;
  writeEntry: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  drain: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

function makeFakeStream(
  label: string,
  drainOutcome: 'drained' | 'abandoned' = 'drained',
): FakeStream {
  const stream = {
    write: vi.fn(() => {
      events.push(`write:${label}`);
    }),
    addSecrets: vi.fn(() => {
      events.push(`secrets:${label}`);
    }),
    setRotatingSecrets: vi.fn(() => {
      events.push(`rotatingSecrets:${label}`);
    }),
    writeGroupStart: vi.fn(() => {
      events.push(`groupStart:${label}`);
    }),
    writeGroupEnd: vi.fn(() => {
      events.push(`groupEnd:${label}`);
    }),
    writeGroup: vi.fn(() => {
      events.push(`group:${label}`);
    }),
    writeOutputLine: vi.fn(() => {
      events.push(`line:${label}`);
    }),
    writeEntry: vi.fn(),
    close: vi.fn(() => {
      events.push(`close:${label}`);
      return Promise.resolve({streamLength: STREAM_LENGTH});
    }),
    drain: vi.fn(() => {
      events.push(`drain:${label}`);
      return Promise.resolve(drainOutcome);
    }),
    dispose: vi.fn(() => {
      events.push(`dispose:${label}`);
    }),
  };
  const prior = createdStreams.get(label) ?? [];
  prior.push(stream);
  createdStreams.set(label, prior);
  return stream;
}

function streamFor(stepId: string): FakeStream {
  const stream = createdStreams.get(stepId)?.at(-1);
  if (!stream) throw new Error(`No stream created for ${stepId}`);
  return stream;
}

function runLoop(params: {
  signal: AbortSignal;
  leaseToken?: () => string;
  secrets?: string[];
  cwd?: string;
  subscribeSecrets?: (subscriber: (secrets: string[]) => void) => () => void;
  onLeaseTokenAdopted?: (leaseToken: string) => void;
}): Promise<void> {
  return runJobSteps({
    jobId: JOB_ID,
    leaseClient,
    leaseToken: params.leaseToken ?? leaseTokenSource,
    secrets: params.secrets ?? [],
    ...(params.subscribeSecrets ? {subscribeSecrets: params.subscribeSecrets} : {}),
    signal: params.signal,
    cwd: params.cwd ?? '/work',
    gitConfigPath: GIT_CONFIG_PATH,
    logsDir: LOGS_DIR,
    jobContext: JOB_CONTEXT,
    ...(params.onLeaseTokenAdopted ? {onLeaseTokenAdopted: params.onLeaseTokenAdopted} : {}),
  });
}

describe('runJobSteps', () => {
  beforeEach(() => {
    requestNextStepMock.mockReset();
    requestAgentRuntimeConfigMock.mockReset();
    requestStepSecretsMock.mockReset();
    reportStepMock.mockReset();
    appendStepLogsMock.mockReset();
    writeStepAnnotationsMock.mockReset();
    integrationToolsGatewayUrlMock.mockReset();
    executeRunStepMock.mockReset();
    executeSetupStepMock.mockReset();
    createStepLogStreamMock.mockReset();
    createSessionLogStreamMock.mockReset();
    executeAgentStepMock.mockReset();
    resolveWorkingDirectoryMock.mockClear();
    requestAgentRuntimeConfigMock.mockResolvedValue({
      harness: 'pi',
      provider_id: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
      credentials: {api_key: 'sk-runtime-secret'},
    });
    requestStepSecretsMock.mockResolvedValue({secrets: []});
    integrationToolsGatewayUrlMock.mockReturnValue(integrationGatewayUrl);
    events = [];
    createdStreams = new Map();
    reportStepMock.mockResolvedValue({ok: true, cancel: false});
    writeStepAnnotationsMock.mockResolvedValue({
      status: 'written',
      annotationCount: 1,
      totalBodyBytes: 7,
    });
    // Setup succeeds by default; tests that exercise setup failure override it.
    executeSetupStepMock.mockResolvedValue({
      result: {success: true, error: null, exit_code: 0},
    });
    createStepLogStreamMock.mockImplementation((opts: {stepId: string}) => {
      events.push(`create:${opts.stepId}`);
      return makeFakeStream(opts.stepId);
    });
    createSessionLogStreamMock.mockImplementation((opts: {stepId: string}) => {
      events.push(`create:${opts.stepId}`);
      return makeFakeStream(opts.stepId);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs the setup step then a run step against the prepared cwd, reporting both', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    executeRunStepMock.mockResolvedValue({success: true, error: null, exit_code: 0});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(executeSetupStepMock).toHaveBeenCalledWith({
      cwd: '/work',
      gitConfigPath: GIT_CONFIG_PATH,
      leaseClient,
      signal: ac.signal,
      log: expect.any(Object),
      jobContext: JOB_CONTEXT,
    });
    expect(executeRunStepMock).toHaveBeenCalledWith(run, {
      signal: ac.signal,
      cwd: '/work',
      workspace: '/work',
      onCommandStart: expect.any(Function),
      onOutput: expect.any(Function),
    });
    expect(reportStepMock).toHaveBeenCalledWith(leaseClient, {
      stepId: run.id,
      attempt: 1,
      status: 'succeeded',
      error: null,
      exitCode: 0,
      logOutcome: 'drained',
      signal: ac.signal,
    });
    expect(requestNextStepMock).toHaveBeenCalledTimes(3);
  });

  it('reports run step outputs', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    executeRunStepMock.mockResolvedValue({
      success: true,
      outputs: {image_sha: 'sha-123'},
      error: null,
      exit_code: 0,
    });
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(reportStepMock).toHaveBeenCalledWith(leaseClient, {
      stepId: run.id,
      attempt: 1,
      status: 'succeeded',
      error: null,
      exitCode: 0,
      outputs: {image_sha: 'sha-123'},
      logOutcome: 'drained',
      signal: ac.signal,
    });
  });

  it('resolves a run step working directory relative to the job workspace', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep({config: {run: 'echo test', working_directory: 'api'}});
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    executeRunStepMock.mockResolvedValue({success: true, error: null, exit_code: 0});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(resolveWorkingDirectoryMock).toHaveBeenCalledWith('/work', 'api');
    expect(executeRunStepMock).toHaveBeenCalledWith(
      run,
      expect.objectContaining({cwd: '/work/api', workspace: '/work'}),
    );
  });

  it('reports a missing working directory without spawning the step', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep({config: {run: 'echo test', working_directory: 'missing'}});
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'failed'});
    resolveWorkingDirectoryMock.mockRejectedValueOnce(
      new Error('Working directory does not exist: missing'),
    );
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(executeRunStepMock).not.toHaveBeenCalled();
    expect(reportStepMock).toHaveBeenCalledWith(
      leaseClient,
      expect.objectContaining({
        stepId: run.id,
        status: 'failed',
        error: {message: 'Working directory does not exist: missing'},
      }),
    );
  });

  it('reports empty response strings instead of omitting them', async () => {
    const run = buildRunStep();
    const ac = new AbortController();

    await reportStepResult({
      leaseClient,
      step: run,
      attempt: 1,
      result: {success: true, response: '', error: null, exit_code: 0},
      logOutcome: 'drained',
      jobId: JOB_ID,
      jobExecutionId: JOB_CONTEXT.jobExecutionId,
      stepLabel: 'build',
      signal: ac.signal,
    });

    expect(reportStepMock).toHaveBeenCalledWith(leaseClient, {
      stepId: run.id,
      attempt: 1,
      status: 'succeeded',
      error: null,
      exitCode: 0,
      response: '',
      logOutcome: 'drained',
      signal: ac.signal,
    });
  });

  it('logs failed step identity and bounded error context', async () => {
    const error = vi.spyOn(logger(), 'error').mockImplementation(() => undefined);
    const run = buildRunStep();
    const ac = new AbortController();

    await reportStepResult({
      leaseClient,
      step: run,
      attempt: 3,
      result: {
        success: false,
        error: {
          reason: 'agent_config_invalid',
          agent_config_issue: 'provider_not_configured',
          message: 'x'.repeat(250),
        },
        exit_code: null,
      },
      logOutcome: 'drained',
      jobId: JOB_ID,
      jobExecutionId: JOB_CONTEXT.jobExecutionId,
      stepLabel: 'build',
      signal: ac.signal,
    });

    expect(error).toHaveBeenCalledWith(
      {
        jobId: JOB_ID,
        jobExecutionId: JOB_CONTEXT.jobExecutionId,
        stepId: run.id,
        stepName: run.name,
        attempt: 3,
        reason: 'agent_config_invalid',
        agentConfigIssue: 'provider_not_configured',
        message: 'x'.repeat(200),
      },
      'Step build failed',
    );
  });

  it('pullNextStep returns the step-scoped lease token', async () => {
    const setup = buildSetupStep();
    requestNextStepMock.mockResolvedValueOnce(stepResponse(setup, 4, 'lease-pulled'));
    const ac = new AbortController();

    const pulled = await pullNextStep({leaseClient, jobId: JOB_ID, signal: ac.signal});

    expect(pulled).toEqual({step: setup, attempt: 4, leaseToken: 'lease-pulled'});
  });

  it('adopts the pulled step lease token before opening the step log stream', async () => {
    const setup = buildSetupStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1, 'lease-step'))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    const ac = new AbortController();

    await runLoop({
      signal: ac.signal,
      onLeaseTokenAdopted: (leaseToken) => events.push(`adopt:${leaseToken}`),
    });

    expect(events.indexOf('adopt:lease-step')).toBeLessThan(events.indexOf(`create:${setup.id}`));
  });

  it('does not adopt a token for a done response', async () => {
    requestNextStepMock.mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    const onLeaseTokenAdopted = vi.fn();
    const ac = new AbortController();

    await runLoop({signal: ac.signal, onLeaseTokenAdopted});

    expect(onLeaseTokenAdopted).not.toHaveBeenCalled();
  });

  it('opens a per-attempt log stream for the run step and disposes it at the end', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 3))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    executeRunStepMock.mockResolvedValue({success: true, error: null, exit_code: 0});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(createStepLogStreamMock).toHaveBeenCalledWith({
      logsDir: LOGS_DIR,
      stepId: run.id,
      attempt: 3,
      secrets: [],
      append: expect.any(Function),
    });
    expect(createStepLogStreamMock).toHaveBeenCalledWith({
      logsDir: LOGS_DIR,
      stepId: setup.id,
      attempt: 1,
      secrets: [],
      append: expect.any(Function),
    });
    expect(createStepLogStreamMock).toHaveBeenCalledTimes(2);
    expect(events).toContain(`drain:${run.id}`);
    expect(events).toContain(`dispose:${run.id}`);
  });

  it('does not request step secrets when a run step has no secret bindings', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    executeRunStepMock.mockResolvedValue({success: true, error: null, exit_code: 0});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(requestStepSecretsMock).not.toHaveBeenCalled();
    expect(executeRunStepMock).toHaveBeenCalledWith(
      run,
      expect.not.objectContaining({
        secretEnv: expect.anything(),
        secretValues: expect.anything(),
      }),
    );
  });

  it('requests step secrets before opening the log stream and injects assembled env', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep({
      config: {
        run: 'echo "$TOKEN"',
        secret_bindings: [
          {
            target: 'TOKEN',
            segments: [
              {kind: 'literal', value: 'prefix-'},
              {kind: 'secret', store: 'local', key: 'API_TOKEN'},
            ],
          },
          {
            target: 'REUSED',
            segments: [{kind: 'secret', store: 'local', key: 'API_TOKEN'}],
          },
        ],
      },
    });
    requestStepSecretsMock.mockImplementation(() => {
      events.push('request-secrets');
      return Promise.resolve({
        secrets: [{store: 'local', key: 'API_TOKEN', value: 'runtime-secret'}],
      });
    });
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 2))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    executeRunStepMock.mockResolvedValue({success: true, error: null, exit_code: 0});
    const ac = new AbortController();

    await runLoop({signal: ac.signal, secrets: ['checkout-secret']});

    expect(requestStepSecretsMock).toHaveBeenCalledWith(leaseClient, {
      stepId: run.id,
      attempt: 2,
      signal: ac.signal,
    });
    expect(events.indexOf('request-secrets')).toBeLessThan(events.indexOf(`create:${run.id}`));
    expect(createStepLogStreamMock).toHaveBeenCalledWith({
      logsDir: LOGS_DIR,
      stepId: run.id,
      attempt: 2,
      secrets: ['checkout-secret', 'runtime-secret'],
      append: expect.any(Function),
    });
    expect(executeRunStepMock).toHaveBeenCalledWith(
      run,
      expect.objectContaining({
        secretEnv: {TOKEN: 'prefix-runtime-secret', REUSED: 'runtime-secret'},
        secretValues: ['runtime-secret'],
      }),
    );
  });

  it('fails the run step closed when a requested binding is absent from the response', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep({
      config: {
        run: 'echo "$TOKEN"',
        secret_bindings: [
          {
            target: 'TOKEN',
            segments: [{kind: 'secret', store: 'local', key: 'API_TOKEN'}],
          },
        ],
      },
    });
    requestStepSecretsMock.mockResolvedValueOnce({secrets: []});
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1));
    reportStepMock
      .mockResolvedValueOnce({ok: true, cancel: false})
      .mockResolvedValueOnce({ok: true, cancel: true});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(executeRunStepMock).not.toHaveBeenCalled();
    expect(createStepLogStreamMock).toHaveBeenCalledTimes(1);
    expect(reportStepMock).toHaveBeenCalledWith(
      leaseClient,
      expect.objectContaining({
        stepId: run.id,
        status: 'failed',
        error: {
          message: 'Run step secret response is missing a requested secret.',
          reason: 'config_unresolvable',
        },
      }),
    );
  });

  it('fails the run step closed when the secrets endpoint rejects the request', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep({
      config: {
        run: 'echo "$TOKEN"',
        secret_bindings: [
          {
            target: 'TOKEN',
            segments: [{kind: 'secret', store: 'local', key: 'API_TOKEN'}],
          },
        ],
      },
    });
    requestStepSecretsMock.mockRejectedValueOnce(
      new StepSecretsRequestError(422, 'secret-not-found'),
    );
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1));
    reportStepMock
      .mockResolvedValueOnce({ok: true, cancel: false})
      .mockResolvedValueOnce({ok: true, cancel: true});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(executeRunStepMock).not.toHaveBeenCalled();
    expect(reportStepMock).toHaveBeenCalledWith(
      leaseClient,
      expect.objectContaining({
        stepId: run.id,
        status: 'failed',
        error: {
          message: 'Step secrets request failed with status 422: secret-not-found.',
          reason: 'config_unresolvable',
        },
      }),
    );
  });

  it('routes captured output through the stream write sink', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    let captured: FakeStream | undefined;
    createStepLogStreamMock.mockImplementation((opts: {stepId: string}) => {
      captured = makeFakeStream(opts.stepId);
      return captured;
    });
    executeRunStepMock.mockImplementation(
      (_step, opts: {onOutput: (chunk: Buffer, src: string) => void}) => {
        opts.onOutput(Buffer.from('hello'), 'stdout');
        return Promise.resolve({success: true, error: null, exit_code: 0});
      },
    );
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(captured?.write).toHaveBeenCalledWith(Buffer.from('hello'), 'stdout');
  });

  it('writes command metadata before captured output', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep({config: {run: 'echo hello'}});
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    let captured: FakeStream | undefined;
    createStepLogStreamMock.mockImplementation((opts: {stepId: string}) => {
      captured = makeFakeStream(opts.stepId);
      return captured;
    });
    executeRunStepMock.mockImplementation(
      (
        _step,
        opts: {
          onCommandStart: (metadata: {
            command: string;
            shell: {display: string};
            cwd?: string;
          }) => void;
          onOutput: (chunk: Buffer, src: string) => void;
        },
      ) => {
        opts.onCommandStart({
          command: 'echo hello',
          shell: {display: 'bash --noprofile --norc -eo pipefail {0}'},
          cwd: '/work',
        });
        opts.onOutput(Buffer.from('hello'), 'stdout');
        return Promise.resolve({success: true, error: null, exit_code: 0});
      },
    );
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(captured?.writeGroup).toHaveBeenCalledWith({
      name: 'Run echo hello',
      lines: [
        'echo hello',
        'shell: bash --noprofile --norc -eo pipefail {0}',
        'working-directory: /work',
      ],
      source: 'stdout',
    });
    expect(events.indexOf(`group:${run.id}`)).toBeLessThan(events.indexOf(`write:${run.id}`));
  });

  it('runs and reports the step when opening the log stream fails (capture abandoned)', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    // Opening the run spool throws (e.g. a broken logs dir): capture must be abandoned, not fatal.
    createStepLogStreamMock
      .mockImplementationOnce((opts: {stepId: string}) => {
        events.push(`create:${opts.stepId}`);
        return makeFakeStream(opts.stepId);
      })
      .mockImplementationOnce(() => {
        throw new Error('logs dir is a file');
      });
    executeRunStepMock.mockResolvedValue({success: true, error: null, exit_code: 0});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(executeRunStepMock).toHaveBeenCalled();
    expect(reportStepMock).toHaveBeenCalledWith(
      leaseClient,
      expect.objectContaining({stepId: run.id, status: 'succeeded', logOutcome: 'abandoned'}),
    );
  });

  it('drains the stream before reporting and propagates an abandoned drain outcome', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    createStepLogStreamMock
      .mockImplementationOnce((opts: {stepId: string}) => {
        events.push(`create:${opts.stepId}`);
        return makeFakeStream(opts.stepId);
      })
      .mockImplementationOnce((opts: {stepId: string}) => {
        events.push(`create:${opts.stepId}`);
        return makeFakeStream(opts.stepId, 'abandoned');
      });
    executeRunStepMock.mockResolvedValue({success: true, error: null, exit_code: 0});
    reportStepMock.mockImplementation((_client, params: {stepId: string; logOutcome: string}) => {
      events.push(`report:${params.stepId}:${params.logOutcome}`);
      return Promise.resolve({ok: true, cancel: false});
    });
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(events.indexOf(`drain:${run.id}`)).toBeLessThan(
      events.indexOf(`report:${run.id}:abandoned`),
    );
    expect(reportStepMock).toHaveBeenCalledWith(
      leaseClient,
      expect.objectContaining({stepId: run.id, status: 'succeeded', logOutcome: 'abandoned'}),
    );
  });

  it('publishes run step annotations after log drain and before reporting the step', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    executeRunStepMock.mockResolvedValue({
      success: true,
      error: null,
      exit_code: 0,
      annotations: [{context: 'default', style: 'default', op: 'replace', body: 'summary'}],
    });
    writeStepAnnotationsMock.mockImplementation(() => {
      events.push(`annotations:${run.id}`);
      return Promise.resolve({status: 'written', annotationCount: 1, totalBodyBytes: 7});
    });
    reportStepMock.mockImplementation((_client, params: {stepId: string}) => {
      events.push(`report:${params.stepId}`);
      return Promise.resolve({ok: true, cancel: false});
    });
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(writeStepAnnotationsMock).toHaveBeenCalledWith(leaseClient, {
      stepId: run.id,
      attempt: 1,
      annotations: [{context: 'default', style: 'default', op: 'replace', body: 'summary'}],
      signal: ac.signal,
    });
    expect(events.indexOf(`drain:${run.id}`)).toBeLessThan(events.indexOf(`annotations:${run.id}`));
    expect(events.indexOf(`annotations:${run.id}`)).toBeLessThan(
      events.indexOf(`report:${run.id}`),
    );
  });

  it('does not publish when a result has no annotations', async () => {
    const run = buildRunStep();
    const ac = new AbortController();

    await publishStepAnnotations({
      leaseClient,
      step: run,
      attempt: 1,
      annotations: undefined,
      jobId: JOB_ID,
      signal: ac.signal,
    });

    expect(writeStepAnnotationsMock).not.toHaveBeenCalled();
  });

  it.each([
    [{status: 'capped', code: 'annotation-body-too-large'}],
    [{status: 'rejected', statusCode: 503, code: 'server-error'}],
  ])('warns and continues when annotation publishing returns %j', async (outcome) => {
    const warn = vi.spyOn(logger(), 'warn').mockImplementation(() => undefined);
    const run = buildRunStep();
    const ac = new AbortController();
    writeStepAnnotationsMock.mockResolvedValueOnce(outcome);

    await publishStepAnnotations({
      leaseClient,
      step: run,
      attempt: 1,
      annotations: [{context: 'default', style: 'default', op: 'replace', body: 'summary'}],
      jobId: JOB_ID,
      signal: ac.signal,
    });

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({outcome}),
      'Step annotations were not written; continuing step report',
    );
  });

  it('warns and continues when annotation publishing throws', async () => {
    const warn = vi.spyOn(logger(), 'warn').mockImplementation(() => undefined);
    const run = buildRunStep();
    const ac = new AbortController();
    writeStepAnnotationsMock.mockRejectedValueOnce(new Error('timeout'));

    await publishStepAnnotations({
      leaseClient,
      step: run,
      attempt: 1,
      annotations: [{context: 'default', style: 'default', op: 'replace', body: 'summary'}],
      jobId: JOB_ID,
      signal: ac.signal,
    });

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({jobId: JOB_ID, stepId: run.id, attempt: 1}),
      'Failed to publish step annotations; continuing step report',
    );
  });

  it('drains and disposes the prior attempt stream before opening the next', async () => {
    const setup = buildSetupStep();
    const run1 = buildRunStep({id: '00000000-0000-0000-0000-0000000000c1', position: 1});
    const run2 = buildRunStep({id: '00000000-0000-0000-0000-0000000000c2', position: 2});
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run1, 1))
      .mockResolvedValueOnce(stepResponse(run2, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    executeRunStepMock.mockResolvedValue({success: true, error: null, exit_code: 0});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(events.indexOf(`dispose:${run1.id}`)).toBeLessThan(events.indexOf(`create:${run2.id}`));
    expect(events).toContain(`dispose:${run2.id}`);
  });

  it('drains the prior stream before requesting the next step, not after', async () => {
    const setup = buildSetupStep();
    const run1 = buildRunStep({id: '00000000-0000-0000-0000-0000000000d1', position: 1});
    const run2 = buildRunStep({id: '00000000-0000-0000-0000-0000000000d2', position: 2});
    // Record each pull in the ordered event log so we can assert it relative to the drain.
    const responses = [
      stepResponse(setup, 1),
      stepResponse(run1, 1),
      stepResponse(run2, 1),
      {kind: 'done', status: 'succeeded'},
    ];
    let pull = 0;
    requestNextStepMock.mockImplementation(() => {
      events.push(`pull:${pull}`);
      return Promise.resolve(responses[pull++]);
    });
    executeRunStepMock.mockResolvedValue({success: true, error: null, exit_code: 0});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    // pull index 2 is the request that claims run2. run1's stream must be disposed before it,
    // so a slow drain delays only the (unclaimed) pull, never a freshly claimed step.
    expect(events.indexOf(`dispose:${run1.id}`)).toBeLessThan(events.indexOf('pull:2'));
  });

  it('drains and disposes the stream on abort, without reporting', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1));
    const ac = new AbortController();
    executeRunStepMock.mockImplementationOnce(() => {
      ac.abort();
      return Promise.resolve({success: true, error: null, exit_code: 0});
    });

    await runLoop({signal: ac.signal});

    // Setup completed and was reported; the aborted run step is not.
    const reportedSteps = reportStepMock.mock.calls.map((call) => call[1].stepId);
    expect(reportedSteps).not.toContain(run.id);
    expect(events).toContain(`drain:${run.id}`);
    expect(events).toContain(`dispose:${run.id}`);
  });

  it('reports the setup step failed with its reason, then stops on cancel:true (no user step runs)', async () => {
    const setup = buildSetupStep();
    const error = {message: 'mkdir denied', reason: 'workspace_prep_failed' as const};
    requestNextStepMock.mockResolvedValueOnce(stepResponse(setup, 1));
    executeSetupStepMock.mockResolvedValueOnce({
      result: {success: false, error, exit_code: null},
    });
    reportStepMock.mockResolvedValueOnce({ok: true, cancel: true});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(reportStepMock).toHaveBeenCalledWith(leaseClient, {
      stepId: setup.id,
      attempt: 1,
      status: 'failed',
      error,
      exitCode: null,
      logOutcome: 'drained',
      signal: ac.signal,
    });
    expect(executeRunStepMock).not.toHaveBeenCalled();
    expect(createStepLogStreamMock).toHaveBeenCalledWith({
      logsDir: LOGS_DIR,
      stepId: setup.id,
      attempt: 1,
      secrets: [],
      append: expect.any(Function),
    });
    expect(events).toContain(`drain:${setup.id}`);
    expect(events).toContain(`dispose:${setup.id}`);
    expect(requestNextStepMock).toHaveBeenCalledTimes(1);
  });

  it('fails a run step dispatched before setup without spawning it', async () => {
    const run = buildRunStep();
    requestNextStepMock.mockResolvedValueOnce(stepResponse(run, 1));
    reportStepMock.mockResolvedValueOnce({ok: true, cancel: true});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(executeSetupStepMock).not.toHaveBeenCalled();
    expect(executeRunStepMock).not.toHaveBeenCalled();
    expect(createStepLogStreamMock).not.toHaveBeenCalled();
    expect(reportStepMock).toHaveBeenCalledWith(leaseClient, {
      stepId: run.id,
      attempt: 1,
      status: 'failed',
      error: {message: 'Run step dispatched before setup prepared the workspace'},
      exitCode: null,
      logOutcome: 'drained',
      signal: ac.signal,
    });
  });

  it('stops immediately when there are no steps', async () => {
    requestNextStepMock.mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(executeSetupStepMock).not.toHaveBeenCalled();
    expect(reportStepMock).not.toHaveBeenCalled();
  });

  it('stops without throwing on a 404 from next', async () => {
    requestNextStepMock.mockRejectedValueOnce(buildHTTPError(404));
    const ac = new AbortController();

    await expect(runLoop({signal: ac.signal})).resolves.toBeUndefined();

    expect(executeSetupStepMock).not.toHaveBeenCalled();
    expect(reportStepMock).not.toHaveBeenCalled();
  });

  it('rethrows non-404 errors from next (loop bails, no re-pull)', async () => {
    requestNextStepMock.mockRejectedValueOnce(buildHTTPError(500));
    const ac = new AbortController();

    await expect(runLoop({signal: ac.signal})).rejects.toThrow();

    expect(requestNextStepMock).toHaveBeenCalledTimes(1);
  });

  it('reports a failed run step with its exit_code after setup, then stops on cancel:true', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep();
    const error = {message: 'Command exited with code 1', exit_code: 1};
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1));
    executeRunStepMock.mockResolvedValueOnce({success: false, error, exit_code: 1});
    reportStepMock
      .mockResolvedValueOnce({ok: true, cancel: false})
      .mockResolvedValueOnce({ok: true, cancel: true});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(reportStepMock).toHaveBeenCalledWith(leaseClient, {
      stepId: run.id,
      attempt: 1,
      status: 'failed',
      error,
      exitCode: 1,
      logOutcome: 'drained',
      signal: ac.signal,
    });
    expect(requestNextStepMock).toHaveBeenCalledTimes(2);
    const stream = streamFor(run.id);
    expect(stream.writeOutputLine).toHaveBeenCalledWith(
      'Process completed with exit code 1.',
      'stderr',
    );
    expect(events.indexOf(`line:${run.id}`)).toBeLessThan(events.indexOf(`close:${run.id}`));
  });

  it('masks run step output values with the full secret set before reporting', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1));
    executeRunStepMock.mockResolvedValueOnce({
      success: true,
      error: null,
      exit_code: 0,
      outputs: {token: 'checkout-secret'},
    });
    reportStepMock
      .mockResolvedValueOnce({ok: true, cancel: false})
      .mockResolvedValueOnce({ok: true, cancel: true});
    const ac = new AbortController();

    await runLoop({signal: ac.signal, secrets: ['checkout-secret']});

    expect(reportStepMock).toHaveBeenCalledWith(
      leaseClient,
      expect.objectContaining({
        stepId: run.id,
        outputs: {token: '***'},
      }),
    );
  });

  it('masks run step annotation bodies with the full secret set before publishing', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1));
    executeRunStepMock.mockResolvedValueOnce({
      success: true,
      error: null,
      exit_code: 0,
      annotations: [
        {context: 'default', style: 'default', op: 'replace', body: 'checkout-secret'},
        {context: 'old', style: 'default', op: 'remove'},
      ],
    });
    reportStepMock
      .mockResolvedValueOnce({ok: true, cancel: false})
      .mockResolvedValueOnce({ok: true, cancel: true});
    const ac = new AbortController();

    await runLoop({signal: ac.signal, secrets: ['checkout-secret']});

    expect(writeStepAnnotationsMock).toHaveBeenCalledWith(
      leaseClient,
      expect.objectContaining({
        stepId: run.id,
        annotations: [
          {context: 'default', style: 'default', op: 'replace', body: '***'},
          {context: 'old', style: 'default', op: 'remove'},
        ],
      }),
    );
  });

  it('strips URL credentials from run step output values when no secrets are configured', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1));
    executeRunStepMock.mockResolvedValueOnce({
      success: true,
      error: null,
      exit_code: 0,
      outputs: {remote: 'https://user:pass@example.test/repo.git'},
    });
    reportStepMock
      .mockResolvedValueOnce({ok: true, cancel: false})
      .mockResolvedValueOnce({ok: true, cancel: true});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(reportStepMock).toHaveBeenCalledWith(
      leaseClient,
      expect.objectContaining({
        stepId: run.id,
        outputs: {remote: 'https://***@example.test/repo.git'},
      }),
    );
  });

  it('masks run step failure messages before reporting', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1));
    executeRunStepMock.mockResolvedValueOnce({
      success: false,
      error: {message: 'failed with checkout-secret', exit_code: 1},
      exit_code: 1,
    });
    reportStepMock
      .mockResolvedValueOnce({ok: true, cancel: false})
      .mockResolvedValueOnce({ok: true, cancel: true});
    const ac = new AbortController();

    await runLoop({signal: ac.signal, secrets: ['checkout-secret']});

    expect(reportStepMock).toHaveBeenCalledWith(
      leaseClient,
      expect.objectContaining({
        stepId: run.id,
        error: {message: 'failed with ***', exit_code: 1},
      }),
    );
  });

  it('writes terminal signal context for a failed run step before closing the stream', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep();
    const error = {message: 'Killed by signal SIGKILL', exit_code: null, signal: 'SIGKILL'};
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 1));
    executeRunStepMock.mockResolvedValueOnce({success: false, error, exit_code: null});
    reportStepMock
      .mockResolvedValueOnce({ok: true, cancel: false})
      .mockResolvedValueOnce({ok: true, cancel: true});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    const stream = streamFor(run.id);
    expect(stream.writeOutputLine).toHaveBeenCalledWith(
      'Process terminated by signal SIGKILL.',
      'stderr',
    );
    expect(events.indexOf(`line:${run.id}`)).toBeLessThan(events.indexOf(`close:${run.id}`));
  });

  it('reports the step failed when executeRunStep throws (no leaked error, no hung step)', async () => {
    const setup = buildSetupStep();
    const run = buildRunStep({
      config: {
        run: 'echo "$TOKEN"',
        secret_bindings: [
          {
            target: 'TOKEN',
            segments: [{kind: 'secret', store: 'local', key: 'API_TOKEN'}],
          },
        ],
      },
    });
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(run, 2));
    requestStepSecretsMock.mockResolvedValueOnce({
      secrets: [{store: 'local', key: 'API_TOKEN', value: 'runtime-secret'}],
    });
    executeRunStepMock.mockRejectedValueOnce(
      new Error('ENOSPC: runtime-secret could not be written'),
    );
    reportStepMock
      .mockResolvedValueOnce({ok: true, cancel: false})
      .mockResolvedValueOnce({ok: true, cancel: true});
    const ac = new AbortController();

    await expect(runLoop({signal: ac.signal})).resolves.toBeUndefined();

    expect(reportStepMock).toHaveBeenCalledWith(leaseClient, {
      stepId: run.id,
      attempt: 2,
      status: 'failed',
      error: {message: 'ENOSPC: *** could not be written'},
      exitCode: null,
      logOutcome: 'drained',
      signal: ac.signal,
    });
    const stream = streamFor(run.id);
    expect(stream.writeOutputLine).toHaveBeenCalledWith(
      'Process failed: ENOSPC: *** could not be written',
      'stderr',
    );
  });

  it('does not report when the signal aborts during setup', async () => {
    const setup = buildSetupStep();
    const ac = new AbortController();
    requestNextStepMock.mockResolvedValueOnce(stepResponse(setup, 1));
    executeSetupStepMock.mockImplementationOnce(() => {
      ac.abort();
      return Promise.resolve({result: {success: true, error: null, exit_code: 0}});
    });

    await runLoop({signal: ac.signal});

    expect(executeSetupStepMock).toHaveBeenCalledTimes(1);
    expect(reportStepMock).not.toHaveBeenCalled();
  });

  it('does nothing when the signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();

    await runLoop({signal: ac.signal});

    expect(requestNextStepMock).not.toHaveBeenCalled();
  });

  it('dispatches an agent step to executeAgentStep against the prepared cwd, reporting it', async () => {
    const setup = buildSetupStep();
    const agent = buildAgentStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(agent, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    executeAgentStepMock.mockResolvedValue({success: true, error: null, exit_code: 0});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(executeAgentStepMock).toHaveBeenCalledWith(agent, {
      signal: ac.signal,
      cwd: '/work',
      logsDir: LOGS_DIR,
      runtime: {
        harness: 'pi',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
        credentials: {api_key: 'sk-runtime-secret'},
      },
      leaseToken: leaseTokenSource,
      integrationToolsGatewayUrl: integrationGatewayUrl,
      onSessionEntry: expect.any(Function),
    });
    expect(requestAgentRuntimeConfigMock).toHaveBeenCalledWith(leaseClient, {
      stepId: agent.id,
      attempt: 1,
      signal: ac.signal,
    });
    expect(executeRunStepMock).not.toHaveBeenCalled();
    expect(reportStepMock).toHaveBeenCalledWith(leaseClient, {
      stepId: agent.id,
      attempt: 1,
      status: 'succeeded',
      error: null,
      exitCode: 0,
      logOutcome: 'drained',
      signal: ac.signal,
    });
  });

  it('dispatches an agent step in its configured working directory', async () => {
    const setup = buildSetupStep();
    const agent = buildAgentStep({
      config: {
        model: 'claude-opus-4-8',
        thinking: 'high',
        prompt: 'Fix it.',
        working_directory: 'api',
      },
    });
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(agent, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    executeAgentStepMock.mockResolvedValue({success: true, error: null, exit_code: 0});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(resolveWorkingDirectoryMock).toHaveBeenCalledWith('/work', 'api');
    expect(executeAgentStepMock).toHaveBeenCalledWith(
      agent,
      expect.objectContaining({cwd: '/work/api'}),
    );
  });

  it('passes the setup ambient git config path to agent steps', async () => {
    const setup = buildSetupStep();
    const agent = buildAgentStep();
    executeSetupStepMock.mockResolvedValueOnce({
      result: {success: true, error: null, exit_code: 0},
      ambientGitConfigPath: GIT_CONFIG_PATH,
    });
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(agent, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    executeAgentStepMock.mockResolvedValue({success: true, error: null, exit_code: 0});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(executeAgentStepMock).toHaveBeenCalledWith(
      agent,
      expect.objectContaining({gitConfigGlobal: GIT_CONFIG_PATH}),
    );
  });

  it('uses provider, model, and thinking from runtime config instead of stale step config', async () => {
    const setup = buildSetupStep();
    const agent = buildAgentStep({
      config: {
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
        prompt: 'Fix it.',
      },
    });
    requestAgentRuntimeConfigMock.mockResolvedValueOnce({
      harness: 'pi',
      provider_id: 'openai',
      model: 'gpt-5.1',
      thinking: 'medium',
      credentials: {api_key: 'sk-openai-runtime'},
    });
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(agent, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    executeAgentStepMock.mockResolvedValue({success: true, error: null, exit_code: 0});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(executeAgentStepMock).toHaveBeenCalledWith(
      agent,
      expect.objectContaining({
        runtime: {
          harness: 'pi',
          provider: 'openai',
          model: 'gpt-5.1',
          thinking: 'medium',
          credentials: {api_key: 'sk-openai-runtime'},
        },
      }),
    );
  });

  it('forwards custom provider runtime config and masks secret header credentials', async () => {
    const setup = buildSetupStep();
    const agent = buildAgentStep();
    const customProvider = {
      api: 'openai-responses' as const,
      base_url: 'https://models.example.test/v1',
      headers: [{name: 'x-plain', value: 'plain'}],
      secret_header_names: ['x-secret'],
      models: [{id: 'custom-gpt', label: 'Custom GPT'}],
      requires_api_key: true,
    };
    requestAgentRuntimeConfigMock.mockResolvedValueOnce({
      harness: 'pi',
      provider_id: 'workspace-models',
      model: 'custom-gpt',
      thinking: 'medium',
      credentials: {
        api_key: 'sk-custom',
        'header:x-secret': 'secret-header',
      },
      custom_provider: customProvider,
    });
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(agent, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    executeAgentStepMock.mockResolvedValue({success: true, error: null, exit_code: 0});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(executeAgentStepMock).toHaveBeenCalledWith(
      agent,
      expect.objectContaining({
        runtime: {
          harness: 'pi',
          provider: 'workspace-models',
          model: 'custom-gpt',
          thinking: 'medium',
          credentials: {
            api_key: 'sk-custom',
            'header:x-secret': 'secret-header',
          },
          custom_provider: customProvider,
        },
      }),
    );
    expect(createSessionLogStreamMock).toHaveBeenCalledWith(
      expect.objectContaining({
        secrets: ['sk-custom', 'secret-header'],
      }),
    );
  });

  it('opens a session stream for an agent step, forwards entries, and settles it', async () => {
    const setup = buildSetupStep();
    const agent = buildAgentStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(agent, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    const sessionStream = makeFakeStream(agent.id);
    createSessionLogStreamMock.mockReturnValue(sessionStream);
    executeAgentStepMock.mockImplementation(
      (_step: StepDto, opts: {onSessionEntry?: (line: string) => void}) => {
        opts.onSessionEntry?.('{"type":"message","id":"a"}');
        return Promise.resolve({success: true, error: null, exit_code: 0});
      },
    );
    const ac = new AbortController();

    await runLoop({signal: ac.signal, secrets: ['s3cr3t']});

    expect(createSessionLogStreamMock).toHaveBeenCalledWith({
      logsDir: LOGS_DIR,
      stepId: agent.id,
      attempt: 1,
      secrets: ['s3cr3t', 'sk-runtime-secret'],
      append: expect.any(Function),
    });
    expect(sessionStream.writeEntry).toHaveBeenCalledWith('{"type":"message","id":"a"}');
    expect(sessionStream.close).toHaveBeenCalled();
    expect(sessionStream.drain).toHaveBeenCalled();
    expect(sessionStream.dispose).toHaveBeenCalled();
  });

  it('runs and reports an agent step when opening the session stream fails (capture abandoned)', async () => {
    const setup = buildSetupStep();
    const agent = buildAgentStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(agent, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'succeeded'});
    // Opening the session spool throws (e.g. a broken logs dir): capture must be abandoned, not
    // fatal to the step, and the agent runs without a session sink (no onSessionEntry).
    createSessionLogStreamMock.mockImplementationOnce(() => {
      throw new Error('logs dir is a file');
    });
    executeAgentStepMock.mockResolvedValue({success: true, error: null, exit_code: 0});
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(executeAgentStepMock).toHaveBeenCalledWith(agent, {
      signal: ac.signal,
      cwd: '/work',
      logsDir: LOGS_DIR,
      runtime: {
        harness: 'pi',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
        credentials: {api_key: 'sk-runtime-secret'},
      },
      leaseToken: leaseTokenSource,
      integrationToolsGatewayUrl: integrationGatewayUrl,
    });
    expect(reportStepMock).toHaveBeenCalledWith(
      leaseClient,
      expect.objectContaining({stepId: agent.id, status: 'succeeded', logOutcome: 'abandoned'}),
    );
  });

  it('does not report the agent step when the signal aborts mid-run', async () => {
    const setup = buildSetupStep();
    const agent = buildAgentStep();
    const ac = new AbortController();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(agent, 1));
    executeAgentStepMock.mockImplementationOnce(() => {
      ac.abort();
      return Promise.resolve({
        success: false,
        error: {message: 'Agent step aborted', reason: 'agent_invocation_failed' as const},
        exit_code: null,
      });
    });

    await runLoop({signal: ac.signal});

    expect(executeAgentStepMock).toHaveBeenCalledTimes(1);
    // Only the setup step is reported; the aborted agent step is not.
    expect(reportStepMock).toHaveBeenCalledTimes(1);
    expect(reportStepMock).not.toHaveBeenCalledWith(
      leaseClient,
      expect.objectContaining({stepId: agent.id}),
    );
  });

  it('redacts runtime credential values from agent failures and responses', async () => {
    const agent = buildAgentStep();
    const hexCredential = Buffer.from('sk-runtime-secret').toString('hex');
    executeAgentStepMock.mockResolvedValue({
      success: false,
      response: 'provider echoed sk-runtime-secret',
      error: {
        message: `provider rejected sk-runtime-secret and ${hexCredential}`,
        reason: 'agent_invocation_failed' as const,
      },
      exit_code: null,
    });
    const ac = new AbortController();

    const execution = await executeStep({
      step: agent,
      attempt: 1,
      cwd: '/work',
      logsDir: LOGS_DIR,
      jobContext: JOB_CONTEXT,
      leaseClient,
      leaseToken: leaseTokenSource,
      secrets: [],
      signal: ac.signal,
      workspacePrepared: true,
      gitConfigPath: GIT_CONFIG_PATH,
      jobId: JOB_ID,
      stepLabel: 'implement',
    });

    expect(execution.result).toEqual({
      success: false,
      response: 'provider echoed ***',
      error: {
        message: 'provider rejected *** and ***',
        reason: 'agent_invocation_failed',
      },
      exit_code: null,
    });
  });

  it('redacts runtime credential values from successful agent response and outputs', async () => {
    const agent = buildAgentStep();
    executeAgentStepMock.mockResolvedValue({
      success: true,
      response: 'provider echoed sk-runtime-secret',
      outputs: {summary: 'used sk-runtime-secret'},
      error: null,
      exit_code: 0,
    });
    const ac = new AbortController();

    const execution = await executeStep({
      step: agent,
      attempt: 1,
      cwd: '/work',
      logsDir: LOGS_DIR,
      jobContext: JOB_CONTEXT,
      leaseClient,
      leaseToken: leaseTokenSource,
      secrets: [],
      signal: ac.signal,
      workspacePrepared: true,
      gitConfigPath: GIT_CONFIG_PATH,
      jobId: JOB_ID,
      stepLabel: 'implement',
    });

    expect(execution.result).toEqual({
      success: true,
      response: 'provider echoed ***',
      outputs: {summary: 'used ***'},
      error: null,
      exit_code: 0,
    });
  });

  it('reports agent config issues when runtime credentials are rejected by the API', async () => {
    const setup = buildSetupStep();
    const agent = buildAgentStep();
    requestNextStepMock
      .mockResolvedValueOnce(stepResponse(setup, 1))
      .mockResolvedValueOnce(stepResponse(agent, 1))
      .mockResolvedValueOnce({kind: 'done', status: 'failed'});
    requestAgentRuntimeConfigMock.mockRejectedValueOnce(
      new AgentRuntimeConfigRequestError(
        409,
        'model-provider-not-configured',
        'provider_not_configured',
      ),
    );
    const ac = new AbortController();

    await runLoop({signal: ac.signal});

    expect(executeAgentStepMock).not.toHaveBeenCalled();
    expect(reportStepMock).toHaveBeenCalledWith(
      leaseClient,
      expect.objectContaining({
        stepId: agent.id,
        status: 'failed',
        error: expect.objectContaining({
          reason: 'agent_config_invalid',
          agent_config_issue: 'provider_not_configured',
        }),
      }),
    );
  });
});

function buildSetupStep(overrides: Partial<StepDto> = {}): StepDto {
  return buildStep({
    id: '00000000-0000-0000-0000-0000000000b0',
    name: 'Set up job',
    type: 'setup',
    config: {},
    position: 0,
    ...overrides,
  });
}

function buildRunStep(overrides: Partial<StepDto> = {}): StepDto {
  return buildStep({position: 1, ...overrides});
}

function buildAgentStep(overrides: Partial<StepDto> = {}): StepDto {
  return buildStep({
    id: '00000000-0000-0000-0000-0000000000c0',
    name: 'implement',
    type: 'agent',
    config: {model: 'claude-opus-4-8', thinking: 'high', prompt: 'Fix it.'},
    position: 1,
    ...overrides,
  });
}

function buildStep(overrides: Partial<StepDto> = {}): StepDto {
  const name =
    typeof overrides.name === 'string' && overrides.name.trim() ? overrides.name : 'test-step';
  return {
    id: '00000000-0000-0000-0000-000000000001',
    job_execution_id: '00000000-0000-0000-0000-000000000003',
    key: 'test-step',
    name,
    source_location: null,
    status: 'running',
    type: 'run',
    config: {run: 'echo test'},
    error: null,
    position: 0,
    current_attempt: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function stepResponse(
  step: StepDto,
  attempt: number,
  leaseToken = `lease-${step.id}-${attempt}`,
): NextStepResponseDto {
  return {kind: 'step', step, attempt, lease_token: leaseToken};
}

function buildHTTPError(status: number): HTTPError {
  const response = {status} as Response;
  const request = {} as Request;
  const options = {} as ConstructorParameters<typeof HTTPError>[2];
  return new HTTPError(response, request, options);
}
