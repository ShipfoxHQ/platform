import {
  agentThinkingSchema,
  buildHarnessToolDeploymentConfig,
  isReservedModelProviderId,
  type ManagedModelProvider,
  managedModelApiSchema,
  managedModelMetadataSchema,
  modelProviderRefSchema,
  SUPPORTED_MODEL_PROVIDER_IDS,
  type WorkspaceProvidersPolicy,
} from '@shipfox/api-agent-dto';
import {bool, createConfig, num, str, url} from '@shipfox/config';
import {logger} from '@shipfox/node-opentelemetry';
import {WorkspaceProvidersDisabledError} from '#core/errors.js';
import {getModelProviderEntry} from '#core/model-provider-policy.js';
import {decodeBase64SessionKek} from '#core/session-artifacts/crypto.js';

/**
 * Workflows' default maximum job execution duration (`DEFAULT_EXECUTION_MAX_DURATION_MS`
 * in `job-execution-orchestration.ts`). The session reap threshold must exceed it:
 * the runner re-mints its job lease on every heartbeat, so a live step can hold a
 * claim for the whole execution even though the lease TTL is far shorter. This is
 * the default for `AGENT_SESSION_MAX_JOB_EXECUTION_SECONDS` and the fallback when
 * that knob is invalid; it is the safety floor used by the fail-soft startup warning
 * and the reap activity's self-disable check, not a liveness signal.
 */
const WORKFLOWS_DEFAULT_MAX_EXECUTION_SECONDS = 6 * 60 * 60;

/**
 * Upper bound for the resolved job-terminated grace window (one day). The
 * grace-then-release workflow derives its execution timeout from the grace
 * (`graceSeconds * 1000` plus the activity timeout and a margin), so an
 * unbounded finite value could overflow that timeout to `Infinity` and make
 * `workflow.start` reject; a bound also keeps the `sleep` inside the workflow a
 * valid Temporal duration.
 */
const MAX_CLOSE_GRACE_SECONDS = 24 * 60 * 60;

const AGENT_THINKING_CHOICES = agentThinkingSchema.options;
const SUPPORTED_PROVIDER_IDS_DESCRIPTION = SUPPORTED_MODEL_PROVIDER_IDS.join(', ');

export const config = createConfig({
  AGENT_WORKSPACE_PROVIDERS: str({
    desc: 'Controls whether workspaces can configure model providers. Use enabled to preserve the default workspace provider behavior, or disabled when the injected managed provider is the only provider for this instance.',
    choices: ['enabled', 'disabled'],
    default: 'enabled',
  }),
  AGENT_DEFAULT_PROVIDER: str({
    desc: `Instance-wide default model provider ID used when a workflow and workspace do not choose one. Optional. Use one of the supported model catalog IDs (${SUPPORTED_PROVIDER_IDS_DESCRIPTION}) or the injected managed provider.`,
    default: undefined,
  }),
  AGENT_DEFAULT_PROVIDER_MODEL: str({
    desc: 'Instance-wide default model ID used when the resolved provider matches AGENT_DEFAULT_PROVIDER and no workflow or workspace model is set. Optional. Use a model ID supported by that provider.',
    default: undefined,
  }),
  AGENT_DEFAULT_PROVIDER_THINKING: str({
    desc: 'Instance-wide default thinking effort used when the resolved provider matches AGENT_DEFAULT_PROVIDER and no workflow or workspace thinking effort is set. Optional. Accepted values are off, minimal, low, medium, high, and xhigh.',
    choices: AGENT_THINKING_CHOICES,
    default: undefined,
  }),
  AGENT_DEFAULT_PROVIDER_API_KEY: str({
    desc: 'API key for the instance default provider. Optional. Must belong to AGENT_DEFAULT_PROVIDER. If you change the default provider, change this key too. Instance defaults support API-key-only providers.',
    default: undefined,
  }),
  AGENT_PROVIDER_VALIDATION_TIMEOUT_MS: num({
    desc: 'Maximum time in milliseconds to wait for the live provider test request when saving credentials.',
    default: 10000,
  }),
  AGENT_CUSTOM_PROVIDER_ALLOW_PRIVATE_NETWORKS: bool({
    desc: 'Allows custom model providers to use private, loopback, link-local, metadata, and .internal network targets. Keep this true for local development and self-hosted private networks. Set it to false on cloud instances.',
    default: true,
  }),
  AGENT_CUSTOM_PROVIDER_HOST_DENYLIST: str({
    desc: 'Comma-separated hosts and IP ranges that custom model providers may not call. Accepts exact hosts, suffix patterns such as .internal.example or *.internal.example, IP literals, and CIDR blocks such as 10.0.0.0/8.',
    default: '',
  }),
  AGENT_PI_ENABLED_TOOL_PACKAGES: str({
    desc: 'Comma-separated optional Pi tool packages enabled for this deployment. Defaults to pi-web-access so Pi web access is available. Set it to an empty value to enable only Pi built-in tools. Accepted values: pi-web-access.',
    default: 'pi-web-access',
  }),
  AGENT_PI_WEB_SEARCH_ENABLED: bool({
    desc: 'Enables Pi web search tools when pi-web-access is enabled. Set it to false to disable web_search and get_search_content while keeping fetch_content available.',
    default: true,
  }),
  AGENT_SESSION_CLOSE_GRACE_SECONDS: num({
    desc: 'How long to wait after a job reaches a terminal state before force-releasing any agent session claims its steps still hold (a runner that died before reporting, a lost termination event). The wait lets a last in-flight attempt report and release its own claim. Must be a positive integer between 1 and 86400: non-finite, fractional, zero, or negative values fall back to a one-second grace period, and values above 86400 are clamped to one day, so a misconfigured value can never fire the sweep immediately or overflow the release workflow timeout. Defaults to 120 seconds.',
    default: 120,
  }),
  AGENT_SESSION_REAP_AFTER_SECONDS: num({
    desc: "How long a session claim may be held before the reaper cron force-releases it as abandoned. This is the backstop for claims the termination subscribers never cleared. The job lease is renewable on every runner heartbeat and executions run up to their configured maximum duration (6 hours by default), so a live step can legitimately hold a claim longer than any lease TTL: set this above the longest job execution duration for this deployment. The safety check compares against AGENT_SESSION_MAX_JOB_EXECUTION_SECONDS (default 21600 seconds, workflows' 6-hour default maximum execution duration); raise that knob when this deployment allows longer job executions. Defaults to 28800 seconds (8 hours), which covers the 6-hour default maximum execution duration.",
    default: 28800,
  }),
  AGENT_SESSION_MAX_JOB_EXECUTION_SECONDS: num({
    desc: 'The longest a job execution may run in this deployment, used as the safety floor for the stale-claim reap threshold: AGENT_SESSION_REAP_AFTER_SECONDS must exceed it, because a live step can legitimately hold a claim for the whole execution (the job lease is renewable on every runner heartbeat). Match it to the maximum job execution duration actually allowed for this deployment; workflows defaults to 6 hours and jobs can raise it per-job via their execution timeout. Defaults to 21600 seconds (6 hours).',
    default: 21600,
  }),
  AGENT_SESSION_REAP_BATCH_LIMIT: num({
    desc: 'How many stale session claims the reap cron may release per tick. Remaining stale claims are picked up on the next tick. Defaults to 100.',
    default: 100,
  }),
  AGENT_SESSION_STORAGE_S3_ENDPOINT: url({
    desc: 'Endpoint URL of the S3-compatible object store that holds encrypted session transcript artifacts. Defaults to the bundled local-development Garage (http://localhost:3900); set it to your object store endpoint for production.',
    default: 'http://localhost:3900',
  }),
  AGENT_SESSION_STORAGE_S3_REGION: str({
    desc: 'Region passed to the S3 client. Any value works for Garage; set the real region for AWS S3. Defaults to garage for local development.',
    default: 'garage',
  }),
  AGENT_SESSION_STORAGE_S3_BUCKET: str({
    desc: 'Name of the bucket that stores encrypted session transcript artifacts. Defaults to shipfox-agent-sessions (created by dev/garage/bootstrap.sh); create the bucket and set this for production.',
    default: 'shipfox-agent-sessions',
  }),
  AGENT_SESSION_STORAGE_S3_PREFIX: str({
    desc: 'Key prefix under which session transcript artifacts are stored in the bucket. Set this to host several modules in one bucket, each under its own prefix. Use a value without a leading or trailing slash. Defaults to agent-sessions.',
    default: 'agent-sessions',
  }),
  AGENT_SESSION_STORAGE_S3_ACCESS_KEY_ID: str({
    desc: 'Optional access key ID used to authenticate to the object store. Set it together with AGENT_SESSION_STORAGE_S3_SECRET_ACCESS_KEY for an explicit credential pair, or leave both unset to use the standard AWS SDK credential provider chain.',
    default: undefined,
  }),
  AGENT_SESSION_STORAGE_S3_SECRET_ACCESS_KEY: str({
    desc: 'Optional secret access key used to authenticate to the object store. Set it together with AGENT_SESSION_STORAGE_S3_ACCESS_KEY_ID for an explicit credential pair, or leave both unset to use the standard AWS SDK credential provider chain.',
    default: undefined,
  }),
  AGENT_SESSION_STORAGE_S3_FORCE_PATH_STYLE: bool({
    desc: 'Whether to address the bucket as a path (endpoint/bucket) instead of a subdomain. Set it to true for Garage and MinIO; false works for AWS S3.',
    default: true,
  }),
  AGENT_SESSION_ENCRYPTION_KEK: str({
    // No default: envalid enforces this as a required variable at startup, and
    // the module-level `decodeBase64SessionKek` below stays as the second layer
    // that also rejects a malformed (non-canonical base64) value.
    desc: 'Master key used to wrap per-workspace session transcript data keys. Required. Generate a unique value per environment with openssl rand -base64 32 and provide it from a secret manager. Do not reuse SECRETS_ENCRYPTION_KEK. The committed .env value is only for local development. Losing this key makes stored session transcripts unrecoverable. To rotate it, set AGENT_SESSION_ENCRYPTION_KEK_PREVIOUS to the old value during the rotation window.',
  }),
  AGENT_SESSION_ENCRYPTION_KEK_PREVIOUS: str({
    desc: 'Previous master key, set only during a KEK rotation window so DEKs wrapped under the old key stay readable. Optional. Generate with openssl rand -base64 32 and provide it from a secret manager; clear it once every wrapped DEK has been rewrapped under the current key.',
    default: undefined,
  }),
  AGENT_SESSION_BLOB_CAP_BYTES: num({
    desc: 'Maximum size of one compressed session transcript segment, in bytes. The runner uploads the gzipped harness session file; a larger blob fails the commit and the attempt. Defaults to 64 MiB.',
    default: 67_108_864,
  }),
  AGENT_SESSION_RETENTION_DAYS: num({
    desc: 'How many days a session of a terminated run is kept before the retention cron hard-deletes its transcript objects and database row. Our own worker enforces this (not bucket lifecycle rules), so behavior is identical across object stores. Must be a whole number of days, 1 or greater. Defaults to 90 days.',
    default: 90,
  }),
  AGENT_SESSION_SEGMENT_GRACE_SECONDS: num({
    desc: 'How long a superseded transcript segment must stay superseded before the retention cron prunes it, and how long a session must stay unclaimed before orphaned segments (objects written but never flipped into the head) are collected. The wait lets a concurrent fork snapshot read keep its object and an in-flight commit land its head flip. Defaults to 600 seconds (10 minutes).',
    default: 600,
  }),
});

export const workspaceProvidersPolicy =
  config.AGENT_WORKSPACE_PROVIDERS as WorkspaceProvidersPolicy;

export const harnessToolDeploymentConfig = buildHarnessToolDeploymentConfig({
  piEnabledToolPackages: config.AGENT_PI_ENABLED_TOOL_PACKAGES,
  piWebSearchEnabled: config.AGENT_PI_WEB_SEARCH_ENABLED,
});

export function assertAgentConfig(managedProvider?: ManagedModelProvider): void {
  if (managedProvider !== undefined) assertManagedProvider(managedProvider);

  if (workspaceProvidersPolicy === 'disabled') {
    if (managedProvider === undefined) {
      throw new Error(
        'AGENT_WORKSPACE_PROVIDERS=disabled requires an injected managed model provider.',
      );
    }
    if (
      config.AGENT_DEFAULT_PROVIDER !== undefined &&
      config.AGENT_DEFAULT_PROVIDER !== managedProvider.id
    ) {
      throw new WorkspaceProvidersDisabledError(managedProvider.id);
    }
  }

  const defaultProvider = config.AGENT_DEFAULT_PROVIDER;
  if (defaultProvider !== undefined && !isRegisteredProvider(defaultProvider, managedProvider)) {
    throw new Error(
      `AGENT_DEFAULT_PROVIDER must name a supported registered provider: ${defaultProvider}.`,
    );
  }

  if (!config.AGENT_DEFAULT_PROVIDER_API_KEY) return;
  if (!defaultProvider) {
    throw new Error('AGENT_DEFAULT_PROVIDER_API_KEY requires AGENT_DEFAULT_PROVIDER to be set.');
  }
  if (managedProvider?.id === defaultProvider) {
    throw new Error('AGENT_DEFAULT_PROVIDER_API_KEY cannot be used with a managed model provider.');
  }

  const credentialFields = getModelProviderEntry(defaultProvider)?.credential_fields ?? [];
  const field = credentialFields[0];
  if (credentialFields.length === 1 && field?.key === 'api_key' && field.secret) return;

  throw new Error(
    'AGENT_DEFAULT_PROVIDER_API_KEY requires AGENT_DEFAULT_PROVIDER to use exactly one secret api_key credential field.',
  );
}

/**
 * Resolved job-terminated grace window: a finite integer between 1 second and
 * `MAX_CLOSE_GRACE_SECONDS`. Non-finite, fractional, zero, or negative values
 * fall back to 1 second so a misconfigured value cannot silently produce a
 * different grace period; values above the cap are clamped so the
 * grace-then-release workflow always sleeps a bounded, positive duration (a
 * non-finite value would otherwise reach `sleep` as `NaN`/`Infinity`, and an
 * unbounded finite value could overflow the derived execution timeout).
 */
export function resolveCloseGraceSeconds(): number {
  const grace = config.AGENT_SESSION_CLOSE_GRACE_SECONDS;
  if (!Number.isFinite(grace) || !Number.isInteger(grace) || grace < 1) return 1;
  return Math.min(grace, MAX_CLOSE_GRACE_SECONDS);
}

/**
 * Resolved maximum job execution duration for this deployment: a finite integer
 * of at least 1 second, used as the safety floor for the reap threshold. Invalid
 * values fall back to the workflows default (6 hours) so a misconfigured knob
 * can never make the reaper treat an unsafe threshold as safe.
 */
export function resolveMaxJobExecutionSeconds(): number {
  const maxExecution = config.AGENT_SESSION_MAX_JOB_EXECUTION_SECONDS;
  if (!Number.isFinite(maxExecution) || !Number.isInteger(maxExecution) || maxExecution < 1) {
    return WORKFLOWS_DEFAULT_MAX_EXECUTION_SECONDS;
  }
  return maxExecution;
}

/**
 * Resolved reap batch limit: a finite integer of at least 1. Zero would select
 * no stale claims per tick; negative or fractional values can fail the SQL
 * `LIMIT`; invalid values fall back to the documented default of 100.
 */
export function resolveReapBatchLimit(): number {
  const limit = config.AGENT_SESSION_REAP_BATCH_LIMIT;
  return Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : 100;
}

/**
 * Whether the reap threshold is unsafe to run the destructive stale-claim
 * sweep: non-finite or non-positive values treat every claim as stale, and a
 * value at or below the maximum job execution duration allowed for this
 * deployment (`AGENT_SESSION_MAX_JOB_EXECUTION_SECONDS`) can release a claim a
 * still-running step legitimately holds (the job lease is renewable on every
 * heartbeat). When unsafe, the reap activity disables itself instead of
 * force-releasing live claims.
 */
export function isUnsafeReapAfterSeconds(): boolean {
  const reapAfter = config.AGENT_SESSION_REAP_AFTER_SECONDS;
  return (
    !Number.isFinite(reapAfter) || reapAfter <= 0 || reapAfter <= resolveMaxJobExecutionSeconds()
  );
}

/**
 * Fail-soft startup check for the session claim lifecycle knobs. Logs a warning
 * instead of aborting module creation: an unsafe value must not take down every
 * instance for configurations that were valid before these knobs existed. The
 * reaper threshold is a backstop heuristic, not a liveness signal, so the
 * warning only flags values that are unsafe against the maximum job execution
 * duration configured for this deployment, never against the (renewable) job
 * lease TTL. This is the only place the reap-safety warning is emitted; the
 * reap activity itself stays silent on unsafe ticks.
 */
export function warnOnUnsafeAgentSessionConfig(): void {
  const reapAfter = config.AGENT_SESSION_REAP_AFTER_SECONDS;
  const maxJobExecutionSeconds = resolveMaxJobExecutionSeconds();
  if (!Number.isFinite(reapAfter) || reapAfter <= 0) {
    logger().warn(
      {reapAfterSeconds: reapAfter},
      'AGENT_SESSION_REAP_AFTER_SECONDS must be a positive number of seconds above the longest job execution duration; with this value the reaper treats every claim as stale and can break single-writer exclusivity for still-running steps.',
    );
  } else if (reapAfter <= maxJobExecutionSeconds) {
    logger().warn(
      {
        reapAfterSeconds: reapAfter,
        maxJobExecutionSeconds,
      },
      'AGENT_SESSION_REAP_AFTER_SECONDS is at or below the configured maximum job execution duration (AGENT_SESSION_MAX_JOB_EXECUTION_SECONDS): a still-running step can legitimately hold a claim past this threshold (the job lease is renewable on heartbeats), so the reaper may release a live claim. Set it above the longest job execution duration for this deployment.',
    );
  }

  const closeGrace = config.AGENT_SESSION_CLOSE_GRACE_SECONDS;
  if (!Number.isFinite(closeGrace) || !Number.isInteger(closeGrace) || closeGrace < 1) {
    logger().warn(
      {closeGraceSeconds: closeGrace},
      'AGENT_SESSION_CLOSE_GRACE_SECONDS must be a positive integer; invalid values are clamped to a one-second grace period by the job-terminated subscriber, which may race the last in-flight attempt report.',
    );
  } else if (closeGrace > MAX_CLOSE_GRACE_SECONDS) {
    logger().warn(
      {closeGraceSeconds: closeGrace, maxCloseGraceSeconds: MAX_CLOSE_GRACE_SECONDS},
      'AGENT_SESSION_CLOSE_GRACE_SECONDS is above the one-day maximum and is clamped by the job-terminated subscriber; set it within the supported range if a longer grace window is intended.',
    );
  }

  const reapBatchLimit = config.AGENT_SESSION_REAP_BATCH_LIMIT;
  if (!Number.isFinite(reapBatchLimit) || reapBatchLimit < 1 || !Number.isInteger(reapBatchLimit)) {
    logger().warn(
      {reapBatchLimit},
      'AGENT_SESSION_REAP_BATCH_LIMIT must be a finite integer of at least 1; invalid values fall back to the default of 100 for each reap tick.',
    );
  }
}

function isRegisteredProvider(
  providerId: string,
  managedProvider: ManagedModelProvider | undefined,
): boolean {
  if (managedProvider?.id === providerId) return true;
  return getModelProviderEntry(providerId)?.support_status === 'supported';
}

const hasSessionS3AccessKeyId = Boolean(config.AGENT_SESSION_STORAGE_S3_ACCESS_KEY_ID);
const hasSessionS3SecretAccessKey = Boolean(config.AGENT_SESSION_STORAGE_S3_SECRET_ACCESS_KEY);
if (hasSessionS3AccessKeyId !== hasSessionS3SecretAccessKey) {
  throw new Error(
    'AGENT_SESSION_STORAGE_S3_ACCESS_KEY_ID and AGENT_SESSION_STORAGE_S3_SECRET_ACCESS_KEY must be set together or both left unset.',
  );
}

decodeBase64SessionKek(config.AGENT_SESSION_ENCRYPTION_KEK, 'AGENT_SESSION_ENCRYPTION_KEK');
if (config.AGENT_SESSION_ENCRYPTION_KEK_PREVIOUS) {
  decodeBase64SessionKek(
    config.AGENT_SESSION_ENCRYPTION_KEK_PREVIOUS,
    'AGENT_SESSION_ENCRYPTION_KEK_PREVIOUS',
  );
}

if (
  !Number.isInteger(config.AGENT_SESSION_RETENTION_DAYS) ||
  config.AGENT_SESSION_RETENTION_DAYS < 1
) {
  throw new Error(
    `AGENT_SESSION_RETENTION_DAYS (${config.AGENT_SESSION_RETENTION_DAYS}) must be a whole number of days >= 1.`,
  );
}
if (
  !Number.isInteger(config.AGENT_SESSION_SEGMENT_GRACE_SECONDS) ||
  config.AGENT_SESSION_SEGMENT_GRACE_SECONDS < 1
) {
  throw new Error(
    `AGENT_SESSION_SEGMENT_GRACE_SECONDS (${config.AGENT_SESSION_SEGMENT_GRACE_SECONDS}) must be a whole number of seconds >= 1.`,
  );
}
if (
  !Number.isInteger(config.AGENT_SESSION_BLOB_CAP_BYTES) ||
  config.AGENT_SESSION_BLOB_CAP_BYTES < 1
) {
  throw new Error(
    `AGENT_SESSION_BLOB_CAP_BYTES (${config.AGENT_SESSION_BLOB_CAP_BYTES}) must be a whole number of bytes >= 1.`,
  );
}

function assertManagedProvider(provider: ManagedModelProvider): void {
  if (!modelProviderRefSchema.safeParse(provider.id).success) {
    throw new Error(`Managed model provider ID must be a valid provider slug: ${provider.id}.`);
  }
  if (isReservedModelProviderId(provider.id)) {
    throw new Error(`Managed model provider ID is reserved: ${provider.id}.`);
  }
  if (provider.label.length === 0) {
    throw new Error(`Managed model provider label must not be empty: ${provider.id}.`);
  }
  if (provider.models.length === 0) {
    throw new Error(`Managed model provider must define at least one model: ${provider.id}.`);
  }

  const modelIds = new Set<string>();
  for (const model of provider.models) {
    if (model.id.length === 0 || model.label.length === 0) {
      throw new Error(`Managed model provider models must have IDs and labels: ${provider.id}.`);
    }
    if (modelIds.has(model.id)) {
      throw new Error(`Managed model provider models must have unique IDs: ${provider.id}.`);
    }
    modelIds.add(model.id);
    if (!managedModelApiSchema.safeParse(model.api).success) {
      throw new Error(`Managed model provider model API is invalid: ${provider.id}/${model.id}.`);
    }
    if (!managedModelMetadataSchema.safeParse(model).success) {
      throw new Error(
        `Managed model provider model metadata is invalid: ${provider.id}/${model.id}.`,
      );
    }
  }

  if (!modelIds.has(provider.defaultModel)) {
    throw new Error(`Managed model provider default model is not registered: ${provider.id}.`);
  }
  if (
    provider.defaultThinking !== undefined &&
    !agentThinkingSchema.safeParse(provider.defaultThinking).success
  ) {
    throw new Error(`Managed model provider default thinking is invalid: ${provider.id}.`);
  }
  if (typeof provider.resolveCredentials !== 'function') {
    throw new Error(`Managed model provider must resolve credentials: ${provider.id}.`);
  }
}
