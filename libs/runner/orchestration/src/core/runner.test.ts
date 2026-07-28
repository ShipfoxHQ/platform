vi.mock('#config.js', () => ({
  config: {
    SHIPFOX_POLL_INTERVAL_MS: 1,
    SHIPFOX_POLL_MAX_INTERVAL_MS: 5,
    SHIPFOX_POLL_MAX_DURATION_MS: 1,
    SHIPFOX_HEARTBEAT_INTERVAL_MS: 10_000,
    SHIPFOX_HEARTBEAT_MAX_STALE_MS: 10_000,
    SHIPFOX_RUNNER_PROVIDER_KIND: 'ec2',
    SHIPFOX_RUNNER_PROTOCOL_VERSION: '1',
  },
}));

const {interruptibleSleepMock} = vi.hoisted(() => ({
  interruptibleSleepMock: vi.fn(async (_ms: number, _signal: AbortSignal) => undefined),
}));
vi.mock('@shipfox/node-resilient-loop', async (importActual) => ({
  ...(await importActual<typeof import('@shipfox/node-resilient-loop')>()),
  interruptibleSleep: interruptibleSleepMock,
}));

vi.mock('#core/heartbeat-loop.js', () => ({
  startHeartbeatLoop: vi.fn(() => ({stop: vi.fn(), bumpGeneration: vi.fn()})),
}));

vi.mock('@shipfox/runner-workspace', async (importActual) => ({
  ...(await importActual<typeof import('@shipfox/runner-workspace')>()),
  cleanupJobCredentials: vi.fn(),
  cleanupJobLogs: vi.fn(),
  jobCredentialsPath: vi.fn(),
  jobWorkspacePath: vi.fn(),
  jobLogsPath: vi.fn(),
  cleanupWorkspace: vi.fn(),
  resolveWorkspaceRootFromEnv: vi.fn(),
}));

vi.mock('#core/step-loop.js', () => ({
  runJobSteps: vi.fn(),
}));

const {isPiExtensionAvailableMock} = vi.hoisted(() => ({
  isPiExtensionAvailableMock: vi.fn((_params: {packageName: string}) => true),
}));

vi.mock('@shipfox/runner-agent', () => ({
  runnerToolCapabilities: vi.fn(() => ({
    harnesses: {
      pi: {tools: ['read']},
    },
  })),
  isPiExtensionAvailable: isPiExtensionAvailableMock,
  PI_HARNESS_EXTENSION_PACKAGE_NAMES: ['pi-web-access', 'pi-mcp-adapter'],
}));

vi.mock('@shipfox/runner-protocol', () => ({
  registerRunnerSession: vi.fn(),
  consumeManagedRunnerBootstrapToken: vi.fn(),
  managedRunnerEnrollmentConfig: vi.fn(() => ({providerKind: 'ec2', protocolVersion: '1'})),
  exchangeRunnerBootstrapToken: vi.fn(),
  enrollRunnerControlSession: vi.fn(),
  heartbeatRunnerControlSession: vi.fn(),
  pollRunnerAssignment: vi.fn(),
  requireRunnerLabels: vi.fn(),
  requestJob: vi.fn(),
  runnerStartupMode: vi.fn(() => 'direct'),
  createLeaseClient: vi.fn(() => ({}) as never),
  runnerRegistrationToken: vi.fn(() => 'sf_mrt_runner-registration-token'),
  RunnerLabelsRequiredError: class RunnerLabelsRequiredError extends Error {},
  RunnerSessionExhaustedError: class RunnerSessionExhaustedError extends Error {},
  HTTPError: class HTTPError extends Error {
    response: {status: number};

    constructor(status = 500) {
      super(`HTTP ${status}`);
      this.response = {status};
    }
  },
}));

import {logger} from '@shipfox/node-opentelemetry';
import {interruptibleSleep} from '@shipfox/node-resilient-loop';
import {runnerToolCapabilities} from '@shipfox/runner-agent';
import {
  consumeManagedRunnerBootstrapToken,
  createLeaseClient,
  enrollRunnerControlSession,
  exchangeRunnerBootstrapToken,
  HTTPError,
  heartbeatRunnerControlSession,
  pollRunnerAssignment,
  RunnerLabelsRequiredError,
  RunnerSessionExhaustedError,
  registerRunnerSession,
  requestJob,
  requireRunnerLabels,
  runnerStartupMode,
} from '@shipfox/runner-protocol';
import {
  cleanupJobCredentials,
  cleanupJobLogs,
  cleanupWorkspace,
  InvalidJobIdError,
  jobCredentialsPath,
  jobLogsPath,
  jobWorkspacePath,
  resolveWorkspaceRootFromEnv,
  UnsafeWorkspaceRootError,
} from '@shipfox/runner-workspace';
import {TimeoutError} from 'ky';
import {config as runnerConfig} from '#config.js';
import {startHeartbeatLoop} from '#core/heartbeat-loop.js';
import {nextPollDeadline, runJob, startRunner} from '#core/runner.js';
import {runJobSteps} from '#core/step-loop.js';

const mockJobWorkspacePath = vi.mocked(jobWorkspacePath);
const mockJobLogsPath = vi.mocked(jobLogsPath);
const mockJobCredentialsPath = vi.mocked(jobCredentialsPath);
const mockCleanupWorkspace = vi.mocked(cleanupWorkspace);
const mockCleanupJobLogs = vi.mocked(cleanupJobLogs);
const mockCleanupJobCredentials = vi.mocked(cleanupJobCredentials);
const mockResolveWorkspaceRoot = vi.mocked(resolveWorkspaceRootFromEnv);
const mockRunJobSteps = vi.mocked(runJobSteps);
const mockCreateLeaseClient = vi.mocked(createLeaseClient);
const mockRegisterRunnerSession = vi.mocked(registerRunnerSession);
const mockConsumeManagedRunnerBootstrapToken = vi.mocked(consumeManagedRunnerBootstrapToken);
const mockExchangeRunnerBootstrapToken = vi.mocked(exchangeRunnerBootstrapToken);
const mockEnrollRunnerControlSession = vi.mocked(enrollRunnerControlSession);
const mockHeartbeatRunnerControlSession = vi.mocked(heartbeatRunnerControlSession);
const mockPollRunnerAssignment = vi.mocked(pollRunnerAssignment);
const mockRequireRunnerLabels = vi.mocked(requireRunnerLabels);
const mockRunnerStartupMode = vi.mocked(runnerStartupMode);
const mockRequestJob = vi.mocked(requestJob);
const mockStartHeartbeatLoop = vi.mocked(startHeartbeatLoop);
const mockRunnerToolCapabilities = vi.mocked(runnerToolCapabilities);
const mockInterruptibleSleep = vi.mocked(interruptibleSleep);

const JOB = {
  workflow_run_id: '00000000-0000-0000-0000-000000000004',
  workflow_run_attempt_id: '00000000-0000-0000-0000-000000000002',
  job_id: '00000000-0000-0000-0000-000000000001',
  job_execution_id: '00000000-0000-0000-0000-000000000003',
  job_name: 'test-job',
  steps: [],
  lease_token: 'lease-token',
} as Parameters<typeof runJob>[0];

const WORKSPACE_ROOT = '/tmp/shipfox-test-root';
const JOB_CWD = '/tmp/shipfox-test-root/job-1';
const JOB_LOGS_DIR = '/tmp/shipfox-test-root/.shipfox-runner-logs/job-1';
const JOB_CREDENTIALS_DIR = '/tmp/shipfox-test-root/.shipfox-runner-cred/job-1';
const JOB_GIT_CONFIG_PATH = `${JOB_CREDENTIALS_DIR}/git-cred.config`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  setPollConfig({interval: 1, maxInterval: 5, maxDuration: 1});
  mockResolveWorkspaceRoot.mockReturnValue(WORKSPACE_ROOT);
  isPiExtensionAvailableMock.mockReturnValue(true);
  mockRequireRunnerLabels.mockReturnValue(['local']);
  mockRunnerStartupMode.mockReturnValue('direct');
  mockConsumeManagedRunnerBootstrapToken.mockReturnValue('sf_rbt_bootstrap-token');
  mockRegisterRunnerSession.mockResolvedValue({
    session_id: '00000000-0000-0000-0000-000000000003',
    session_token: 'session-token',
    mode: 'manual',
    max_claims: null,
  });
  mockJobWorkspacePath.mockReturnValue(JOB_CWD);
  mockJobLogsPath.mockReturnValue(JOB_LOGS_DIR);
  mockJobCredentialsPath.mockReturnValue(JOB_CREDENTIALS_DIR);
  mockRunJobSteps.mockResolvedValue();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('runJob', () => {
  it('runs the step loop with the per-job cwd and lease client, then cleans up', async () => {
    mockJobWorkspacePath.mockReturnValue(JOB_CWD);
    mockJobLogsPath.mockReturnValue(JOB_LOGS_DIR);
    mockJobCredentialsPath.mockReturnValue(JOB_CREDENTIALS_DIR);
    mockRunJobSteps.mockResolvedValue();

    await runJob(JOB, WORKSPACE_ROOT);

    expect(mockStartHeartbeatLoop).toHaveBeenCalledWith(
      JOB.job_id,
      expect.any(Function),
      expect.any(AbortController),
      expect.objectContaining({
        intervalMs: 10_000,
        maxStaleMs: 10_000,
        getToolCapabilities: runnerToolCapabilities,
      }),
    );
    const leaseTokenSource = mockCreateLeaseClient.mock.calls[0]?.[0];
    expect(leaseTokenSource).toEqual(expect.any(Function));
    expect(mockRunJobSteps.mock.calls[0]?.[0].leaseToken).toEqual(expect.any(Function));
    expect(mockRunJobSteps).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: JOB.job_id,
        cwd: JOB_CWD,
        gitConfigPath: JOB_GIT_CONFIG_PATH,
        logsDir: JOB_LOGS_DIR,
        jobContext: {
          workflowRunId: JOB.workflow_run_id,
          workflowRunAttemptId: JOB.workflow_run_attempt_id,
          jobId: JOB.job_id,
          jobExecutionId: JOB.job_execution_id,
        },
      }),
    );
    expect(mockCleanupWorkspace).toHaveBeenCalledWith(JOB_CWD);
    expect(mockCleanupJobLogs).toHaveBeenCalledWith(JOB_LOGS_DIR);
    expect(mockCleanupJobCredentials).toHaveBeenNthCalledWith(1, JOB_CREDENTIALS_DIR);
    expect(mockCleanupJobCredentials).toHaveBeenNthCalledWith(2, JOB_CREDENTIALS_DIR);
  });

  it('rotates the lease token used by step requests and redaction', async () => {
    mockJobWorkspacePath.mockReturnValue(JOB_CWD);
    mockJobLogsPath.mockReturnValue(JOB_LOGS_DIR);
    mockJobCredentialsPath.mockReturnValue(JOB_CREDENTIALS_DIR);
    const observedSecrets: string[][] = [];
    mockRunJobSteps.mockImplementation((params) => {
      params.subscribeSecrets?.((secrets) => observedSecrets.push(secrets));
      return Promise.resolve();
    });

    await runJob(JOB, WORKSPACE_ROOT);

    const leaseTokenSource = mockCreateLeaseClient.mock.calls[0]?.[0];
    const stepParams = mockRunJobSteps.mock.calls[0]?.[0];
    const stepLeaseTokenSource = stepParams?.leaseToken as (() => string) | undefined;
    expect(typeof leaseTokenSource).toBe('function');
    expect(typeof stepLeaseTokenSource).toBe('function');
    expect((leaseTokenSource as () => string)()).toBe(JOB.lease_token);
    expect(stepLeaseTokenSource?.()).toBe(JOB.lease_token);
    expect(stepParams?.secrets).toEqual(['sf_mrt_runner-registration-token', JOB.lease_token]);
    const heartbeatOptions = mockStartHeartbeatLoop.mock.calls[0]?.[3];
    heartbeatOptions?.onLeaseTokenRenewed?.('lease-next');
    expect((leaseTokenSource as () => string)()).toBe('lease-next');
    expect(stepLeaseTokenSource?.()).toBe('lease-next');
    heartbeatOptions?.onLeaseTokenRenewed?.('lease-third');
    heartbeatOptions?.onLeaseTokenRenewed?.('lease-fourth');

    expect((leaseTokenSource as () => string)()).toBe('lease-fourth');
    expect(observedSecrets).toEqual([
      ['lease-next'],
      ['lease-next', 'lease-third'],
      ['lease-third', 'lease-fourth'],
    ]);
    expect(stepParams?.secrets).toEqual([
      'sf_mrt_runner-registration-token',
      JOB.lease_token,
      'lease-third',
      'lease-fourth',
    ]);
  });

  it('adopts next-step lease tokens for requests, redaction, and heartbeat generation', async () => {
    const heartbeatHandle = {stop: vi.fn(), bumpGeneration: vi.fn()};
    mockStartHeartbeatLoop.mockReturnValueOnce(heartbeatHandle);
    mockJobWorkspacePath.mockReturnValue(JOB_CWD);
    mockJobLogsPath.mockReturnValue(JOB_LOGS_DIR);

    await runJob(JOB, WORKSPACE_ROOT);

    const leaseTokenSource = mockCreateLeaseClient.mock.calls[0]?.[0];
    const stepParams = mockRunJobSteps.mock.calls[0]?.[0];
    const stepLeaseTokenSource = stepParams?.leaseToken as (() => string) | undefined;
    expect(typeof leaseTokenSource).toBe('function');
    expect(typeof stepLeaseTokenSource).toBe('function');

    stepParams?.onLeaseTokenAdopted?.('lease-step-scoped');

    expect((leaseTokenSource as () => string)()).toBe('lease-step-scoped');
    expect(stepLeaseTokenSource?.()).toBe('lease-step-scoped');
    expect(stepParams?.secrets).toEqual([
      'sf_mrt_runner-registration-token',
      JOB.lease_token,
      'lease-step-scoped',
    ]);
    expect(heartbeatHandle.bumpGeneration).toHaveBeenCalledTimes(1);
  });

  it('cleans up the per-job cwd when the step loop throws', async () => {
    mockJobWorkspacePath.mockReturnValue(JOB_CWD);
    mockJobLogsPath.mockReturnValue(JOB_LOGS_DIR);
    mockJobCredentialsPath.mockReturnValue(JOB_CREDENTIALS_DIR);
    mockRunJobSteps.mockRejectedValue(new Error('aborted'));

    await runJob(JOB, WORKSPACE_ROOT);

    expect(mockCleanupWorkspace).toHaveBeenCalledWith(JOB_CWD);
    expect(mockCleanupJobLogs).toHaveBeenCalledWith(JOB_LOGS_DIR);
    expect(mockCleanupJobCredentials).toHaveBeenNthCalledWith(1, JOB_CREDENTIALS_DIR);
    expect(mockCleanupJobCredentials).toHaveBeenNthCalledWith(2, JOB_CREDENTIALS_DIR);
  });

  it('skips the job without running the loop or cleaning up when the job id is invalid', async () => {
    mockJobWorkspacePath.mockImplementation(() => {
      throw new InvalidJobIdError(JOB.job_id);
    });

    await runJob(JOB, WORKSPACE_ROOT);

    expect(mockRunJobSteps).not.toHaveBeenCalled();
    expect(mockCleanupWorkspace).not.toHaveBeenCalled();
    expect(mockCleanupJobLogs).not.toHaveBeenCalled();
    expect(mockCleanupJobCredentials).not.toHaveBeenCalled();
  });
});

describe('startRunner', () => {
  it('warns once when required Pi extensions are unavailable', async () => {
    const warn = vi.spyOn(logger(), 'warn').mockImplementation(() => undefined);
    isPiExtensionAvailableMock.mockImplementation(
      ({packageName}: {packageName: string}) => packageName === 'pi-web-access',
    );
    mockRequestJob.mockRejectedValue(new RunnerSessionExhaustedError());

    await startRunner();
    await startRunner();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      {packageNames: ['pi-mcp-adapter']},
      'Required Pi extensions are unavailable; functionality may be degraded',
    );
  });

  it('exits before polling when the workspace root is unsafe', async () => {
    mockResolveWorkspaceRoot.mockImplementation(() => {
      throw new UnsafeWorkspaceRootError('/');
    });

    await expect(startRunner()).rejects.toThrow(UnsafeWorkspaceRootError);
    expect(mockRegisterRunnerSession).not.toHaveBeenCalled();
    expect(mockRequestJob).not.toHaveBeenCalled();
  });

  it('exits before polling when runner labels are empty', async () => {
    mockRequireRunnerLabels.mockImplementation(() => {
      throw new RunnerLabelsRequiredError();
    });

    await expect(startRunner()).rejects.toThrow(RunnerLabelsRequiredError);
    expect(mockRegisterRunnerSession).not.toHaveBeenCalled();
    expect(mockRequestJob).not.toHaveBeenCalled();
  });

  it('resolves cleanly when no jobs arrive before the poll deadline', async () => {
    mockRequestJob.mockResolvedValue(null);
    vi.spyOn(Date, 'now').mockImplementation(() =>
      mockRequestJob.mock.calls.length === 0 ? 0 : 2,
    );

    await startRunner();

    expect(mockRegisterRunnerSession).toHaveBeenCalledTimes(1);
    expect(mockRegisterRunnerSession).toHaveBeenCalledWith({
      capabilities: {harnesses: {pi: {tools: ['read']}}},
    });
    expect(mockRunnerToolCapabilities).toHaveBeenCalled();
    expect(mockRequestJob).toHaveBeenCalledTimes(1);
    expect(mockRunJobSteps).not.toHaveBeenCalled();
  });

  it('rejects when poll errors continue past the poll deadline', async () => {
    const pollError = new Error('api unavailable');
    mockRequestJob.mockRejectedValue(pollError);
    vi.spyOn(Date, 'now').mockImplementation(() =>
      mockRequestJob.mock.calls.length === 0 ? 0 : 2,
    );

    await expect(startRunner()).rejects.toBe(pollError);
    expect(mockRegisterRunnerSession).toHaveBeenCalledTimes(1);
    expect(mockRequestJob).toHaveBeenCalledTimes(1);
  });

  it('resolves cleanly when the runner session is exhausted', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    mockRequestJob.mockRejectedValue(new RunnerSessionExhaustedError());

    await startRunner();

    expect(mockRegisterRunnerSession).toHaveBeenCalledTimes(1);
    expect(mockRequestJob).toHaveBeenCalledTimes(1);
  });

  it('enrolls, waits, activates, and uses the activation session for managed runners', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    vi.stubEnv('SHIPFOX_RUNNER_BOOTSTRAP_TOKEN', 'sf_rbt_bootstrap-token');
    vi.stubEnv('SHIPFOX_RUNNER_PROVIDER_KIND', 'ec2');
    vi.stubEnv('SHIPFOX_RUNNER_PROTOCOL_VERSION', '1');
    mockRunnerStartupMode.mockReturnValue('managed');
    mockConsumeManagedRunnerBootstrapToken.mockReturnValue('sf_rbt_bootstrap-token');
    mockExchangeRunnerBootstrapToken.mockImplementation(() => {
      expect(mockInterruptibleSleep).not.toHaveBeenCalled();
      return Promise.resolve({controlSessionToken: 'control-token'});
    });
    mockEnrollRunnerControlSession.mockResolvedValue(null);
    mockHeartbeatRunnerControlSession.mockResolvedValue();
    mockPollRunnerAssignment.mockResolvedValue('activation-token');
    mockRequestJob.mockRejectedValue(new RunnerSessionExhaustedError());

    await startRunner();

    expect(mockConsumeManagedRunnerBootstrapToken).toHaveBeenCalledTimes(1);
    expect(mockExchangeRunnerBootstrapToken).toHaveBeenCalledWith('sf_rbt_bootstrap-token');
    expect(mockEnrollRunnerControlSession).toHaveBeenCalledWith({
      controlSessionToken: 'control-token',
      capabilities: {harnesses: {pi: {tools: ['read']}}},
      providerKind: 'ec2',
      protocolVersion: '1',
    });
    expect(mockHeartbeatRunnerControlSession).toHaveBeenCalledWith(
      'control-token',
      expect.any(AbortSignal),
    );
    expect(mockPollRunnerAssignment).toHaveBeenCalledWith('control-token', expect.any(AbortSignal));
    expect(mockRegisterRunnerSession).toHaveBeenCalledWith({
      capabilities: {harnesses: {pi: {tools: ['read']}}},
      registrationToken: 'activation-token',
    });
    expect(mockRequestJob).toHaveBeenCalledWith('session-token');
    expect(mockInterruptibleSleep).toHaveBeenCalledTimes(1);
  });

  it('backs off before retrying a managed assignment poll that returns no token', async () => {
    vi.stubEnv('SHIPFOX_RUNNER_BOOTSTRAP_TOKEN', 'sf_rbt_bootstrap-token');
    vi.stubEnv('SHIPFOX_RUNNER_PROVIDER_KIND', 'ec2');
    vi.stubEnv('SHIPFOX_RUNNER_PROTOCOL_VERSION', '1');
    mockRunnerStartupMode.mockReturnValue('managed');
    mockExchangeRunnerBootstrapToken.mockResolvedValue({controlSessionToken: 'control-token'});
    mockEnrollRunnerControlSession.mockResolvedValue(null);
    mockHeartbeatRunnerControlSession.mockResolvedValue();
    mockPollRunnerAssignment.mockResolvedValueOnce(null).mockResolvedValueOnce('activation-token');
    mockRequestJob.mockRejectedValue(new RunnerSessionExhaustedError());

    await startRunner();

    expect(mockPollRunnerAssignment).toHaveBeenCalledTimes(2);
    expect(mockInterruptibleSleep.mock.calls.map(([ms]) => ms)).toEqual([1, 0]);
  });

  it('retries a timed-out managed assignment poll and activates after a later assignment', async () => {
    vi.stubEnv('SHIPFOX_RUNNER_BOOTSTRAP_TOKEN', 'sf_rbt_bootstrap-token');
    vi.stubEnv('SHIPFOX_RUNNER_PROVIDER_KIND', 'ec2');
    vi.stubEnv('SHIPFOX_RUNNER_PROTOCOL_VERSION', '1');
    mockRunnerStartupMode.mockReturnValue('managed');
    mockExchangeRunnerBootstrapToken.mockResolvedValue({controlSessionToken: 'control-token'});
    mockEnrollRunnerControlSession.mockResolvedValue(null);
    mockHeartbeatRunnerControlSession.mockResolvedValue();
    mockPollRunnerAssignment
      .mockRejectedValueOnce(new TimeoutError(new Request('http://example.test')))
      .mockResolvedValueOnce('activation-token');
    mockRequestJob.mockRejectedValue(new RunnerSessionExhaustedError());

    await startRunner();

    expect(mockPollRunnerAssignment).toHaveBeenCalledTimes(2);
    expect(mockRegisterRunnerSession).toHaveBeenCalledWith({
      capabilities: {harnesses: {pi: {tools: ['read']}}},
      registrationToken: 'activation-token',
    });
  });

  it('surfaces heartbeat failures during a managed assignment retry backoff', async () => {
    vi.useFakeTimers();
    const heartbeatError = new Error('heartbeat failed');
    vi.stubEnv('SHIPFOX_RUNNER_BOOTSTRAP_TOKEN', 'sf_rbt_bootstrap-token');
    vi.stubEnv('SHIPFOX_RUNNER_PROVIDER_KIND', 'ec2');
    vi.stubEnv('SHIPFOX_RUNNER_PROTOCOL_VERSION', '1');
    mockRunnerStartupMode.mockReturnValue('managed');
    mockExchangeRunnerBootstrapToken.mockResolvedValue({controlSessionToken: 'control-token'});
    mockEnrollRunnerControlSession.mockResolvedValue(null);
    mockHeartbeatRunnerControlSession.mockResolvedValueOnce().mockRejectedValueOnce(heartbeatError);
    mockPollRunnerAssignment.mockResolvedValue(null);
    mockInterruptibleSleep.mockImplementationOnce(
      async (_ms, signal) =>
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), {once: true}),
        ),
    );

    try {
      const runner = startRunner();
      const expectation = expect(runner).rejects.toBe(heartbeatError);
      await vi.advanceTimersByTimeAsync(10_000);

      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses an activation token returned by enrollment without polling for assignment', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    vi.stubEnv('SHIPFOX_RUNNER_BOOTSTRAP_TOKEN', 'sf_rbt_bootstrap-token');
    vi.stubEnv('SHIPFOX_RUNNER_PROVIDER_KIND', 'ec2');
    vi.stubEnv('SHIPFOX_RUNNER_PROTOCOL_VERSION', '1');
    mockRunnerStartupMode.mockReturnValue('managed');
    mockExchangeRunnerBootstrapToken.mockResolvedValue({controlSessionToken: 'control-token'});
    mockEnrollRunnerControlSession.mockResolvedValue('enrollment-activation-token');
    mockRegisterRunnerSession.mockResolvedValue({
      session_id: '00000000-0000-0000-0000-000000000003',
      session_token: 'session-token',
      mode: 'activation',
      max_claims: 1,
    });
    mockRequestJob.mockRejectedValue(new RunnerSessionExhaustedError());

    await startRunner();

    expect(mockPollRunnerAssignment).not.toHaveBeenCalled();
    expect(mockRegisterRunnerSession).toHaveBeenCalledWith({
      capabilities: {harnesses: {pi: {tools: ['read']}}},
      registrationToken: 'enrollment-activation-token',
    });
  });

  it('retries a failed first direct registration', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    mockRegisterRunnerSession
      .mockRejectedValueOnce(new Error('api unavailable'))
      .mockResolvedValueOnce({
        session_id: '00000000-0000-0000-0000-000000000003',
        session_token: 'session-token',
        mode: 'manual',
        max_claims: null,
      });
    mockRequestJob.mockRejectedValue(new RunnerSessionExhaustedError());

    await startRunner();

    expect(mockRegisterRunnerSession).toHaveBeenCalledTimes(2);
    expect(mockRequestJob).toHaveBeenCalledTimes(1);
  });

  it('exits cleanly when shutdown aborts the managed assignment poll', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    mockRunnerStartupMode.mockReturnValue('managed');
    mockExchangeRunnerBootstrapToken.mockResolvedValue({controlSessionToken: 'control-token'});
    mockEnrollRunnerControlSession.mockResolvedValue(null);
    mockHeartbeatRunnerControlSession.mockResolvedValue();
    mockPollRunnerAssignment.mockImplementation(async (_controlSessionToken, signal) => {
      process.emit('SIGTERM');
      await Promise.reject(new DOMException('The operation was aborted', 'AbortError'));
      return signal?.aborted ? null : 'activation-token';
    });

    await expect(startRunner()).resolves.toBeUndefined();

    expect(mockRegisterRunnerSession).not.toHaveBeenCalled();
    expect(mockRequestJob).not.toHaveBeenCalled();
  });

  it('registers a new session when the current session is unauthorized', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    mockRequestJob
      .mockRejectedValueOnce(httpError(401))
      .mockRejectedValueOnce(new RunnerSessionExhaustedError());

    await startRunner();

    expect(mockRegisterRunnerSession).toHaveBeenCalledTimes(2);
    expect(mockRequestJob).toHaveBeenCalledTimes(2);
  });

  it('rejects when unauthorized responses continue past the poll deadline', async () => {
    const unauthorized = httpError(401);
    mockRequestJob.mockRejectedValue(unauthorized);
    vi.spyOn(Date, 'now').mockImplementation(() => (mockRequestJob.mock.calls.length < 2 ? 0 : 2));

    await expect(startRunner()).rejects.toBe(unauthorized);
    expect(mockRegisterRunnerSession).toHaveBeenCalledTimes(2);
    expect(mockRequestJob).toHaveBeenCalledTimes(2);
  });

  it('resets the poll deadline after completing a job', async () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(3)
      .mockReturnValue(3);
    mockRequestJob
      .mockResolvedValueOnce(JOB)
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new RunnerSessionExhaustedError());

    await startRunner();

    expect(mockRunJobSteps).toHaveBeenCalledTimes(1);
    expect(mockRequestJob).toHaveBeenCalledTimes(3);
  });

  it('does not register duplicate signal handlers across repeated starts', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(0);
    mockRequestJob.mockRejectedValue(new RunnerSessionExhaustedError());
    const sigintListeners = process.listenerCount('SIGINT');
    const sigtermListeners = process.listenerCount('SIGTERM');

    await startRunner();
    await startRunner();

    expect(process.listenerCount('SIGINT')).toBeLessThanOrEqual(sigintListeners + 1);
    expect(process.listenerCount('SIGTERM')).toBeLessThanOrEqual(sigtermListeners + 1);
  });
});

describe('poll helpers', () => {
  it('computes a poll deadline from the configured max duration', () => {
    vi.spyOn(Date, 'now').mockReturnValue(41);

    const deadline = nextPollDeadline();

    expect(deadline).toBe(42);
  });

  it('disables the poll deadline when max duration is zero', () => {
    setPollConfig({maxDuration: 0});

    const deadline = nextPollDeadline();

    expect(deadline).toBeUndefined();
  });
});

function httpError(status: number): InstanceType<typeof HTTPError> {
  const error = Object.create(HTTPError.prototype) as InstanceType<typeof HTTPError>;
  Object.assign(error, {response: new Response(null, {status})});
  return error;
}

function setPollConfig(values: {
  interval?: number;
  maxInterval?: number;
  maxDuration?: number;
}): void {
  const mutableConfig = runnerConfig as {
    SHIPFOX_POLL_INTERVAL_MS: number;
    SHIPFOX_POLL_MAX_INTERVAL_MS: number;
    SHIPFOX_POLL_MAX_DURATION_MS: number;
  };

  if (values.interval !== undefined) mutableConfig.SHIPFOX_POLL_INTERVAL_MS = values.interval;
  if (values.maxInterval !== undefined)
    mutableConfig.SHIPFOX_POLL_MAX_INTERVAL_MS = values.maxInterval;
  if (values.maxDuration !== undefined)
    mutableConfig.SHIPFOX_POLL_MAX_DURATION_MS = values.maxDuration;
}
