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
    desc: 'How long a launched instance may run without a runner registering before the provisioner terminates it as stale, in milliseconds. The EC2 provisioner derives the reservation lifetime sent with each demand poll from this setting, so changing it changes both deadlines. The API caps the requested lifetime at RESERVATION_TTL_MAX_SECONDS and does not report the clamp, so raise that ceiling alongside any increase here.',
    default: 300_000,
  }),
  SHIPFOX_PROVISIONER_EC2_RECONCILE_INTERVAL_MS: num({
    desc: 'How often the provisioner runs a full reconcile against the backend, re-deriving truth from EC2 instance tags, in milliseconds.',
    default: 60_000,
  }),
});

requirePositiveInteger(
  'SHIPFOX_PROVISIONER_EC2_REGISTRATION_DEADLINE_MS',
  config.SHIPFOX_PROVISIONER_EC2_REGISTRATION_DEADLINE_MS,
);
requirePositiveInteger(
  'SHIPFOX_PROVISIONER_EC2_RECONCILE_INTERVAL_MS',
  config.SHIPFOX_PROVISIONER_EC2_RECONCILE_INTERVAL_MS,
);
