import {
  type LeasedWriteAnnotationOperationDto,
  leasedWriteAnnotationsBodySchema,
  leasedWriteAnnotationsResponseSchema,
} from '@shipfox/annotations-dto';
import {
  type AgentRuntimeCredentialsResponseDto,
  agentRuntimeCredentialsResponseSchema,
} from '@shipfox/api-agent-dto';
import {appendLogsResponseSchema, offsetGapResponseSchema} from '@shipfox/api-logs-dto';
import {
  type ClaimedJobResponseDto,
  claimedJobResponseSchema,
  type HeartbeatResponseDto,
  heartbeatBodySchema,
  heartbeatResponseSchema,
  type RegisterRunnerResponseDto,
  RUNNER_SESSION_EXHAUSTED_CODE,
  type RunnerToolCapabilitiesDto,
  registerRunnerBodySchema,
  registerRunnerResponseSchema,
  runnerAssignmentPollResponseSchema,
  runnerBootstrapExchangeBodySchema,
  runnerBootstrapExchangeResponseSchema,
  runnerControlHeartbeatResponseSchema,
  runnerEnrollmentBodySchema,
} from '@shipfox/api-runners-dto';
import {type StepSecretsResponseDto, stepSecretsResponseSchema} from '@shipfox/api-secrets-dto';
import {
  type AgentConfigIssueDto,
  type CheckoutTokenResponseDto,
  checkoutTokenResponseSchema,
  type LogOutcomeDto,
  type NextStepResponseDto,
  nextStepResponseSchema,
  type ReportStepResponseDto,
  reportStepBodySchema,
  reportStepResponseSchema,
  STEP_ERROR_MESSAGE_MAX_LENGTH,
  STEP_RESPONSE_MAX_LENGTH,
  type StepErrorDto,
} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {isUuid} from '@shipfox/regex';
import {canonicalizeLabels} from '@shipfox/runner-labels';
import ky, {HTTPError, type KyInstance} from 'ky';
import {config} from '#config.js';

/** Media type the append endpoint expects for the raw NDJSON request body. */
const LOG_NDJSON_CONTENT_TYPE = 'application/x-ndjson';
export const ANNOTATION_POST_TIMEOUT_MS = 2_500;
/** Allows the API's 30-second assignment long-poll plus transport overhead. */
const RUNNER_ASSIGNMENT_POLL_TIMEOUT_MS = 45_000;

const ANNOTATION_CAPPED_CODES = new Set([
  'annotation-body-too-large',
  'annotation-count-limit-exceeded',
  'annotation-total-bytes-limit-exceeded',
]);

/**
 * The runner-facing result of one append, after the transport has interpreted the
 * HTTP status. `committed` carries the new server offset (and whether the budget is
 * now exhausted); `conflict` carries the offset to rewind/fast-forward to; `stopped`
 * means the endpoint is gone or the lease is no longer accepted, so the uploader gives
 * up (the server's stream lifecycle takes over).
 */
export type LogAppendOutcome =
  | {status: 'committed'; committedLength: number; capped: boolean}
  | {status: 'conflict'; committedLength: number}
  | {status: 'stopped'};

export type AnnotationWriteOutcome =
  | {status: 'written'; annotationCount: number; totalBodyBytes: number}
  | {status: 'capped'; code: string}
  | {status: 'rejected'; statusCode: number; code?: string | undefined};

/**
 * The append port the runner's uploader depends on. The caller binds the lease
 * client, step, and attempt; the uploader only supplies the offset and body.
 */
export type LogAppendFn = (args: {
  offset: number;
  body: Uint8Array;
  signal?: AbortSignal;
}) => Promise<LogAppendOutcome>;

const baseUrl = config.SHIPFOX_API_URL.endsWith('/')
  ? config.SHIPFOX_API_URL
  : `${config.SHIPFOX_API_URL}/`;

/**
 * The runner's registration bearer credential, exposed so the log masker can scrub it
 * from captured step output. For masking only — never log this value.
 */
export function runnerRegistrationToken(): string {
  return config.SHIPFOX_RUNNER_REGISTRATION_TOKEN;
}

export function configuredRunnerLabels(): string[] {
  return [...canonicalizeLabels(config.SHIPFOX_RUNNER_LABELS.split(','))];
}

export class RunnerLabelsRequiredError extends Error {
  constructor() {
    super('SHIPFOX_RUNNER_LABELS must contain at least one non-empty label.');
    this.name = 'RunnerLabelsRequiredError';
  }
}

export class RunnerSessionExhaustedError extends Error {
  constructor() {
    super('Runner session is exhausted.');
    this.name = 'RunnerSessionExhaustedError';
  }
}

export class AgentRuntimeConfigRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    public readonly agentConfigIssue: AgentConfigIssueDto | undefined = agentConfigIssueForCode(
      code,
    ),
  ) {
    super(
      code === undefined
        ? `Agent runtime config request failed with status ${status}.`
        : `Agent runtime config request failed with status ${status}: ${code}.`,
    );
    this.name = 'AgentRuntimeConfigRequestError';
  }
}

export class StepSecretsRequestError extends Error {
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
}

export function requireRunnerLabels(): string[] {
  const labels = configuredRunnerLabels();
  if (labels.length === 0) throw new RunnerLabelsRequiredError();
  return labels;
}

export async function registerRunnerSession(
  options: {capabilities?: RunnerToolCapabilitiesDto; registrationToken?: string} = {},
): Promise<RegisterRunnerResponseDto> {
  const labels = configuredRunnerLabels();

  logger().debug({labels}, 'Registering runner session');

  const body = registerRunnerBodySchema.parse({
    labels,
    ...(options.capabilities ? {capabilities: options.capabilities} : {}),
  });
  const response = await createRegistrationApi(
    options.registrationToken ?? config.SHIPFOX_RUNNER_REGISTRATION_TOKEN,
  ).post('runners/register', {json: body});

  return registerRunnerResponseSchema.parse(await response.json());
}

function createRegistrationApi(registrationToken: string): KyInstance {
  return ky.create({baseUrl, headers: {Authorization: `Bearer ${registrationToken}`}});
}

function createRunnerControlClient(controlSessionToken: string): KyInstance {
  return ky.create({baseUrl, headers: {Authorization: `Bearer ${controlSessionToken}`}});
}

export async function exchangeRunnerBootstrapToken(
  bootstrapToken: string,
): Promise<{controlSessionToken: string}> {
  const body = runnerBootstrapExchangeBodySchema.parse({bootstrap_token: bootstrapToken});
  const response = await ky.post(new URL('runner-enrollment/exchange', baseUrl), {json: body});
  const parsed = runnerBootstrapExchangeResponseSchema.parse(await response.json());
  return {controlSessionToken: parsed.control_session_token};
}

export async function enrollRunnerControlSession(params: {
  controlSessionToken: string;
  capabilities: RunnerToolCapabilitiesDto;
  providerKind: string;
  protocolVersion: string;
}): Promise<void> {
  const body = runnerEnrollmentBodySchema.parse({
    labels: configuredRunnerLabels(),
    capabilities: params.capabilities,
    provider_kind: params.providerKind,
    protocol_version: params.protocolVersion,
  });
  await createRunnerControlClient(params.controlSessionToken).post('runner-control/enrollment', {
    json: body,
  });
}

export async function heartbeatRunnerControlSession(
  controlSessionToken: string,
  signal?: AbortSignal,
): Promise<void> {
  const response = await createRunnerControlClient(controlSessionToken).post(
    'runner-control/heartbeat',
    signal ? {signal} : undefined,
  );
  runnerControlHeartbeatResponseSchema.parse(await response.json());
}

export async function pollRunnerAssignment(
  controlSessionToken: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const response = await createRunnerControlClient(controlSessionToken).get(
    'runner-control/assignment',
    {
      timeout: RUNNER_ASSIGNMENT_POLL_TIMEOUT_MS,
      ...(signal ? {signal} : {}),
    },
  );
  return runnerAssignmentPollResponseSchema.parse(await response.json()).activation_token;
}

function createRunnerSessionClient(sessionToken: string): KyInstance {
  return ky.create({
    baseUrl,
    headers: {
      Authorization: `Bearer ${sessionToken}`,
    },
  });
}

// Scheduling is step-less: the claim returns only the job/run ids and the lease
// token. Steps are pulled one at a time from the step API using that token.
export async function requestJob(sessionToken: string): Promise<ClaimedJobResponseDto | null> {
  logger().debug('Polling for job');

  const response = await postJobRequest(sessionToken);

  if (response.status === 204) {
    return null;
  }

  return claimedJobResponseSchema.parse(await response.json());
}

async function postJobRequest(sessionToken: string): Promise<Response> {
  try {
    return await createRunnerSessionClient(sessionToken).post('runners/jobs/request');
  } catch (error) {
    if (!(error instanceof HTTPError) || error.response.status !== 409) throw error;

    if (hasRunnerSessionExhaustedCode(error.data)) {
      throw new RunnerSessionExhaustedError();
    }

    throw error;
  }
}

function hasRunnerSessionExhaustedCode(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    'code' in body &&
    body.code === RUNNER_SESSION_EXHAUSTED_CODE
  );
}

// next/report are idempotent, so we widen ky's retry to POST (off by default): a lost
// response is retried in place, never re-pulling or re-executing a step. A 404 is not
// retried — it surfaces so the loop can stop.
export type LeaseTokenSource = string | (() => string);

export function readLeaseToken(leaseToken: LeaseTokenSource): string {
  return typeof leaseToken === 'function' ? leaseToken() : leaseToken;
}

export function createLeaseClient(leaseToken: LeaseTokenSource): KyInstance {
  return ky.create({
    baseUrl,
    hooks: {
      beforeRequest: [
        ({request}) => {
          request.headers.set('Authorization', `Bearer ${readLeaseToken(leaseToken)}`);
        },
      ],
    },
    retry: {
      methods: ['post'],
      statusCodes: [408, 429, 500, 502, 503, 504],
    },
  });
}

export async function requestNextStep(
  leaseClient: KyInstance,
  options: {signal?: AbortSignal} = {},
): Promise<NextStepResponseDto> {
  const response = await leaseClient.post(
    'runs/jobs/current/steps/next',
    options.signal ? {signal: options.signal} : undefined,
  );
  return nextStepResponseSchema.parse(await response.json());
}

export async function reportStep(
  leaseClient: KyInstance,
  params: {
    stepId: string;
    attempt: number;
    status: 'succeeded' | 'failed';
    error?: StepErrorDto;
    exitCode: number | null;
    logOutcome: LogOutcomeDto;
    response?: string | null;
    outputs?: Record<string, string> | null;
    signal?: AbortSignal;
  },
): Promise<ReportStepResponseDto> {
  const error =
    params.error === null || params.error === undefined
      ? params.error
      : {...params.error, message: params.error.message.slice(0, STEP_ERROR_MESSAGE_MAX_LENGTH)};
  const body = reportStepBodySchema.parse({
    status: params.status,
    error: error ?? undefined,
    attempt: params.attempt,
    exit_code: params.exitCode,
    ...(params.response ? {response: params.response.slice(0, STEP_RESPONSE_MAX_LENGTH)} : {}),
    ...(params.outputs ? {output: params.outputs} : {}),
    log_outcome: params.logOutcome,
  });

  const endpoint = `runs/jobs/current/steps/${params.stepId}/report`;
  const requestOptions = {
    json: body,
    ...(params.signal ? {signal: params.signal} : {}),
  };

  let response: Response;
  try {
    response = await leaseClient.post(endpoint, requestOptions);
  } catch (error) {
    if (!(error instanceof HTTPError) || error.response.status !== 400) throw error;

    logger().warn(
      {stepId: params.stepId},
      'Step report rejected with status 400; retrying without error classification fields',
    );
    response = await leaseClient.post(endpoint, {
      ...requestOptions,
      json: {
        ...body,
        ...(body.error == null ? {} : {error: stripStepErrorClassification(body.error)}),
      },
    });
  }

  return reportStepResponseSchema.parse(await response.json());
}

function stripStepErrorClassification(
  error: Exclude<StepErrorDto, null>,
): Pick<Exclude<StepErrorDto, null>, 'message' | 'exit_code' | 'signal'> {
  const {message, exit_code, signal} = error;
  return {message, exit_code, signal};
}

// Exchanges the job lease for short-lived, read-only checkout credentials. The job is
// identified by the lease claims, so no id is sent. Retries ride the leaseClient policy
// (which honors Retry-After); each retry re-mints a fresh short-lived credential.
export async function requestCheckoutToken(
  leaseClient: KyInstance,
  options: {signal?: AbortSignal} = {},
): Promise<CheckoutTokenResponseDto> {
  const response = await leaseClient.post(
    'runs/jobs/current/checkout-token',
    options.signal ? {signal: options.signal} : undefined,
  );
  return checkoutTokenResponseSchema.parse(await response.json());
}

export async function requestAgentRuntimeConfig(
  leaseClient: KyInstance,
  params: {
    stepId: string;
    attempt: number;
    signal?: AbortSignal;
  },
): Promise<AgentRuntimeCredentialsResponseDto> {
  let response: Response;
  try {
    response = await leaseClient.get('runs/jobs/current/agent-runtime-config', {
      searchParams: {step_id: params.stepId, attempt: params.attempt},
      retry: {
        methods: ['get'],
        statusCodes: [429, 500, 502, 503, 504],
      },
      ...(params.signal ? {signal: params.signal} : {}),
    });
  } catch (error) {
    if (error instanceof HTTPError) {
      throw new AgentRuntimeConfigRequestError(error.response.status, codeFromBody(error.data));
    }
    throw error;
  }

  if (response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new AgentRuntimeConfigRequestError(200, 'agent-runtime-config-invalid');
    }

    const parsed = agentRuntimeCredentialsResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new AgentRuntimeConfigRequestError(200, 'agent-runtime-config-invalid');
    }
    return parsed.data;
  }

  throw new AgentRuntimeConfigRequestError(response.status, await errorCode(response));
}

export async function requestStepSecrets(
  leaseClient: KyInstance,
  params: {
    stepId: string;
    attempt: number;
    signal?: AbortSignal;
  },
): Promise<StepSecretsResponseDto> {
  let response: Response;
  try {
    response = await leaseClient.get(`runs/jobs/current/steps/${params.stepId}/secrets`, {
      searchParams: {attempt: params.attempt},
      retry: {
        methods: ['get'],
        statusCodes: [429, 500, 502, 503, 504],
      },
      ...(params.signal ? {signal: params.signal} : {}),
    });
  } catch (error) {
    if (error instanceof HTTPError) {
      throw new StepSecretsRequestError(error.response.status, codeFromBody(error.data));
    }
    throw error;
  }

  if (response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new StepSecretsRequestError(200, 'step-secrets-invalid');
    }

    const parsed = stepSecretsResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new StepSecretsRequestError(200, 'step-secrets-invalid');
    }
    return parsed.data;
  }

  throw new StepSecretsRequestError(response.status, await errorCode(response));
}

// throwHttpErrors:false (below) turns off ky's status-code retry for this call, so no
// HTTP status is retried in-transport here (only network/timeout errors are). Every
// status is mapped explicitly: 409 and the terminal 4xx to outcomes, 5xx/unknown to a
// thrown error the uploader retries on its next tick.
export async function appendStepLogs(
  leaseClient: KyInstance,
  params: {
    stepId: string;
    attempt: number;
    offset: number;
    body: Uint8Array;
    signal?: AbortSignal;
  },
): Promise<LogAppendOutcome> {
  if (!isUuid(params.stepId)) {
    throw new Error(`Invalid step id for log append: ${params.stepId}`);
  }

  // throwHttpErrors:false so we can read the 409 body ourselves (ky discards it when
  // it builds an HTTPError). It also disables ky's status-code retry, so 5xx is not
  // retried in-transport and falls through to the throw below.
  const response = await leaseClient.post(`runs/jobs/current/steps/${params.stepId}/logs`, {
    body: params.body,
    headers: {'content-type': LOG_NDJSON_CONTENT_TYPE},
    searchParams: {attempt: params.attempt, offset: params.offset},
    throwHttpErrors: false,
    ...(params.signal ? {signal: params.signal} : {}),
  });

  if (response.ok) {
    const {committed_length, capped} = appendLogsResponseSchema.parse(await response.json());
    return {status: 'committed', committedLength: committed_length, capped};
  }
  if (response.status === 409) {
    const {details} = offsetGapResponseSchema.parse(await response.json());
    return {status: 'conflict', committedLength: details.committed_length};
  }
  // Any other 4xx is permanent for this request: the endpoint is gone (deploy skew), the
  // lease is rejected (401/403), or the body will never be accepted (400 malformed, 413 too
  // large, 415/422, ...). Re-sending the identical body cannot succeed, so stop and let the
  // server's stream lifecycle close the stream. 408/429 are transient and fall through to
  // the retry path so server-driven backpressure still paces (not storms) the next attempt.
  if (
    response.status >= 400 &&
    response.status < 500 &&
    response.status !== 408 &&
    response.status !== 429
  ) {
    return {status: 'stopped'};
  }
  // 5xx, 408, 429, or any other unexpected status: throw so the uploader logs it and retries
  // on the next tick (throwHttpErrors disables ky's in-transport status-code retry).
  throw new Error(`Log append failed with status ${response.status}`);
}

export async function writeStepAnnotations(
  leaseClient: KyInstance,
  params: {
    stepId: string;
    attempt: number;
    annotations: readonly LeasedWriteAnnotationOperationDto[];
    signal?: AbortSignal;
  },
): Promise<AnnotationWriteOutcome> {
  const body = leasedWriteAnnotationsBodySchema.parse({
    step_id: params.stepId,
    attempt: params.attempt,
    annotations: params.annotations,
  });

  const response = await leaseClient.post('runs/jobs/current/annotations', {
    json: body,
    throwHttpErrors: false,
    retry: 0,
    timeout: ANNOTATION_POST_TIMEOUT_MS,
    ...(params.signal ? {signal: params.signal} : {}),
  });

  if (response.ok) {
    const parsed = leasedWriteAnnotationsResponseSchema.parse(await response.json());
    return {
      status: 'written',
      annotationCount: parsed.accounting.annotation_count,
      totalBodyBytes: parsed.accounting.total_body_bytes,
    };
  }

  const code = await errorCode(response);
  if (response.status === 413 && code !== undefined && ANNOTATION_CAPPED_CODES.has(code)) {
    return {status: 'capped', code};
  }

  return {status: 'rejected', statusCode: response.status, ...(code ? {code} : {})};
}

export async function heartbeat(
  jobId: string,
  leaseToken: string,
  options: {signal?: AbortSignal; capabilities?: RunnerToolCapabilitiesDto} = {},
): Promise<HeartbeatResponseDto> {
  const body =
    options.capabilities === undefined
      ? undefined
      : heartbeatBodySchema.parse({capabilities: options.capabilities});
  const requestOptions = {
    ...(body ? {json: body} : {}),
    ...(options.signal ? {signal: options.signal} : {}),
  };
  const response = await createLeaseClient(leaseToken).post(
    `runners/jobs/${jobId}/heartbeat`,
    Object.keys(requestOptions).length > 0 ? requestOptions : undefined,
  );
  return heartbeatResponseSchema.parse(await response.json());
}

export {HTTPError};

async function errorCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as unknown;
    return codeFromBody(body);
  } catch {
    return undefined;
  }
}

function codeFromBody(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('code' in body)) return undefined;
  return typeof body.code === 'string' ? body.code : undefined;
}

function agentConfigIssueForCode(code: string | undefined): AgentConfigIssueDto | undefined {
  switch (code) {
    case 'agent-config-invalid':
    case 'agent-step-config-invalid':
    case 'agent-runtime-config-invalid':
      return 'step_config_invalid';
    case 'model-provider-not-configured':
      return 'provider_not_configured';
    case 'model-provider-unsupported':
      return 'provider_unsupported';
    case 'agent-model-unavailable':
      return 'model_unavailable';
    case 'model-provider-credentials-invalid':
      return 'credentials_invalid';
    default:
      return undefined;
  }
}
