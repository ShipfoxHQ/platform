import type {CheckoutTokenResponseDto, StepErrorReasonDto} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {HTTPError, requestCheckoutToken} from '@shipfox/runner-protocol';
import {
  ambientGitCredentialSecrets,
  type CheckoutCommandStartMetadata,
  CheckoutError,
  type CheckoutFailureKind,
  type CheckoutOutputSink,
  type CheckoutPhase,
  checkoutRepository,
  writeAmbientGitCredential,
} from '@shipfox/runner-workspace';
import type {KyInstance} from 'ky';
import type {StepResult} from '#core/step-result.js';

const URL_CREDENTIAL_RE = /(https?:\/\/)[^/@\s]+@/gi;

export interface CheckoutLogSink {
  writeGroupStart(name: string): void;
  writeGroupEnd(): void;
  writeGroup(options: {name: string; lines: readonly string[]; source?: 'stdout' | 'stderr'}): void;
  writeOutputLine(line: string, source?: 'stdout' | 'stderr'): void;
  write(chunk: Buffer, source: 'stdout' | 'stderr'): void;
  addSecrets(secrets: string[]): void;
}

export type CheckoutFailureScope = 'setup' | 'checkout';

export type CheckoutPhaseResult<T> = {ok: true; value: T} | {ok: false; result: StepResult};

export async function requestCheckoutCredentials(params: {
  leaseClient: KyInstance;
  signal: AbortSignal;
  stepId: string;
  attempt: number;
  log?: CheckoutLogSink | undefined;
  scope: CheckoutFailureScope;
}): Promise<CheckoutPhaseResult<CheckoutTokenResponseDto>> {
  const {leaseClient, signal, stepId, attempt, log, scope} = params;
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
      scope === 'setup'
        ? 'Setup failed because Shipfox could not grant repository access.'
        : 'Checkout step failed because Shipfox could not grant repository access.',
      checkoutTokenFailureHelp(reason),
      error,
    );
    return {ok: false, result: fail(error, reason)};
  }
}

export async function checkoutRepositoryAt(params: {
  destination: string;
  gitConfigPath: string;
  checkout: CheckoutTokenResponseDto;
  signal: AbortSignal;
  log?: CheckoutLogSink | undefined;
  scope: CheckoutFailureScope;
}): Promise<
  CheckoutPhaseResult<{
    ambientGitConfigPath?: string | undefined;
    ambientGitConfigSecrets?: string[] | undefined;
    checkout: NonNullable<StepResult['checkout']>;
  }>
> {
  const {destination, gitConfigPath, checkout, signal, log, scope} = params;
  try {
    log?.writeGroup({
      name: 'Repository details',
      lines: [
        `Repository: ${safeRepositoryUrl(checkout.repository_url)}`,
        `Requested ref: ${checkout.ref}`,
        `Path: ${destination}`,
      ],
    });
    const commit = await checkoutRepository({
      repositoryUrl: checkout.repository_url,
      ref: checkout.ref,
      fetchDepth: checkout.fetch_depth,
      auth: checkout.auth,
      cwd: destination,
      signal,
      onSecrets: (secrets) => log?.addSecrets(secrets),
      onCommandStart: (metadata) => writeCheckoutCommand(log, metadata),
      onOutput: checkoutOutput(log),
    });
    log?.writeGroup({name: 'Checkout complete', lines: [`Checked out commit: ${commit}`]});
    const ambientGitConfig = await persistAmbientGitCredential({
      gitConfigPath,
      checkout,
      log,
      scope,
    });
    return {
      ok: true,
      value: {
        checkout: {
          repository: checkout.repository_url,
          ref: checkout.ref,
          commit,
          path: destination,
        },
        ...(ambientGitConfig
          ? {
              ambientGitConfigPath: ambientGitConfig.path,
              ambientGitConfigSecrets: ambientGitConfig.secrets,
            }
          : {}),
      },
    };
  } catch (error) {
    const reason =
      error instanceof CheckoutError ? CHECKOUT_KIND_REASON[error.kind] : 'checkout_failed';
    if (error instanceof CheckoutError && error.phase) {
      writeFailure(
        log,
        `${scope === 'setup' ? 'Setup' : 'Checkout step'} failed while ${checkoutPhaseAction(error.phase)}.`,
        checkoutFailureHelp(reason),
        error,
      );
    } else {
      writeFailure(
        log,
        `${scope === 'setup' ? 'Setup' : 'Checkout step'} failed while checking out the repository.`,
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
  log?: CheckoutLogSink | undefined;
  scope: CheckoutFailureScope;
}): Promise<{path: string; secrets: string[]} | undefined> {
  const {gitConfigPath, checkout, log, scope} = params;
  const auth = checkout.auth;
  if (!auth?.persist || auth.carry !== 'header') return undefined;

  try {
    await writeAmbientGitCredential({
      configPath: gitConfigPath,
      repositoryUrl: checkout.repository_url,
      auth,
      ...(checkout.git_author ? {gitAuthor: checkout.git_author} : {}),
    });
    return {path: gitConfigPath, secrets: ambientGitCredentialSecrets(auth)};
  } catch (error) {
    writeWarning(
      log,
      'Repository access was not persisted',
      [
        `The checkout succeeded, but agent and run steps will run without ambient git authentication. Details: ${messageOf(error)}`,
        'Git commands in later steps may need their own credentials.',
      ],
      scope,
    );
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

function writeCheckoutCommand(
  log: CheckoutLogSink | undefined,
  metadata: CheckoutCommandStartMetadata,
): void {
  log?.writeGroup({
    name: checkoutPhaseTitle(metadata.phase),
    lines: [`Command: ${metadata.command}`, `Working directory: ${metadata.cwd}`],
  });
}

function checkoutOutput(log: CheckoutLogSink | undefined): CheckoutOutputSink | undefined {
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
  log: CheckoutLogSink | undefined,
  summary: string,
  nextStep: string,
  error: unknown,
): void {
  log?.writeOutputLine(`${summary} Details: ${messageOf(error)}`, 'stderr');
  log?.writeOutputLine(`Next step: ${nextStep}`, 'stderr');
}

function writeWarning(
  log: CheckoutLogSink | undefined,
  name: string,
  lines: readonly string[],
  scope: CheckoutFailureScope,
): void {
  if (log) {
    log.writeGroup({name, lines, source: 'stderr'});
    return;
  }
  logger().warn({name, lines}, scope === 'setup' ? 'Setup warning' : 'Checkout warning');
}

export function safeRepositoryUrl(repositoryUrl: string): string {
  return repositoryUrl.replace(URL_CREDENTIAL_RE, '$1***@');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
