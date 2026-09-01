import {basename, sep} from 'node:path';
import type {StepDto} from '@shipfox/api-workflows-dto';
import {
  assertCheckoutPath,
  assertGitAvailable,
  CheckoutDestinationOccupiedError,
  CheckoutPathInvalidError,
  createCheckoutDestination,
  type GitCredentialHelperConfig,
  inspectCheckoutDestination,
  type PersistedCheckoutCredential,
  replaceCheckoutDestination,
  resolveCheckoutPath,
} from '@shipfox/runner-workspace';
import type {KyInstance} from 'ky';
import {
  type CheckoutLogSink,
  checkoutRepositoryAt,
  requestCheckoutCredentials,
  safeRepositoryUrl,
} from '#core/checkout-execution.js';
import type {StepResult} from '#core/step-result.js';

const URL_QUERY_RE = /[?#]/;
const TRAILING_SLASH_RE = /\/+$/;
const GIT_SUFFIX_RE = /\.git$/i;
export interface CheckoutDestination {
  repository: string;
  ref: string;
  result: NonNullable<StepResult['checkout']>;
}

export type CheckoutDestinations = Map<string, CheckoutDestination>;

export interface CheckoutStepExecution {
  result: StepResult;
  ambientGitConfigPath?: string | undefined;
  ambientGitConfigSecrets?: string[] | undefined;
  persistedCheckoutCredential?: PersistedCheckoutCredential | undefined;
}

/**
 * Executes an explicit checkout after applying the runner-local destination policy. The
 * server-resolved repository/ref arrive through the token response, so the ownership
 * decision is made before any Git command can touch the destination.
 */
export async function executeCheckoutStep(params: {
  cwd: string;
  gitConfigPath: string;
  leaseClient: KyInstance;
  signal: AbortSignal;
  step: StepDto;
  attempt: number;
  destinations: CheckoutDestinations;
  log?: CheckoutLogSink | undefined;
  credentialHelper?: GitCredentialHelperConfig | undefined;
}): Promise<CheckoutStepExecution> {
  const {
    cwd,
    gitConfigPath,
    leaseClient,
    signal,
    step,
    attempt,
    destinations,
    log,
    credentialHelper,
  } = params;
  const config = readCheckoutConfig(step.config.checkout);
  const preflightFailure = await checkoutPreflight(config.path, log);
  if (preflightFailure) return preflightFailure;

  log?.writeGroupStart('Checkout');
  try {
    const requested = await requestCheckoutCredentials({
      leaseClient,
      signal,
      stepId: step.id,
      attempt,
      ...(log ? {log} : {}),
      scope: 'checkout',
    });
    if (!requested.ok) return {result: requested.result};

    const requestedPath =
      config.path ?? defaultCheckoutPath(requested.value.repository_url, destinations.size === 0);
    const destination = await resolveCheckoutPath(cwd, requestedPath);
    const target = {
      repository: requested.value.repository_url,
      ref: requested.value.ref,
    };
    const skipped = await prepareCheckoutDestination({
      destination,
      destinations,
      target,
      force: config.force,
      log,
    });
    if (skipped) return skipped;

    const checkout = await checkoutRepositoryAt({
      destination,
      gitConfigPath,
      checkout: requested.value,
      checkoutStepId: step.id,
      checkoutAttempt: attempt,
      signal,
      ...(log ? {log} : {}),
      scope: 'checkout',
      credentialHelper,
    });
    if (!checkout.ok) return {result: checkout.result};

    const result = checkout.value.checkout;
    destinations.set(destination, {
      repository: result.repository,
      ref: result.ref,
      result,
    });
    return checkoutStepExecution({result, checkout: checkout.value});
  } catch (error) {
    if (error instanceof CheckoutPathInvalidError) return pathFailure(error, log);
    if (error instanceof CheckoutDestinationOccupiedError) {
      return occupiedFailure(error, log);
    }
    return {
      result: {
        success: false,
        error: {message: messageOf(error), reason: 'checkout_failed'},
        exit_code: null,
      },
    };
  } finally {
    log?.writeGroupEnd();
  }
}

function checkoutStepExecution(params: {
  result: NonNullable<StepResult['checkout']>;
  checkout: {
    ambientGitConfigPath?: string | undefined;
    ambientGitConfigSecrets?: string[] | undefined;
    persistedCheckoutCredential?: PersistedCheckoutCredential | undefined;
  };
}): CheckoutStepExecution {
  return {
    result: {success: true, error: null, exit_code: 0, checkout: params.result},
    ...(params.checkout.ambientGitConfigPath
      ? {ambientGitConfigPath: params.checkout.ambientGitConfigPath}
      : {}),
    ...(params.checkout.ambientGitConfigSecrets
      ? {ambientGitConfigSecrets: params.checkout.ambientGitConfigSecrets}
      : {}),
    ...(params.checkout.persistedCheckoutCredential
      ? {persistedCheckoutCredential: params.checkout.persistedCheckoutCredential}
      : {}),
  };
}

async function checkoutPreflight(
  path: unknown,
  log: CheckoutLogSink | undefined,
): Promise<CheckoutStepExecution | undefined> {
  if (path !== undefined) {
    try {
      assertCheckoutPath(path);
    } catch (error) {
      return pathFailure(error, log);
    }
  }
  try {
    await assertGitAvailable();
    return undefined;
  } catch (error) {
    return gitUnavailableFailure(error, log);
  }
}

async function prepareCheckoutDestination(params: {
  destination: string;
  destinations: CheckoutDestinations;
  target: Pick<CheckoutDestination, 'repository' | 'ref'>;
  force: boolean;
  log: CheckoutLogSink | undefined;
}): Promise<CheckoutStepExecution | undefined> {
  const previous = params.destinations.get(params.destination);
  if (previous !== undefined) return prepareTrackedCheckoutDestination(params, previous);
  const state = await inspectCheckoutDestination(params.destination);
  if (state === 'occupied' && !params.force) {
    throw new CheckoutDestinationOccupiedError(params.destination);
  }
  if (state === 'occupied') {
    releaseDestinationSubtree(params.destinations, params.destination);
    await replaceCheckoutDestination(params.destination);
  } else {
    await createCheckoutDestination(params.destination);
  }
  return undefined;
}

async function prepareTrackedCheckoutDestination(
  params: Parameters<typeof prepareCheckoutDestination>[0],
  previous: CheckoutDestination,
): Promise<CheckoutStepExecution | undefined> {
  if (sameTarget(previous, params.target) && !params.force) {
    params.log?.writeGroup({
      name: 'Checkout skipped',
      lines: [
        `Path: ${params.destination}`,
        `Already checked out ${safeRepositoryUrl(params.target.repository)} at ${params.target.ref}.`,
      ],
    });
    return {result: {success: true, error: null, exit_code: 0, checkout: previous.result}};
  }
  if (!params.force) throw new CheckoutDestinationOccupiedError(params.destination);
  releaseDestinationSubtree(params.destinations, params.destination);
  await replaceCheckoutDestination(params.destination);
  return undefined;
}

function readCheckoutConfig(value: unknown): {path?: unknown; force: boolean} {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {force: false};
  }
  const config = value as Record<string, unknown>;
  return {
    ...(Object.hasOwn(config, 'path') ? {path: config.path} : {}),
    force: config.force === true,
  };
}

function defaultCheckoutPath(repositoryUrl: string, firstCheckout: boolean): string {
  if (firstCheckout) return '.';

  const withoutQuery = repositoryUrl.split(URL_QUERY_RE, 1)[0] ?? repositoryUrl;
  const lastSegment = basename(withoutQuery.replace(TRAILING_SLASH_RE, ''));
  const repositoryName = lastSegment.replace(GIT_SUFFIX_RE, '');
  assertCheckoutPath(repositoryName);
  return repositoryName;
}

function sameTarget(
  previous: Pick<CheckoutDestination, 'repository' | 'ref'>,
  target: Pick<CheckoutDestination, 'repository' | 'ref'>,
): boolean {
  return previous.repository === target.repository && previous.ref === target.ref;
}

function releaseDestinationSubtree(destinations: CheckoutDestinations, destination: string): void {
  const prefix = destination.endsWith(sep) ? destination : `${destination}${sep}`;
  for (const tracked of destinations.keys()) {
    if (tracked === destination || tracked.startsWith(prefix)) destinations.delete(tracked);
  }
}

function pathFailure(error: unknown, log: CheckoutLogSink | undefined): CheckoutStepExecution {
  const message = messageOf(error);
  log?.writeOutputLine(
    `Checkout step failed because its destination path is invalid. Details: ${message}`,
    'stderr',
  );
  log?.writeOutputLine(
    'Next step: Use a relative checkout path without .. or .git, and keep it inside the job workspace.',
    'stderr',
  );
  return {
    result: {
      success: false,
      error: {message, reason: 'checkout_path_invalid'},
      exit_code: null,
    },
  };
}

function occupiedFailure(
  error: CheckoutDestinationOccupiedError,
  log: CheckoutLogSink | undefined,
): CheckoutStepExecution {
  const message = error.message;
  log?.writeOutputLine(
    `Checkout step failed because its destination is occupied. Details: ${message}`,
    'stderr',
  );
  log?.writeOutputLine(
    'Next step: Choose an empty destination or set force to replace its contents.',
    'stderr',
  );
  return {
    result: {
      success: false,
      error: {message, reason: 'checkout_destination_occupied'},
      exit_code: null,
    },
  };
}

function gitUnavailableFailure(
  error: unknown,
  log: CheckoutLogSink | undefined,
): CheckoutStepExecution {
  const message = messageOf(error);
  log?.writeOutputLine(
    `Checkout step failed because Git is not available on the runner. Details: ${message}`,
    'stderr',
  );
  log?.writeOutputLine(
    'Next step: Install Git in the runner image or use a runner image that includes Git.',
    'stderr',
  );
  return {
    result: {
      success: false,
      error: {message, reason: 'git_unavailable'},
      exit_code: null,
    },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
