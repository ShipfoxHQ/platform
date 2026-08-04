import {arch, platform, release} from 'node:os';
import type {StepDto, StepErrorReasonDto} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {
  assertGitAvailable,
  createJobDir,
  normalizeCheckoutDestination,
} from '@shipfox/runner-workspace';
import type {KyInstance} from 'ky';
import {
  type CheckoutLogSink,
  type CheckoutPhaseResult,
  checkoutRepositoryAt,
  requestCheckoutCredentials,
} from '#core/checkout-execution.js';
import type {StepResult} from '#core/step-result.js';

type SetupLogSink = CheckoutLogSink;

export interface SetupJobContext {
  workflowRunId: string;
  workflowRunAttemptId: string;
  jobId: string;
  jobExecutionId: string;
}

export interface SetupStepExecution {
  result: StepResult;
  ambientGitConfigPath?: string | undefined;
}

// The synthetic "Set up job" step body. It owns per-job workspace preparation and the
// repository checkout, reporting failures through the normal step protocol so a setup
// failure fails the job in seconds instead of hanging until the lease expires.
//
// Abort handling lives in the step loop, not here: an aborted job stops the loop before
// it reports (see step-loop.ts), exactly like an abort during any step. The git child is
// still killed via `signal`, and the per-job workspace is cleaned up in runJob's finally.
export async function executeSetupStep(params: {
  cwd: string;
  gitConfigPath: string;
  leaseClient: KyInstance;
  signal: AbortSignal;
  step: StepDto;
  attempt: number;
  log?: SetupLogSink | undefined;
  jobContext?: SetupJobContext | undefined;
}): Promise<SetupStepExecution> {
  const {cwd, log, jobContext, step} = params;

  logger().info(setupLogFields(jobContext), 'Setup step started');
  writeJobContext(log, jobContext);

  if (step.config.checkout !== undefined) {
    const gitFailure = await checkGit(log);
    if (gitFailure) return logSetupFailure(gitFailure, jobContext);
  }

  const workspaceFailure = await prepareWorkspace({cwd, log});
  if (workspaceFailure) return logSetupFailure(workspaceFailure, jobContext);

  if (step.config.checkout === undefined) {
    log?.writeGroup({
      name: 'Checkout skipped',
      lines: ['No repository checkout was requested for this job.'],
    });
    log?.writeOutputLine('Setup completed successfully. The job is ready to run.');
    logger().info(setupLogFields(jobContext), 'Setup step completed');
    return {result: {success: true, error: null, exit_code: 0}};
  }

  const checkout = await runCheckoutSetup({...params, stepId: step.id, log});
  if (!checkout.ok) return logSetupFailure(checkout.result, jobContext);

  log?.writeOutputLine('Setup completed successfully. The job is ready to run.');
  logger().info(setupLogFields(jobContext), 'Setup step completed');
  return {
    result: {success: true, error: null, exit_code: 0, checkout: checkout.value.checkout},
    ...(checkout.value.ambientGitConfigPath
      ? {ambientGitConfigPath: checkout.value.ambientGitConfigPath}
      : {}),
  };
}

async function checkGit(log: SetupLogSink | undefined): Promise<StepResult | null> {
  try {
    const gitVersion = await assertGitAvailable();
    writeRunnerEnvironment(log, gitVersion);
    return null;
  } catch (error) {
    writeRunnerEnvironment(log, 'unavailable');
    writeFailure(
      log,
      'Setup failed because Git is not available on the runner.',
      'Install Git in the runner image or use a runner image that includes Git.',
      error,
    );
    return fail(error, 'git_unavailable');
  }
}

async function prepareWorkspace(params: {
  cwd: string;
  log?: SetupLogSink | undefined;
}): Promise<StepResult | null> {
  const {cwd, log} = params;
  try {
    log?.writeGroup({
      name: 'Prepare workspace',
      lines: ['Creating a clean working directory for this job.', `Path: ${cwd}`],
    });
    await createJobDir(cwd);
  } catch (error) {
    writeFailure(
      log,
      'Setup failed because the runner could not prepare the workspace.',
      'Check the runner workspace permissions and available disk space.',
      error,
    );
    return fail(error, 'workspace_prep_failed');
  }
  return null;
}

async function runCheckoutSetup(params: {
  cwd: string;
  gitConfigPath: string;
  leaseClient: KyInstance;
  signal: AbortSignal;
  stepId: string;
  attempt: number;
  log?: SetupLogSink | undefined;
}): Promise<
  CheckoutPhaseResult<{
    ambientGitConfigPath?: string | undefined;
    checkout: NonNullable<StepResult['checkout']>;
  }>
> {
  const {log} = params;
  log?.writeGroupStart('Checkout');
  try {
    const destination = await normalizeCheckoutDestination(params.cwd, params.cwd);
    const checkout = await requestCheckoutCredentials({...params, scope: 'setup'});
    if (!checkout.ok) return checkout;

    return await checkoutRepositoryAt({
      destination,
      gitConfigPath: params.gitConfigPath,
      checkout: checkout.value,
      signal: params.signal,
      ...(log ? {log} : {}),
      scope: 'setup',
    });
  } finally {
    log?.writeGroupEnd();
  }
}

function fail(error: unknown, reason: StepErrorReasonDto): StepResult {
  return {
    success: false,
    error: {message: messageOf(error), reason},
    exit_code: null,
  };
}

function writeJobContext(
  log: SetupLogSink | undefined,
  jobContext: SetupJobContext | undefined,
): void {
  if (!jobContext) return;
  log?.writeGroup({
    name: 'Job details',
    lines: [
      `Workflow run: ${jobContext.workflowRunId}`,
      `Workflow run attempt: ${jobContext.workflowRunAttemptId}`,
      `Job: ${jobContext.jobId}`,
      `Job execution: ${jobContext.jobExecutionId}`,
    ],
  });
}

function setupLogFields(
  jobContext: SetupJobContext | undefined,
): Partial<Record<keyof SetupJobContext, string>> {
  if (!jobContext) return {};
  return {
    workflowRunId: jobContext.workflowRunId,
    workflowRunAttemptId: jobContext.workflowRunAttemptId,
    jobId: jobContext.jobId,
    jobExecutionId: jobContext.jobExecutionId,
  };
}

function logSetupFailure(
  result: StepResult,
  jobContext: SetupJobContext | undefined,
): SetupStepExecution {
  logger().warn(
    {
      ...setupLogFields(jobContext),
      ...(result.error?.reason ? {reason: result.error.reason} : {}),
    },
    'Setup step failed',
  );
  return {result};
}

function writeRunnerEnvironment(log: SetupLogSink | undefined, gitVersion: string): void {
  log?.writeGroup({
    name: 'Runner environment',
    lines: [
      `Node.js: ${process.version}`,
      `Operating system: ${platform()} ${release()}`,
      `CPU architecture: ${arch()}`,
      `Git: ${gitVersion}`,
      ...buildMetadataLines(),
    ],
  });
}

function buildMetadataLines(): string[] {
  const lines: string[] = [];
  if (process.env.RUNNER_VERSION) lines.push(`Runner version: ${process.env.RUNNER_VERSION}`);
  if (process.env.IMAGE_REVISION)
    lines.push(`Runner image revision: ${process.env.IMAGE_REVISION}`);
  if (process.env.IMAGE_CREATED) lines.push(`Runner image created: ${process.env.IMAGE_CREATED}`);
  if (process.env.BUILD_NUMBER) lines.push(`Runner build number: ${process.env.BUILD_NUMBER}`);
  return lines;
}

function writeFailure(
  log: SetupLogSink | undefined,
  summary: string,
  nextStep: string,
  error: unknown,
): void {
  log?.writeOutputLine(`${summary} Details: ${messageOf(error)}`, 'stderr');
  log?.writeOutputLine(`Next step: ${nextStep}`, 'stderr');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
