import {bool, createConfig, num, str, url} from '@shipfox/config';

export const config = createConfig({
  LOG_STORAGE_S3_ENDPOINT: url({
    desc: 'Optional endpoint override for compacted logs. Leave it unset to use OBJECT_STORAGE_S3_ENDPOINT.',
    default: undefined,
  }),
  LOG_STORAGE_S3_REGION: str({
    desc: 'Optional region override for compacted logs. Leave it unset to use OBJECT_STORAGE_S3_REGION.',
    default: undefined,
  }),
  LOG_STORAGE_S3_BUCKET: str({
    desc: 'Optional bucket override for compacted logs. Leave it unset to use OBJECT_STORAGE_S3_BUCKET.',
    default: undefined,
  }),
  LOG_STORAGE_S3_PREFIX: str({
    desc: 'Key prefix under which compacted log objects are stored in the bucket. Set this to host several modules in one bucket, each under its own prefix. Use a value without a leading or trailing slash. Defaults to logs.',
    default: 'logs',
  }),
  LOG_STORAGE_S3_ACCESS_KEY_ID: str({
    desc: 'Optional access key ID override for compacted logs. Set it with LOG_STORAGE_S3_SECRET_ACCESS_KEY, or leave both unset to use the shared object-store credentials.',
    default: undefined,
  }),
  LOG_STORAGE_S3_SECRET_ACCESS_KEY: str({
    desc: 'Optional secret access key override for compacted logs. Set it with LOG_STORAGE_S3_ACCESS_KEY_ID, or leave both unset to use the shared object-store credentials.',
    default: undefined,
  }),
  LOG_STORAGE_S3_FORCE_PATH_STYLE: bool({
    desc: 'Optional addressing-mode override for compacted logs. Leave it unset to use OBJECT_STORAGE_S3_FORCE_PATH_STYLE.',
    default: undefined,
  }),
  LOG_BUDGET_BASE_BYTES: num({
    desc: 'Base of the per-job log accrual budget, in stored bytes (normalized NDJSON the server keeps, framing included). A job may always store this much before the time-based rate is added. Sized to hold a few inline agent_session entries (such as base64 images) before the shared per-job cap trips. Defaults to 32 MiB.',
    default: 33_554_432,
  }),
  LOG_BUDGET_RATE_BYTES_PER_MINUTE: num({
    desc: 'Stored bytes added to the per-job log budget for each minute since the first log append. Defaults to 1 MiB per minute.',
    default: 1_048_576,
  }),
  LOG_STREAM_CLOSE_GRACE_SECONDS: num({
    desc: 'How long to wait after a job reaches a terminal state before force-closing any of its log streams the runner never ended itself (it died, was capped, or its log spool failed). The wait lets a last in-flight chunk land before the stream is marked truncated. Defaults to 120 seconds.',
    default: 120,
  }),
  LOG_COMPACTION_RECONCILE_STALE_SECONDS: num({
    desc: 'How long a closed log stream may stay uncompacted before the reconcile cron re-drives it, or a durable compaction winner may remain alongside temporary sibling objects before the cron removes them. The event-triggered compaction normally runs within seconds of close; this backstop handles compaction runs that never started or permanently failed and cleans up after a winner is durable. Defaults to 900 seconds (15 minutes).',
    default: 900,
  }),
  LOG_STREAM_REAP_AFTER_SECONDS: num({
    desc: 'How long a log stream may stay open before the reaper cron force-closes it as abandoned. This is the backstop for a stream a runner started after its job already went terminal (the one-shot close sweep had already run); the reaper marks it truncated so it re-enters the compaction and retention lifecycle. The application validates that this exceeds the Auth job lease lifetime. Defaults to 7200 seconds (2 hours).',
    default: 7200,
  }),
  LOG_APPEND_BODY_LIMIT_BYTES: num({
    desc: 'Maximum size of a single log append request body, in bytes. Output records cap at 16 KiB each, but one agent_session record carries a whole session entry (which can inline base64 images), so the body must hold a full LOG_MAX_SESSION_LINE_BYTES line plus framing. This also bounds how far a job can overshoot its log budget: the one append that crosses the budget is stored in full before the job is capped. Defaults to 8 MiB.',
    default: 8_388_608,
  }),
  LOG_MAX_SESSION_LINE_BYTES: num({
    desc: 'Maximum size of one agent_session log line (a verbatim agent session entry), in bytes. A larger line is rejected with 400, and the runner drops it with a gap marker instead of sending it. Sized generously for entries that inline large content such as base64 images. Must be at most LOG_APPEND_BODY_LIMIT_BYTES, since a line that cannot fit in one request body could never be accepted. Defaults to 4 MiB.',
    default: 4_194_304,
  }),
  LOG_READ_URL_TTL_SECONDS: num({
    desc: 'Lifetime, in seconds, of a presigned GET URL handed out for a compacted (cold) log read. The browser must finish fetching the object before it expires; raise it for slow links or large logs. Must be between 1 and 604800 (7 days, the longest a presigned URL can live). Defaults to 3600 (one hour).',
    default: 3600,
  }),
  LOG_READ_INLINE_MAX_BYTES: num({
    desc: 'Maximum number of stored log bytes returned in a single inline (hot) read response. A long-running step can buffer far more than this in Postgres before compaction, so a read is capped here and the client re-polls (following has_more) to drain the backlog before it tails. Bounds per-request memory. Must be at least 1. Defaults to 1 MiB.',
    default: 1_048_576,
  }),
  LOG_RETENTION_DAYS: num({
    desc: 'How many days a closed log stream is kept before the retention cron hard-deletes its stored object and database row. Our own worker enforces this (not bucket lifecycle rules), so behavior is identical across object stores. Must be a whole number of days, 1 or greater. Defaults to 90 days.',
    default: 90,
  }),
});

// SigV4 caps a presigned URL's lifetime at 7 days, so a larger TTL would fail at signing
// time on every cold read. Reject out-of-range values at startup rather than per request.
const MAX_PRESIGN_TTL_SECONDS = 604_800;
if (
  config.LOG_READ_URL_TTL_SECONDS < 1 ||
  config.LOG_READ_URL_TTL_SECONDS > MAX_PRESIGN_TTL_SECONDS
) {
  throw new Error(
    `LOG_READ_URL_TTL_SECONDS must be between 1 and ${MAX_PRESIGN_TTL_SECONDS}; got ${config.LOG_READ_URL_TTL_SECONDS}`,
  );
}
if (config.LOG_READ_INLINE_MAX_BYTES < 1) {
  throw new Error(
    `LOG_READ_INLINE_MAX_BYTES must be at least 1; got ${config.LOG_READ_INLINE_MAX_BYTES}`,
  );
}

// A whole agent_session line is one record in one body. If the body limit is below the
// line cap, a legitimate large session line could never fit in one request body: Fastify
// would 413 it before the per-line validator runs. Fail fast at startup instead.
if (config.LOG_APPEND_BODY_LIMIT_BYTES < config.LOG_MAX_SESSION_LINE_BYTES) {
  throw new Error(
    `LOG_APPEND_BODY_LIMIT_BYTES (${config.LOG_APPEND_BODY_LIMIT_BYTES}) must be >= LOG_MAX_SESSION_LINE_BYTES (${config.LOG_MAX_SESSION_LINE_BYTES}).`,
  );
}

// `num` accepts zero, negative, and fractional values; reject them before they reach
// `make_interval(days => ...)` and hard-delete the wrong streams.
if (!Number.isInteger(config.LOG_RETENTION_DAYS) || config.LOG_RETENTION_DAYS < 1) {
  throw new Error(
    `LOG_RETENTION_DAYS (${config.LOG_RETENTION_DAYS}) must be a whole number of days >= 1.`,
  );
}

export function validateLogStreamReapAfterSeconds(jobLeaseTokenTtlSeconds: number): void {
  if (
    !Number.isFinite(config.LOG_STREAM_REAP_AFTER_SECONDS) ||
    config.LOG_STREAM_REAP_AFTER_SECONDS <= jobLeaseTokenTtlSeconds
  ) {
    throw new Error(
      `LOG_STREAM_REAP_AFTER_SECONDS (${config.LOG_STREAM_REAP_AFTER_SECONDS}) must be greater than the Auth job lease TTL (${jobLeaseTokenTtlSeconds}s); a smaller value would let the reaper force-close a stream a still-valid lease is appending to and silently truncate live logs.`,
    );
  }
}
