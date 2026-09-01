import {createConfig, num, str, url} from '@shipfox/config';

/** The API caps reservations per poll at 1000; configuration may not ask for more. */
const MAX_RESERVATIONS_PER_POLL = 1000;
/** The API caps a runner-instance creation batch at 1000 instances per request. */
const MAX_RUNNER_INSTANCE_BATCH = 1000;

export const config = createConfig({
  SHIPFOX_API_URL: url({
    desc: 'Base URL of the Shipfox API the provisioner connects to. Defaults to https://api.shipfox.io; set it when using a self-hosted Shipfox API.',
    default: 'https://api.shipfox.io',
  }),
  SHIPFOX_RUNNER_API_URL: url({
    desc: 'Base URL injected into runner containers as SHIPFOX_API_URL. Defaults to SHIPFOX_API_URL; set it when containers reach the API through a different address than the provisioner uses.',
    default: undefined,
  }),
  SHIPFOX_PROVISIONER_TOKEN: str({
    desc: 'Long-lived provisioner token used to authenticate control-plane calls. Required, with no default, so startup fails when it is missing rather than sending a predictable token.',
  }),
  SHIPFOX_PROVISIONER_POLL_WAIT_SECONDS: num({
    desc: 'How long each demand poll waits for work before returning, in seconds. Higher values reduce request volume; the server may cap it. Use 0 for a non-blocking poll.',
    default: 30,
  }),
  SHIPFOX_PROVISIONER_POLL_INTERVAL_MS: num({
    desc: 'How long the provisioner waits between demand polls, in milliseconds. The provisioner backs off toward SHIPFOX_PROVISIONER_POLL_MAX_INTERVAL_MS after errors.',
    default: 1000,
  }),
  SHIPFOX_PROVISIONER_POLL_MAX_INTERVAL_MS: num({
    desc: 'Largest interval the poll backoff can reach after repeated errors, in milliseconds.',
    default: 5000,
  }),
  SHIPFOX_PROVISIONER_CONVERGE_INTERVAL_MS: num({
    desc: 'How often the provisioner observes and reconciles provider state, in milliseconds.',
    default: 1000,
  }),
  SHIPFOX_PROVISIONER_MAX_RESERVATIONS: num({
    desc: 'Most reservations the provisioner requests in one poll. The provisioner also never asks for more than its templates have free capacity, and the API caps a single poll at 1000.',
    default: 250,
  }),
  SHIPFOX_PROVISIONER_RUNNER_INSTANCE_BATCH_SIZE: num({
    desc: 'How many runner instances the provisioner creates per request, between 1 and 1000. Larger batches reduce request volume at the cost of bigger responses.',
    default: 250,
  }),
  SHIPFOX_RUNNER_POLL_MAX_DURATION_MS: num({
    desc: 'Value injected into each runner as SHIPFOX_POLL_MAX_DURATION_MS: how long a started runner keeps polling for a job before exiting, in milliseconds. Use 0 for runners that should poll forever.',
    default: 300_000,
  }),
  SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS: num({
    desc: 'Legacy lifetime value emitted as SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS for compatibility with older runner images. Timer-free images accept it without scheduling age-based shutdown.',
    default: 3600,
  }),
});

// wait_seconds, max_reservations, and the batch size are sent to integer-typed API
// fields, so a fractional value would fail at request time, not startup. Enforce the
// integer here to keep validation fail-fast.
if (
  !Number.isInteger(config.SHIPFOX_PROVISIONER_POLL_WAIT_SECONDS) ||
  config.SHIPFOX_PROVISIONER_POLL_WAIT_SECONDS < 0
) {
  throw new Error(
    `SHIPFOX_PROVISIONER_POLL_WAIT_SECONDS must be a non-negative integer; got ${config.SHIPFOX_PROVISIONER_POLL_WAIT_SECONDS}.`,
  );
}

if (config.SHIPFOX_PROVISIONER_POLL_INTERVAL_MS <= 0) {
  throw new Error(
    `SHIPFOX_PROVISIONER_POLL_INTERVAL_MS must be greater than 0; got ${config.SHIPFOX_PROVISIONER_POLL_INTERVAL_MS}.`,
  );
}

if (config.SHIPFOX_PROVISIONER_POLL_MAX_INTERVAL_MS < config.SHIPFOX_PROVISIONER_POLL_INTERVAL_MS) {
  throw new Error(
    `SHIPFOX_PROVISIONER_POLL_MAX_INTERVAL_MS must be greater than or equal to SHIPFOX_PROVISIONER_POLL_INTERVAL_MS; got ${config.SHIPFOX_PROVISIONER_POLL_MAX_INTERVAL_MS} and ${config.SHIPFOX_PROVISIONER_POLL_INTERVAL_MS}.`,
  );
}

if (config.SHIPFOX_PROVISIONER_CONVERGE_INTERVAL_MS <= 0) {
  throw new Error(
    `SHIPFOX_PROVISIONER_CONVERGE_INTERVAL_MS must be greater than 0; got ${config.SHIPFOX_PROVISIONER_CONVERGE_INTERVAL_MS}.`,
  );
}

if (
  !Number.isInteger(config.SHIPFOX_PROVISIONER_MAX_RESERVATIONS) ||
  config.SHIPFOX_PROVISIONER_MAX_RESERVATIONS < 0 ||
  config.SHIPFOX_PROVISIONER_MAX_RESERVATIONS > MAX_RESERVATIONS_PER_POLL
) {
  throw new Error(
    `SHIPFOX_PROVISIONER_MAX_RESERVATIONS must be an integer between 0 and ${MAX_RESERVATIONS_PER_POLL}; got ${config.SHIPFOX_PROVISIONER_MAX_RESERVATIONS}.`,
  );
}

if (
  !Number.isInteger(config.SHIPFOX_PROVISIONER_RUNNER_INSTANCE_BATCH_SIZE) ||
  config.SHIPFOX_PROVISIONER_RUNNER_INSTANCE_BATCH_SIZE < 1 ||
  config.SHIPFOX_PROVISIONER_RUNNER_INSTANCE_BATCH_SIZE > MAX_RUNNER_INSTANCE_BATCH
) {
  throw new Error(
    `SHIPFOX_PROVISIONER_RUNNER_INSTANCE_BATCH_SIZE must be an integer between 1 and ${MAX_RUNNER_INSTANCE_BATCH}; got ${config.SHIPFOX_PROVISIONER_RUNNER_INSTANCE_BATCH_SIZE}.`,
  );
}

if (config.SHIPFOX_RUNNER_POLL_MAX_DURATION_MS < 0) {
  throw new Error(
    `SHIPFOX_RUNNER_POLL_MAX_DURATION_MS must be greater than or equal to 0; got ${config.SHIPFOX_RUNNER_POLL_MAX_DURATION_MS}.`,
  );
}

if (
  !Number.isInteger(config.SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS) ||
  config.SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS <= 0
) {
  throw new Error(
    `SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS must be a positive integer; got ${config.SHIPFOX_RUNNER_MAX_LIFETIME_SECONDS}.`,
  );
}
