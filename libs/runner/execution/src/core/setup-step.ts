import {arch, platform, release} from 'node:os';
import type {CheckoutTokenResponseDto, StepErrorReasonDto} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {HTTPError, requestCheckoutToken} from '@shipfox/runner-protocol';
import {
  assertGitAvailable,
  type CheckoutCommandStartMetadata,
  CheckoutError,
  type CheckoutFailureKind,
  type CheckoutOutputSink,
  type CheckoutPhase,
  checkoutRepository,
  createJobDir,
  writeAmbientGitCredential,
} from '@shipfox/runner-workspace';
import type {KyInstance} from 'ky';
import type {StepResult} from '#core/step-result.js';

const URL_CREDENTIAL_RE = /(https?:\/\/)[^/@\s]+@/gi;

interface SetupLogSink {
  writeGroupStart(name: string): void;
  writeGroupEnd(): void;
  writeGroup(options: {name: string; lines: readonly string[]; source?: 'stdout' | 'stderr'}): void;
  writeOutputLine(line: string, source?: 'stdout' | 'stderr'): void;
  write(chunk: Buffer, source: 'stdout' | 'stderr'): void;
  addSecrets(secrets: string[]): void;
}

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
  stepId: string;
  attempt: number;
  log?: SetupLogSink | undefined;
  jobContext?: SetupJobContext | undefined;
}): Promise<SetupStepExecution> {
  const {cwd, log, jobContext} = params;

  logger().info(setupLogFields(jobContext), 'Setup step started');
  writeJobContext(log, jobContext);

  const gitFailure = await checkGit(log);
  if (gitFailure) return logSetupFailure(gitFailure, jobContext);

  const workspaceFailure = await prepareWorkspace({cwd, log});
  if (workspaceFailure) return logSetupFailure(workspaceFailure, jobContext);

  const checkout = await runCheckoutSetup({...params, log});
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
  SetupPhaseResult<{
    ambientGitConfigPath?: string | undefined;
    checkout: NonNullable<StepResult['checkout']>;
  }>
> {
  const {log} = params;
  log?.writeGroupStart('Checkout');
  try {
    const checkout = await requestCheckoutCredentials(params);
    if (!checkout.ok) return checkout;

    return await checkoutRepositoryForSetup({...params, checkout: checkout.value});
  } finally {
    log?.writeGroupEnd();
  }
}

type SetupPhaseResult<T> = {ok: true; value: T} | {ok: false; result: StepResult};

async function requestCheckoutCredentials(params: {
  leaseClient: KyInstance;
  signal: AbortSignal;
  stepId: string;
  attempt: number;
  log?: SetupLogSink | undefined;
}): Promise<SetupPhaseResult<CheckoutTokenResponseDto>> {
  const {leaseClient, signal, stepId, attempt, log} = params;
  try {
    log?.writeGroup({
      name: 'Request repository access',
      lines: ['Requesting short-lived repository access from Shipfox.'],
    });
    const checkout = await requestCheckoutToken(leaseClient, {stepId, attempt, signal});
    log?.writeGroup({
      name: 'Repository access granted',
      lines: credentialLines(checkout.auth),
    });
    return {ok: true, value: checkout};
  } catch (error) {
    const reason = classifyCheckoutTokenError(error);
    writeFailure(
      log,
      'Setup failed because Shipfox could not grant repository access.',
      checkoutTokenFailureHelp(reason),
      error,
    );
    return {ok: false, result: fail(error, reason)};
  }
}

async function checkoutRepositoryForSetup(params: {
  cwd: string;
  gitConfigPath: string;
  checkout: CheckoutTokenResponseDto;
  signal: AbortSignal;
  log?: SetupLogSink | undefined;
}): Promise<
  SetupPhaseResult<{
    ambientGitConfigPath?: string | undefined;
    checkout: NonNullable<StepResult['checkout']>;
  }>
> {
  const {cwd, gitConfigPath, checkout, signal, log} = params;
  try {
    log?.writeGroup({
      name: 'Repository details',
      lines: [
        `Repository: ${safeRepositoryUrl(checkout.repository_url)}`,
        `Requested ref: ${checkout.ref}`,
      ],
    });
    const commit = await checkoutRepository({
      repositoryUrl: checkout.repository_url,
      ref: checkout.ref,
      fetchDepth: checkout.fetch_depth,
      auth: checkout.auth,
      cwd,
      signal,
      onSecrets: (secrets) => log?.addSecrets(secrets),
      onCommandStart: (metadata) => writeCheckoutCommand(log, metadata),
      onOutput: checkoutOutput(log),
    });
    log?.writeGroup({name: 'Checkout complete', lines: [`Checked out commit: ${commit}`]});
    const ambientGitConfigPath = await persistAmbientGitCredential({
      gitConfigPath,
      checkout,
      log,
    });
    return {
      ok: true,
      value: {
        checkout: {
          repository: checkout.repository_url,
          ref: checkout.ref,
          commit,
          path: cwd,
        },
        ...(ambientGitConfigPath ? {ambientGitConfigPath} : {}),
      },
    };
  } catch (error) {
    const reason =
      error instanceof CheckoutError ? CHECKOUT_KIND_REASON[error.kind] : 'checkout_failed';
    if (error instanceof CheckoutError && error.phase) {
      writeFailure(
        log,
        `Setup failed while ${checkoutPhaseAction(error.phase)}.`,
        checkoutFailureHelp(reason),
        error,
      );
    } else {
      writeFailure(
        log,
        'Setup failed while checking out the repository.',
        checkoutFailureHelp(reason),
        error,
      );
    }
    return {ok: false, result: fail(error, reason)};
  }
}

async function persistAmbientGitCredential(params: {
  gitConfigPath: string;
  checkout: CheckoutTokenResponseDto;
  log?: SetupLogSink | undefined;
}): Promise<string | undefined> {
  const {gitConfigPath, checkout, log} = params;
  if (!checkout.auth?.persist || checkout.auth.carry !== 'header') return undefined;

  try {
    await writeAmbientGitCredential({
      configPath: gitConfigPath,
      repositoryUrl: checkout.repository_url,
      auth: checkout.auth,
      ...(checkout.git_author ? {gitAuthor: checkout.git_author} : {}),
    });
    return gitConfigPath;
  } catch (error) {
    writeWarning(log, 'Repository access was not persisted', [
      `The checkout succeeded, but agent steps will run without ambient git authentication. Details: ${messageOf(error)}`,
      'Git commands in later steps may need their own credentials.',
    ]);
    return undefined;
  }
}

const CHECKOUT_KIND_REASON: Record<CheckoutFailureKind, StepErrorReasonDto> = {
  auth: 'checkout_auth_failed',
  unavailable: 'checkout_unavailable',
  failed: 'checkout_failed',
  aborted: 'setup_aborted',
};

// Maps a checkout-token endpoint failure to a reason. Auth denial and the backend's
// retryable provider signals (429/503, or their typed `code`) get distinct reasons; a
// missing checkout intent (404) and everything else fold into the generic failure.
// CheckoutError messages are already redacted in the workspace layer; the token-fetch
// error never carries credential material.
function classifyCheckoutTokenError(error: unknown): StepErrorReasonDto {
  if (!(error instanceof HTTPError)) return 'checkout_failed';

  const {status} = error.response;
  const code = readErrorCode(error);

  if (status === 401 || status === 403 || code === 'access-denied' || code === 'forbidden') {
    return 'checkout_auth_failed';
  }
  if (
    status === 429 ||
    status === 503 ||
    code === 'rate-limited' ||
    code === 'timeout' ||
    code === 'provider-unavailable'
  ) {
    return 'checkout_unavailable';
  }
  return 'checkout_failed';
}

// ky consumes the response body to populate `error.data` before throwing, so the body
// is already read here: `error.response.json()` would throw "Body has already been
// consumed". Read ky's pre-parsed `data` instead.
function readErrorCode(error: HTTPError): string | undefined {
  const body = error.data;
  if (body && typeof body === 'object' && 'code' in body && typeof body.code === 'string') {
    return body.code;
  }
  return undefined;
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

function writeCheckoutCommand(
  log: SetupLogSink | undefined,
  metadata: CheckoutCommandStartMetadata,
): void {
  log?.writeGroup({
    name: checkoutPhaseTitle(metadata.phase),
    lines: [`Command: ${metadata.command}`, `Working directory: ${metadata.cwd}`],
  });
}

function checkoutOutput(log: SetupLogSink | undefined): CheckoutOutputSink | undefined {
  if (!log) return undefined;
  return (chunk, source) => log.write(chunk, source);
}

function credentialLines(auth: CheckoutTokenResponseDto['auth']): string[] {
  if (!auth) return ['No repository credential was required.'];
  return [
    auth.kind === 'bearer'
      ? 'Using a short-lived repository token.'
      : 'Using a short-lived username/password repository credential.',
    auth.expires_at ? `Expires at: ${auth.expires_at}` : 'No expiration was provided.',
  ];
}

function checkoutPhaseTitle(phase: CheckoutPhase): string {
  switch (phase) {
    case 'init':
      return 'Initialize repository';
    case 'remote':
      return 'Add repository remote';
    case 'fetch':
      return 'Fetch requested ref';
    case 'checkout':
      return 'Check out commit';
    case 'resolve':
      return 'Read checked-out commit';
  }
}

function checkoutPhaseAction(phase: CheckoutPhase): string {
  switch (phase) {
    case 'init':
      return 'initializing the local Git repository';
    case 'remote':
      return 'adding the repository remote';
    case 'fetch':
      return 'fetching the requested ref';
    case 'checkout':
      return 'checking out the fetched commit';
    case 'resolve':
      return 'reading the checked-out commit';
  }
}

function checkoutTokenFailureHelp(reason: StepErrorReasonDto): string {
  if (reason === 'checkout_auth_failed') {
    return 'Check that the runner is connected to this workspace and the job is allowed to read this repository.';
  }
  if (reason === 'checkout_unavailable') {
    return 'Retry the job; Shipfox or the repository provider may be temporarily unavailable.';
  }
  return 'Check the repository connection and job permissions in Shipfox, then retry the job.';
}

function checkoutFailureHelp(reason: StepErrorReasonDto): string {
  if (reason === 'checkout_auth_failed') {
    return 'Check the repository connection in Shipfox and confirm it has permission to read this repository.';
  }
  if (reason === 'checkout_unavailable') {
    return 'Check the runner network and DNS access to the Git provider, then retry the job.';
  }
  if (reason === 'setup_aborted') {
    return 'The job was cancelled or timed out before checkout completed.';
  }
  return 'Check that the repository URL and requested ref are valid. The git output above may include provider details.';
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

function writeWarning(log: SetupLogSink | undefined, name: string, lines: readonly string[]): void {
  if (log) {
    log.writeGroup({name, lines, source: 'stderr'});
    return;
  }
  logger().warn({name, lines}, 'Setup warning');
}

function safeRepositoryUrl(repositoryUrl: string): string {
  return repositoryUrl.replace(URL_CREDENTIAL_RE, '$1***@');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
