import {join} from 'node:path';
import {logger} from '@shipfox/node-opentelemetry';
import {
  withJitter as applyJitter,
  nextBackoffInterval as calculateNextBackoffInterval,
  createGracefulShutdownController,
  interruptibleSleep,
} from '@shipfox/node-resilient-loop';
import {
  isPiExtensionAvailable,
  PI_HARNESS_EXTENSION_PACKAGE_NAMES,
  runnerToolCapabilities,
} from '@shipfox/runner-agent';
import {
  consumeManagedRunnerBootstrapToken,
  createLeaseClient,
  enrollRunnerControlSession,
  exchangeRunnerBootstrapToken,
  HTTPError,
  heartbeatRunnerControlSession,
  managedRunnerEnrollmentConfig,
  pollRunnerAssignment,
  RunnerSessionExhaustedError,
  registerRunnerSession,
  requestJob,
  requireRunnerLabels,
  runnerRegistrationToken,
  runnerStartupMode,
} from '@shipfox/runner-protocol';
import {
  cleanupJobCredentials,
  cleanupJobLogs,
  cleanupOrphanedJobLogs,
  cleanupWorkspace,
  jobCredentialsPath,
  jobLogsPath,
  jobWorkspacePath,
  resolveWorkspaceRootFromEnv,
} from '@shipfox/runner-workspace';
import {isTimeoutError} from 'ky';
import {config} from '#config.js';
import {createBootTimelineCollector} from '#core/boot-timeline.js';
import {startHeartbeatLoop} from '#core/heartbeat-loop.js';
import {runJobSteps} from '#core/step-loop.js';

let running = true;
let warnedAboutUnavailablePiExtensions = false;
let bootTimelineReported = false;
const bootTimeline = createBootTimelineCollector();
// Module-level so the long-lived SIGINT handler can reach the in-flight job's
// controller; locally-scoped capture isn't possible from a process-global handler.
let currentJobAbortController: AbortController | undefined;
type RunnerSession = Awaited<ReturnType<typeof registerRunnerSession>>;
const shutdownController = createGracefulShutdownController({
  onFirstSignal: (signal) => {
    running = false;
    logger().info({signal}, 'Shutting down gracefully, waiting for current job to finish...');
  },
  onSecondSignal: (signal) => {
    logger().info({signal}, 'Second signal received, aborting current job');
    currentJobAbortController?.abort('shutdown');
    process.exit(1);
  },
});

export async function startRunner(): Promise<void> {
  running = true;
  shutdownController.reset();
  shutdownController.start();

  // Fail fast at startup: a dangerous root should crash the process at deploy,
  // not silently fail every job.
  const workspaceRoot = resolveWorkspaceRootFromEnv();
  await cleanupOrphanedJobLogs(workspaceRoot);
  requireRunnerLabels();
  warnAboutUnavailablePiExtensions();
  const startupMode = runnerStartupMode();

  logger().info(
    {
      pollInterval: config.SHIPFOX_POLL_INTERVAL_MS,
      pollMaxDuration: config.SHIPFOX_POLL_MAX_DURATION_MS,
      workspaceRoot,
    },
    'Runner started',
  );

  let currentInterval = config.SHIPFOX_POLL_INTERVAL_MS;
  let runnerSession: RunnerSession | undefined;
  if (startupMode === 'managed') {
    runnerSession = await initializeManagedRunnerSession();
    if (!runnerSession) return;
  } else {
    await interruptableSleep(withJitter(config.SHIPFOX_POLL_INTERVAL_MS));
  }
  let pollDeadline = nextPollDeadline();

  while (running) {
    try {
      if (!runnerSession) {
        runnerSession = await registerRunnerSession({capabilities: runnerToolCapabilities()});
        logger().info({runnerSessionId: runnerSession.session_id}, 'Runner session registered');
      }

      const job = await requestJob(runnerSession.session_token, shutdownController.signal);

      if (!job) {
        if (hasPollDeadlinePassed(pollDeadline)) {
          logger().info('No jobs available before the poll deadline; runner exiting');
          return;
        }
        currentInterval = nextBackoffInterval(currentInterval);
        logger().debug({interval: currentInterval}, 'No jobs available, backing off');
        await interruptableSleep(withJitter(currentInterval));
        continue;
      }

      if (!running) return;

      logger().info(
        {
          workflowRunId: job.workflow_run_id,
          workflowRunAttemptId: job.workflow_run_attempt_id,
          jobId: job.job_id,
          jobExecutionId: job.job_execution_id,
        },
        'Job claimed',
      );

      await runJob(job, workspaceRoot);
      currentInterval = config.SHIPFOX_POLL_INTERVAL_MS;
      pollDeadline = nextPollDeadline();
    } catch (pollError) {
      if (!running) return;

      if (isUnauthorized(pollError)) {
        if (startupMode === 'managed') {
          logger().info('Activated runner session rejected; runner exiting');
          return;
        }
        runnerSession = undefined;
        logger().info('Runner session rejected; registering a new session');
        if (hasPollDeadlinePassed(pollDeadline)) {
          logger().error({err: pollError}, 'Runner session rejected past the poll deadline');
          throw pollError;
        }
        currentInterval = nextBackoffInterval(currentInterval);
        await interruptableSleep(withJitter(currentInterval));
        continue;
      }
      if (pollError instanceof RunnerSessionExhaustedError) {
        logger().info('Runner session exhausted; runner exiting');
        return;
      }
      if (hasPollDeadlinePassed(pollDeadline)) {
        logger().error({err: pollError}, 'Poll cycle failed past the poll deadline');
        throw pollError;
      }
      logger().error({err: pollError}, 'Poll cycle failed');
      currentInterval = nextBackoffInterval(currentInterval);
      await interruptableSleep(withJitter(currentInterval));
    }
  }

  logger().info('Runner stopped');
}

function warnAboutUnavailablePiExtensions(): void {
  if (warnedAboutUnavailablePiExtensions) return;

  const unavailablePackages = PI_HARNESS_EXTENSION_PACKAGE_NAMES.filter(
    (packageName) => !isPiExtensionAvailable({packageName}),
  );
  if (unavailablePackages.length === 0) return;

  warnedAboutUnavailablePiExtensions = true;
  logger().warn(
    {packageNames: unavailablePackages},
    'Required Pi extensions are unavailable; functionality may be degraded',
  );
}

export function nextBackoffInterval(ms: number): number {
  return calculateNextBackoffInterval(ms, {maxMs: config.SHIPFOX_POLL_MAX_INTERVAL_MS});
}

export function withJitter(ms: number): number {
  return applyJitter(ms);
}

export function nextPollDeadline(): number | undefined {
  if (config.SHIPFOX_POLL_MAX_DURATION_MS === 0) return undefined;
  return Date.now() + config.SHIPFOX_POLL_MAX_DURATION_MS;
}

export async function runJob(
  job: Awaited<ReturnType<typeof requestJob>> & object,
  workspaceRoot: string,
): Promise<void> {
  // The path is deterministic, so compute it up front for cleanup on every exit
  // path; the setup step (position 0) creates the directory. An invalid job id is
  // an internal/claim error: bail before starting any per-job resources.
  let cwd: string;
  let logsDir: string;
  let credentialsDir: string;
  try {
    cwd = jobWorkspacePath(job.job_id, workspaceRoot);
    logsDir = jobLogsPath(job.job_id, workspaceRoot);
    credentialsDir = jobCredentialsPath(job.job_id, workspaceRoot);
  } catch (error) {
    logger().error({err: error, jobId: job.job_id}, 'Invalid job id; skipping job');
    return;
  }
  const gitConfigPath = join(credentialsDir, 'git-cred.config');

  const ac = new AbortController();
  currentJobAbortController = ac;

  const runnerSecret = runnerRegistrationToken();
  const initialLeaseToken = job.lease_token;
  let currentLeaseToken = initialLeaseToken;
  let previousRenewedLeaseToken: string | undefined;
  let currentRenewedLeaseToken: string | undefined;
  const runnerSecrets = runnerSecret.length > 0 ? [runnerSecret] : [];
  const secrets = [...runnerSecrets, initialLeaseToken];
  const leaseTokenSecretSubscribers = new Set<(secrets: string[]) => void>();
  const rotatingLeaseSecrets = () =>
    [previousRenewedLeaseToken, currentRenewedLeaseToken].filter(
      (secret): secret is string => secret !== undefined,
    );
  const rememberLeaseToken = (leaseToken: string) => {
    if (leaseToken === currentLeaseToken) return;
    previousRenewedLeaseToken = currentRenewedLeaseToken;
    currentRenewedLeaseToken = leaseToken;
    currentLeaseToken = leaseToken;
    secrets.splice(
      0,
      secrets.length,
      ...runnerSecrets,
      initialLeaseToken,
      ...rotatingLeaseSecrets(),
    );
    for (const subscriber of leaseTokenSecretSubscribers) subscriber(rotatingLeaseSecrets());
  };

  const heartbeatLoop = startHeartbeatLoop(job.job_id, () => currentLeaseToken, ac, {
    intervalMs: config.SHIPFOX_HEARTBEAT_INTERVAL_MS,
    maxStaleMs: config.SHIPFOX_HEARTBEAT_MAX_STALE_MS,
    getToolCapabilities: runnerToolCapabilities,
    onLeaseTokenRenewed: rememberLeaseToken,
  });

  try {
    await cleanupJobCredentials(credentialsDir);

    const leaseClient = createLeaseClient(() => currentLeaseToken);
    await runJobSteps({
      jobId: job.job_id,
      leaseClient,
      leaseToken: () => currentLeaseToken,
      secrets,
      subscribeSecrets: (subscriber) => {
        leaseTokenSecretSubscribers.add(subscriber);
        return () => leaseTokenSecretSubscribers.delete(subscriber);
      },
      signal: ac.signal,
      cwd,
      gitConfigPath,
      logsDir,
      jobContext: {
        workflowRunId: job.workflow_run_id,
        workflowRunAttemptId: job.workflow_run_attempt_id,
        jobId: job.job_id,
        jobExecutionId: job.job_execution_id,
      },
      onLeaseTokenAdopted: (leaseToken) => {
        rememberLeaseToken(leaseToken);
        heartbeatLoop.bumpGeneration();
      },
    });
    logger().info({jobId: job.job_id}, 'Job step loop finished');
  } catch (stepLoopError) {
    // A non-retryable error surfaced (e.g. an unexpected throw from the loop).
    // Bail this job; the lease expires server-side and the outer poll moves on.
    // Do not re-pull (would re-execute). Setup failures do NOT reach here: they
    // report through the step protocol and finalize the job.
    logger().error({err: stepLoopError, jobId: job.job_id}, 'Job step loop failed');
  } finally {
    heartbeatLoop.stop();
    if (currentJobAbortController === ac) currentJobAbortController = undefined;
    await cleanupJobCredentials(credentialsDir);
    await cleanupWorkspace(cwd);
    await cleanupJobLogs(logsDir);
  }
}

async function initializeManagedRunnerSession(): Promise<RunnerSession | undefined> {
  const bootstrapToken = consumeManagedRunnerBootstrapToken();
  const exchanged = await exchangeRunnerBootstrapToken(bootstrapToken);
  const controlSessionToken = exchanged.controlSessionToken;
  const enrollmentConfig = managedRunnerEnrollmentConfig();
  const enrollmentActivationToken = await enrollRunnerControlSession({
    controlSessionToken,
    capabilities: runnerToolCapabilities(),
    providerKind: enrollmentConfig.providerKind,
    protocolVersion: enrollmentConfig.protocolVersion,
  });
  if (!bootTimelineReported) {
    bootTimelineReported = true;
    logger().info(
      bootTimeline.createEvent(bootTimeline.captureEnrollment()),
      'runner.boot_timeline',
    );
  }
  const activationToken =
    enrollmentActivationToken ?? (await waitForRunnerActivation(controlSessionToken));
  if (!activationToken) return undefined;

  const runnerSession = await registerRunnerSession({
    capabilities: runnerToolCapabilities(),
    registrationToken: activationToken,
  });
  logger().info({runnerSessionId: runnerSession.session_id}, 'Managed runner activated');
  return runnerSession;
}

async function waitForRunnerActivation(controlSessionToken: string): Promise<string | undefined> {
  const controller = new AbortController();
  const abortOnShutdown = () => controller.abort();
  shutdownController.signal.addEventListener('abort', abortOnShutdown, {once: true});
  let heartbeatError: unknown;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  const heartbeat = async () => {
    try {
      await heartbeatRunnerControlSession(controlSessionToken, controller.signal);
    } catch (error) {
      heartbeatError = error;
      controller.abort();
    }
  };
  try {
    await heartbeat();
    if (!running) return undefined;
    if (heartbeatError) return handleControlSessionError(heartbeatError);
    heartbeatTimer = setInterval(() => void heartbeat(), config.SHIPFOX_HEARTBEAT_INTERVAL_MS);
    while (running && !controller.signal.aborted) {
      try {
        const activationToken = await pollRunnerAssignment(controlSessionToken, controller.signal);
        if (activationToken) return activationToken;
        await interruptibleSleep(config.SHIPFOX_POLL_INTERVAL_MS, controller.signal);
        if (heartbeatError) return handleControlSessionError(heartbeatError);
      } catch (error) {
        if (!running) return undefined;
        if (controller.signal.aborted && heartbeatError)
          return handleControlSessionError(heartbeatError);
        if (isTerminalControlSessionError(error)) return handleControlSessionError(error);
        if (isTimeoutError(error)) {
          logger().debug('Managed runner assignment poll timed out; retrying');
          continue;
        }
        throw error;
      }
    }
    return undefined;
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    shutdownController.signal.removeEventListener('abort', abortOnShutdown);
    controller.abort();
  }
}

function handleControlSessionError(error: unknown): undefined {
  if (isTerminalControlSessionError(error)) {
    logger().info('Runner control session is no longer usable; runner exiting');
    return undefined;
  }
  throw error;
}

function isTerminalControlSessionError(error: unknown): boolean {
  return (
    error instanceof HTTPError && (error.response.status === 401 || error.response.status === 409)
  );
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof HTTPError && error.response.status === 401;
}

function hasPollDeadlinePassed(deadline: number | undefined): boolean {
  return deadline !== undefined && Date.now() >= deadline;
}

async function interruptableSleep(ms: number): Promise<void> {
  if (!running) return;
  await interruptibleSleep(ms, shutdownController.signal);
}
