import {createConfig, num, str} from '@shipfox/config';

export function requirePositiveInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer; got ${value}.`);
  }
  return value;
}

export const config = createConfig({
  SHIPFOX_PROVISIONER_TEMPLATES_FILE: str({
    desc: 'Path to the YAML file describing the EC2 runner templates this provisioner can start. Required. Each template lists its labels, AMI, instance type, market, networking, and max_concurrency.',
  }),
  AWS_REGION: str({
    desc: 'AWS region the runner instances launch in, such as us-east-1. Required. Read by the AWS SDK and by the provider.',
  }),
  SHIPFOX_PROVISIONER_EC2_REGISTRATION_DEADLINE_MS: num({
    desc: 'How long a launched instance may run without a runner registering before the provisioner terminates it as stale, in milliseconds. The EC2 provisioner adds SHIPFOX_PROVISIONER_EC2_LAUNCH_HEADROOM_MS and derives the reservation lifetime sent with each demand poll from the sum, so changing this setting changes both deadlines. The API caps the requested lifetime at RESERVATION_TTL_MAX_SECONDS and does not report the clamp, so raise that ceiling alongside any increase here.',
    default: 300_000,
  }),
  SHIPFOX_PROVISIONER_EC2_LAUNCH_HEADROOM_MS: num({
    desc: 'Extra time for the API response and EC2 launch call between reservation creation and EC2 recording the instance launch time, in milliseconds. The EC2 provisioner adds this value to SHIPFOX_PROVISIONER_EC2_REGISTRATION_DEADLINE_MS when deriving the reservation lifetime sent with each demand poll. Set RESERVATION_TTL_MAX_SECONDS at least as high as the resulting value because the API silently clamps larger requests.',
    default: 30_000,
  }),
  SHIPFOX_PROVISIONER_EC2_RECONCILE_INTERVAL_MS: num({
    desc: 'How often the provisioner runs a full reconcile against the backend, re-deriving truth from EC2 instance tags, in milliseconds.',
    default: 60_000,
  }),
  SHIPFOX_PROVISIONER_EC2_STOPPING_TIMEOUT_MS: num({
    desc: 'How long an authorized EC2 runner may remain in stopping after its first observed stopping_at timestamp before the provisioner retries termination with force.',
    default: 300_000,
  }),
});

requirePositiveInteger(
  'SHIPFOX_PROVISIONER_EC2_REGISTRATION_DEADLINE_MS',
  config.SHIPFOX_PROVISIONER_EC2_REGISTRATION_DEADLINE_MS,
);
requirePositiveInteger(
  'SHIPFOX_PROVISIONER_EC2_LAUNCH_HEADROOM_MS',
  config.SHIPFOX_PROVISIONER_EC2_LAUNCH_HEADROOM_MS,
);
requirePositiveInteger(
  'SHIPFOX_PROVISIONER_EC2_RECONCILE_INTERVAL_MS',
  config.SHIPFOX_PROVISIONER_EC2_RECONCILE_INTERVAL_MS,
);
requirePositiveInteger(
  'SHIPFOX_PROVISIONER_EC2_STOPPING_TIMEOUT_MS',
  config.SHIPFOX_PROVISIONER_EC2_STOPPING_TIMEOUT_MS,
);
