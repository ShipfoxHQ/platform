import {createConfig, num, str} from '@shipfox/config';

export const config = createConfig({
  IMAGE_REVISION: str({
    desc: 'Optional image revision reported by runners that do not have baked image metadata. Leave it empty when no revision is available.',
    default: '',
  }),
  SHIPFOX_POLL_INTERVAL_MS: num({
    desc: 'How often the runner asks the API for new jobs, in milliseconds. The runner backs off toward SHIPFOX_POLL_MAX_INTERVAL_MS while idle or after errors.',
    default: 1000,
  }),
  SHIPFOX_POLL_MAX_INTERVAL_MS: num({
    desc: 'Largest interval the poll backoff can reach, in milliseconds. This caps how long the runner waits between job checks.',
    default: 5000,
  }),
  SHIPFOX_POLL_MAX_DURATION_MS: num({
    desc: 'Maximum time the runner keeps polling without claiming a job, in milliseconds. Set to 0 for local or manual runners that should poll forever.',
    default: 300_000,
  }),
  SHIPFOX_HEARTBEAT_INTERVAL_MS: num({
    desc: "How often the runner sends a heartbeat, in milliseconds. Keep it well below the server's stuck-job threshold of 180 seconds.",
    default: 10_000,
  }),
  SHIPFOX_HEARTBEAT_MAX_STALE_MS: num({
    desc: 'How long a single heartbeat request may stay open, in milliseconds. After this time the runner cancels it and starts the next one. This limits overlapping requests when the API hangs.',
    default: 10_000,
  }),
});

if (config.SHIPFOX_POLL_MAX_DURATION_MS < 0) {
  throw new Error(
    `SHIPFOX_POLL_MAX_DURATION_MS must be greater than or equal to 0; got ${config.SHIPFOX_POLL_MAX_DURATION_MS}.`,
  );
}

if (config.SHIPFOX_POLL_INTERVAL_MS <= 0) {
  throw new Error(
    `SHIPFOX_POLL_INTERVAL_MS must be greater than 0; got ${config.SHIPFOX_POLL_INTERVAL_MS}.`,
  );
}

if (config.SHIPFOX_POLL_MAX_INTERVAL_MS < config.SHIPFOX_POLL_INTERVAL_MS) {
  throw new Error(
    `SHIPFOX_POLL_MAX_INTERVAL_MS must be greater than or equal to SHIPFOX_POLL_INTERVAL_MS; got ${config.SHIPFOX_POLL_MAX_INTERVAL_MS} and ${config.SHIPFOX_POLL_INTERVAL_MS}.`,
  );
}
