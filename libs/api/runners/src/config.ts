import {RUNNER_ASSIGNMENT_POLL_DEFAULT_WAIT_SECONDS} from '@shipfox/api-runners-dto';
import {bool, createConfig, num, str} from '@shipfox/config';
import {parseLabelList} from '@shipfox/runner-labels';
import {STUCK_JOB_THRESHOLD_SECONDS} from '#core/maintenance-policy.js';

const EPHEMERAL_REGISTRATION_TOKEN_TTL_HARD_MAX_SECONDS = 3600;
const REGISTRATION_TOKEN_BATCH_HARD_MAX = 1000;
const RUNNER_CONTROL_PLANE_TOKEN_TTL_HARD_MAX_SECONDS = 3600;

export const config = createConfig({
  RUNNER_BOOTSTRAP_TOKEN_TTL_SECONDS: num({
    desc: 'Lifetime of a one-use runner bootstrap token in seconds. The token can only create one runner-control session before it expires.',
    default: 300,
  }),
  RUNNER_CONTROL_SESSION_TTL_SECONDS: num({
    desc: 'Lifetime of a pre-workspace runner-control session in seconds. This session can only enroll, attach its provider identity, and report its own liveness.',
    default: 3600,
  }),
  RUNNER_ACTIVATION_TOKEN_TTL_SECONDS: num({
    desc: 'Lifetime of a one-use activation token in seconds. The token is issued only to an assigned runner-control session and creates one workspace runner session.',
    default: 300,
  }),
  RUNNER_ASSIGNMENT_POLL_MAX_WAIT_SECONDS: num({
    desc: 'Maximum server-side cap for the per-request runner assignment wait, in seconds. Managed runners request their own bounded wait with wait_seconds.',
    default: RUNNER_ASSIGNMENT_POLL_DEFAULT_WAIT_SECONDS,
  }),
  RUNNER_ASSIGNMENT_POLL_INTERVAL_MS: num({
    desc: 'Delay between durable assignment reads while a runner-control session waits for an assignment, in milliseconds.',
    default: 250,
  }),
  RUNNER_RESERVED_LABELS: str({
    desc: 'Comma-separated labels that only installation-scope provisioners may advertise. Any other provisioner or runner has them removed.',
    default: '',
  }),
  EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS: num({
    desc: `Lifetime of a provisioner-minted runner registration token, in seconds. The token can be exchanged once by a runner before this time passes. Set this between 1 and ${EPHEMERAL_REGISTRATION_TOKEN_TTL_HARD_MAX_SECONDS}.`,
    default: 300,
  }),
  REGISTRATION_TOKEN_BATCH_MAX: num({
    desc: `Maximum number of runner registration tokens a provisioner can mint in one batch request. Set this between 1 and ${REGISTRATION_TOKEN_BATCH_HARD_MAX}.`,
    default: 500,
  }),
  PROVISIONER_MINT_RATE_LIMIT_MAX_REQUESTS: num({
    desc: 'Maximum number of batch runner registration token mint requests one provisioner can make per rate-limit window.',
    default: 120,
  }),
  PROVISIONER_MINT_RATE_LIMIT_WINDOW_SECONDS: num({
    desc: 'Rate-limit window for provisioner batch runner registration token mint requests, in seconds.',
    default: 60,
  }),
  EPHEMERAL_REGISTER_RATE_LIMIT_MAX_REQUESTS: num({
    desc: 'Maximum number of runner registration attempts one ephemeral registration token can make per rate-limit window.',
    default: 5,
  }),
  EPHEMERAL_REGISTER_RATE_LIMIT_WINDOW_SECONDS: num({
    desc: 'Rate-limit window for runner registration attempts with one ephemeral registration token, in seconds.',
    default: 60,
  }),
  RUNNERS_RATE_LIMIT_TIMEOUT_MS: num({
    desc: 'Maximum time, in milliseconds, a runners rate-limit storage check may wait before the request fails closed.',
    default: 250,
  }),
  RESERVATION_TTL_SECONDS: num({
    desc: 'Lifetime of a count-based runner reservation, in seconds. Expired reservations stop counting against queued demand.',
    default: 60,
  }),
  RESERVATION_LONG_POLL_MAX_WAIT_SECONDS: num({
    desc: 'Maximum time the provisioner demand poll endpoint waits for reservable demand before returning, in seconds.',
    default: 30,
  }),
  RESERVATION_POLL_INTERVAL_MS: num({
    desc: 'Initial interval between demand re-checks while a provisioner request is waiting, in milliseconds.',
    default: 1000,
  }),
  RESERVATION_POLL_MAX_INTERVAL_MS: num({
    desc: 'Maximum backoff interval between demand re-checks while a provisioner request is waiting, in milliseconds.',
    default: 5000,
  }),
  RUNNER_ACTIVE_WINDOW_SECONDS: num({
    desc: 'Time window, in seconds, used to list active runners from recent heartbeats and provisioned runner reports.',
    default: 60,
  }),
  RUNNER_TOOL_CAPABILITIES_STALE_AFTER_SECONDS: num({
    desc: 'Time window, in seconds, after which a runner tool capability report is treated as stale. Set this higher than the runner heartbeat interval so active runners keep their advertised tools fresh.',
    default: 60,
  }),
  RUNNER_NO_FIRST_HEARTBEAT_GRACE_SECONDS: num({
    desc: 'Grace window, in seconds, before maintenance expires a claimed job that has not sent its first heartbeat. Set this lower than the normal stuck-job threshold so startup crashes release work quickly.',
    default: 60,
  }),
  RUNNER_RECONCILE_TERMINATE_GRACE_SECONDS: num({
    desc: 'Grace window, in seconds, before reconcile marks an absent provisioned runner as terminated. Set this higher than the provisioner report interval so a transient empty or partial observed set does not kill a live runner.',
    default: 120,
  }),
  RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS: num({
    desc: 'Time, in seconds, after which a provisioned runner with no recent report, no live provisioner, no live runner session, and no running job is marked failed by backend maintenance.',
    default: 300,
  }),
  RUNNER_STALE_PROVISIONED_RUNNER_REAPER_LIMIT: num({
    desc: 'Maximum number of stale provisioned runners the maintenance worker marks failed in one run. Higher values clear backlogs faster but hold database locks longer.',
    default: 100,
  }),
  RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS: num({
    desc: 'Minimum time, in seconds, between runner session liveness writes from job request polls. Set this lower than RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS so active idle runners stay fresh.',
    default: 10,
  }),
  RUNNER_SESSION_MANUAL_RETENTION_DAYS: num({
    desc: 'How long manual runner sessions are retained before maintenance deletes them, in days. Set this longer than AUTH_RUNNER_SESSION_TOKEN_EXPIRES_IN so a valid session token never outlives its row.',
    default: 30,
  }),
  RUNNER_SESSION_EPHEMERAL_RETENTION_DAYS: num({
    desc: 'How long ephemeral runner sessions are retained before maintenance deletes them, in days. Set this longer than AUTH_RUNNER_SESSION_TOKEN_EXPIRES_IN so a valid session token never outlives its row.',
    default: 7,
  }),
  RUNNER_SESSION_GC_BATCH_SIZE: num({
    desc: 'Maximum number of expired runner sessions maintenance deletes in one pass.',
    default: 1000,
  }),
  RUNNER_EPHEMERAL_TOKEN_RETENTION_DAYS: num({
    desc: 'How long consumed or expired ephemeral registration tokens are retained for audit and debugging before maintenance deletes them, in days. Active tokens that are neither consumed nor expired are never deleted. This window is independent of the runner-session retention windows.',
    default: 7,
  }),
  RUNNER_EPHEMERAL_TOKEN_GC_BATCH_SIZE: num({
    desc: 'Maximum number of consumed or expired ephemeral registration tokens maintenance deletes in one pass.',
    default: 1000,
  }),
  PROVISIONER_ACTIVE_WINDOW_SECONDS: num({
    desc: 'Time window, in seconds, used to list active provisioners from recent authenticated requests.',
    default: 120,
  }),
  PROVISIONER_LAST_SEEN_THROTTLE_SECONDS: num({
    desc: 'Minimum time, in seconds, between last-seen writes for one provisioner token.',
    default: 10,
  }),
  PROVISIONED_RUNNER_COUNT_DIVERGENCE_TEMPLATE_KEY_LABEL_ENABLED: bool({
    desc: 'Whether runners_provider_runner_count_divergence includes template_key as a metric label. Use true or false. Defaults to false because template keys can create high-cardinality metric series. Set true only when template keys are bounded and stable.',
    default: false,
  }),
});

export const runnerReservedLabels = parseLabelList(config.RUNNER_RESERVED_LABELS);

if (
  !Number.isInteger(config.EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS) ||
  config.EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS < 1 ||
  config.EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS >
    EPHEMERAL_REGISTRATION_TOKEN_TTL_HARD_MAX_SECONDS
) {
  throw new Error(
    `EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS (${config.EPHEMERAL_REGISTRATION_TOKEN_TTL_SECONDS}) must be a whole number of seconds between 1 and ${EPHEMERAL_REGISTRATION_TOKEN_TTL_HARD_MAX_SECONDS}.`,
  );
}

for (const [name, value] of [
  ['RUNNER_BOOTSTRAP_TOKEN_TTL_SECONDS', config.RUNNER_BOOTSTRAP_TOKEN_TTL_SECONDS],
  ['RUNNER_CONTROL_SESSION_TTL_SECONDS', config.RUNNER_CONTROL_SESSION_TTL_SECONDS],
  ['RUNNER_ACTIVATION_TOKEN_TTL_SECONDS', config.RUNNER_ACTIVATION_TOKEN_TTL_SECONDS],
] as const) {
  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > RUNNER_CONTROL_PLANE_TOKEN_TTL_HARD_MAX_SECONDS
  ) {
    throw new Error(
      `${name} (${value}) must be a whole number of seconds between 1 and ${RUNNER_CONTROL_PLANE_TOKEN_TTL_HARD_MAX_SECONDS}.`,
    );
  }
}

if (
  !Number.isInteger(config.RUNNER_ASSIGNMENT_POLL_MAX_WAIT_SECONDS) ||
  config.RUNNER_ASSIGNMENT_POLL_MAX_WAIT_SECONDS < 1
) {
  throw new Error(
    `RUNNER_ASSIGNMENT_POLL_MAX_WAIT_SECONDS (${config.RUNNER_ASSIGNMENT_POLL_MAX_WAIT_SECONDS}) must be a whole number >= 1.`,
  );
}

if (
  !Number.isInteger(config.RUNNER_ASSIGNMENT_POLL_INTERVAL_MS) ||
  config.RUNNER_ASSIGNMENT_POLL_INTERVAL_MS < 0
) {
  throw new Error(
    `RUNNER_ASSIGNMENT_POLL_INTERVAL_MS (${config.RUNNER_ASSIGNMENT_POLL_INTERVAL_MS}) must be a whole number >= 0.`,
  );
}

if (
  !Number.isInteger(config.REGISTRATION_TOKEN_BATCH_MAX) ||
  config.REGISTRATION_TOKEN_BATCH_MAX < 1 ||
  config.REGISTRATION_TOKEN_BATCH_MAX > REGISTRATION_TOKEN_BATCH_HARD_MAX
) {
  throw new Error(
    `REGISTRATION_TOKEN_BATCH_MAX (${config.REGISTRATION_TOKEN_BATCH_MAX}) must be a whole number between 1 and ${REGISTRATION_TOKEN_BATCH_HARD_MAX}.`,
  );
}

for (const [name, value] of [
  ['PROVISIONER_MINT_RATE_LIMIT_MAX_REQUESTS', config.PROVISIONER_MINT_RATE_LIMIT_MAX_REQUESTS],
  ['PROVISIONER_MINT_RATE_LIMIT_WINDOW_SECONDS', config.PROVISIONER_MINT_RATE_LIMIT_WINDOW_SECONDS],
  ['EPHEMERAL_REGISTER_RATE_LIMIT_MAX_REQUESTS', config.EPHEMERAL_REGISTER_RATE_LIMIT_MAX_REQUESTS],
  [
    'EPHEMERAL_REGISTER_RATE_LIMIT_WINDOW_SECONDS',
    config.EPHEMERAL_REGISTER_RATE_LIMIT_WINDOW_SECONDS,
  ],
  ['RUNNERS_RATE_LIMIT_TIMEOUT_MS', config.RUNNERS_RATE_LIMIT_TIMEOUT_MS],
] as const) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} (${value}) must be a whole number >= 1.`);
  }
}

if (!Number.isInteger(config.RESERVATION_TTL_SECONDS) || config.RESERVATION_TTL_SECONDS < 1) {
  throw new Error(
    `RESERVATION_TTL_SECONDS (${config.RESERVATION_TTL_SECONDS}) must be a whole number of seconds >= 1.`,
  );
}

if (
  !Number.isInteger(config.RESERVATION_LONG_POLL_MAX_WAIT_SECONDS) ||
  config.RESERVATION_LONG_POLL_MAX_WAIT_SECONDS < 0
) {
  throw new Error(
    `RESERVATION_LONG_POLL_MAX_WAIT_SECONDS (${config.RESERVATION_LONG_POLL_MAX_WAIT_SECONDS}) must be a whole number of seconds >= 0.`,
  );
}

if (
  !Number.isInteger(config.RESERVATION_POLL_INTERVAL_MS) ||
  config.RESERVATION_POLL_INTERVAL_MS < 1
) {
  throw new Error(
    `RESERVATION_POLL_INTERVAL_MS (${config.RESERVATION_POLL_INTERVAL_MS}) must be a whole number of milliseconds >= 1.`,
  );
}

if (
  !Number.isInteger(config.RESERVATION_POLL_MAX_INTERVAL_MS) ||
  config.RESERVATION_POLL_MAX_INTERVAL_MS < config.RESERVATION_POLL_INTERVAL_MS
) {
  throw new Error(
    `RESERVATION_POLL_MAX_INTERVAL_MS (${config.RESERVATION_POLL_MAX_INTERVAL_MS}) must be a whole number of milliseconds >= RESERVATION_POLL_INTERVAL_MS (${config.RESERVATION_POLL_INTERVAL_MS}).`,
  );
}

if (
  !Number.isInteger(config.RUNNER_ACTIVE_WINDOW_SECONDS) ||
  config.RUNNER_ACTIVE_WINDOW_SECONDS < 1
) {
  throw new Error(
    `RUNNER_ACTIVE_WINDOW_SECONDS (${config.RUNNER_ACTIVE_WINDOW_SECONDS}) must be a whole number of seconds >= 1.`,
  );
}

if (
  !Number.isInteger(config.RUNNER_TOOL_CAPABILITIES_STALE_AFTER_SECONDS) ||
  config.RUNNER_TOOL_CAPABILITIES_STALE_AFTER_SECONDS < 1
) {
  throw new Error(
    `RUNNER_TOOL_CAPABILITIES_STALE_AFTER_SECONDS (${config.RUNNER_TOOL_CAPABILITIES_STALE_AFTER_SECONDS}) must be a whole number of seconds >= 1.`,
  );
}

if (
  !Number.isInteger(config.RUNNER_NO_FIRST_HEARTBEAT_GRACE_SECONDS) ||
  config.RUNNER_NO_FIRST_HEARTBEAT_GRACE_SECONDS < 1 ||
  config.RUNNER_NO_FIRST_HEARTBEAT_GRACE_SECONDS >= STUCK_JOB_THRESHOLD_SECONDS
) {
  throw new Error(
    `RUNNER_NO_FIRST_HEARTBEAT_GRACE_SECONDS (${config.RUNNER_NO_FIRST_HEARTBEAT_GRACE_SECONDS}) must be a whole number of seconds >= 1 and < ${STUCK_JOB_THRESHOLD_SECONDS}.`,
  );
}

if (
  !Number.isInteger(config.RUNNER_RECONCILE_TERMINATE_GRACE_SECONDS) ||
  config.RUNNER_RECONCILE_TERMINATE_GRACE_SECONDS < 1
) {
  throw new Error(
    `RUNNER_RECONCILE_TERMINATE_GRACE_SECONDS (${config.RUNNER_RECONCILE_TERMINATE_GRACE_SECONDS}) must be a whole number of seconds >= 1.`,
  );
}

if (
  !Number.isInteger(config.RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS) ||
  config.RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS < 1
) {
  throw new Error(
    `RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS (${config.RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS}) must be a whole number of seconds >= 1.`,
  );
}

if (
  !Number.isInteger(config.RUNNER_STALE_PROVISIONED_RUNNER_REAPER_LIMIT) ||
  config.RUNNER_STALE_PROVISIONED_RUNNER_REAPER_LIMIT < 1
) {
  throw new Error(
    `RUNNER_STALE_PROVISIONED_RUNNER_REAPER_LIMIT (${config.RUNNER_STALE_PROVISIONED_RUNNER_REAPER_LIMIT}) must be a whole number >= 1.`,
  );
}

if (
  !Number.isInteger(config.RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS) ||
  config.RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS < 1
) {
  throw new Error(
    `RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS (${config.RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS}) must be a whole number of seconds >= 1.`,
  );
}

if (
  !Number.isInteger(config.RUNNER_SESSION_MANUAL_RETENTION_DAYS) ||
  config.RUNNER_SESSION_MANUAL_RETENTION_DAYS < 1
) {
  throw new Error(
    `RUNNER_SESSION_MANUAL_RETENTION_DAYS (${config.RUNNER_SESSION_MANUAL_RETENTION_DAYS}) must be a whole number of days >= 1.`,
  );
}

if (
  !Number.isInteger(config.RUNNER_SESSION_EPHEMERAL_RETENTION_DAYS) ||
  config.RUNNER_SESSION_EPHEMERAL_RETENTION_DAYS < 1
) {
  throw new Error(
    `RUNNER_SESSION_EPHEMERAL_RETENTION_DAYS (${config.RUNNER_SESSION_EPHEMERAL_RETENTION_DAYS}) must be a whole number of days >= 1.`,
  );
}

if (
  !Number.isInteger(config.RUNNER_SESSION_GC_BATCH_SIZE) ||
  config.RUNNER_SESSION_GC_BATCH_SIZE < 1
) {
  throw new Error(
    `RUNNER_SESSION_GC_BATCH_SIZE (${config.RUNNER_SESSION_GC_BATCH_SIZE}) must be a whole number >= 1.`,
  );
}

if (
  !Number.isInteger(config.RUNNER_EPHEMERAL_TOKEN_RETENTION_DAYS) ||
  config.RUNNER_EPHEMERAL_TOKEN_RETENTION_DAYS < 1
) {
  throw new Error(
    `RUNNER_EPHEMERAL_TOKEN_RETENTION_DAYS (${config.RUNNER_EPHEMERAL_TOKEN_RETENTION_DAYS}) must be a whole number of days >= 1.`,
  );
}

if (
  !Number.isInteger(config.RUNNER_EPHEMERAL_TOKEN_GC_BATCH_SIZE) ||
  config.RUNNER_EPHEMERAL_TOKEN_GC_BATCH_SIZE < 1
) {
  throw new Error(
    `RUNNER_EPHEMERAL_TOKEN_GC_BATCH_SIZE (${config.RUNNER_EPHEMERAL_TOKEN_GC_BATCH_SIZE}) must be a whole number >= 1.`,
  );
}

if (
  !Number.isInteger(config.PROVISIONER_ACTIVE_WINDOW_SECONDS) ||
  config.PROVISIONER_ACTIVE_WINDOW_SECONDS < 1
) {
  throw new Error(
    `PROVISIONER_ACTIVE_WINDOW_SECONDS (${config.PROVISIONER_ACTIVE_WINDOW_SECONDS}) must be a whole number of seconds >= 1.`,
  );
}

if (
  !Number.isInteger(config.PROVISIONER_LAST_SEEN_THROTTLE_SECONDS) ||
  config.PROVISIONER_LAST_SEEN_THROTTLE_SECONDS < 1
) {
  throw new Error(
    `PROVISIONER_LAST_SEEN_THROTTLE_SECONDS (${config.PROVISIONER_LAST_SEEN_THROTTLE_SECONDS}) must be a whole number of seconds >= 1.`,
  );
}

if (
  config.RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS <=
  config.PROVISIONER_LAST_SEEN_THROTTLE_SECONDS
) {
  throw new Error(
    `RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS (${config.RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS}) must be greater than PROVISIONER_LAST_SEEN_THROTTLE_SECONDS (${config.PROVISIONER_LAST_SEEN_THROTTLE_SECONDS}).`,
  );
}

if (
  config.RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS <=
  config.RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS
) {
  throw new Error(
    `RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS (${config.RUNNER_STALE_PROVISIONED_RUNNER_THRESHOLD_SECONDS}) must be greater than RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS (${config.RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS}).`,
  );
}
