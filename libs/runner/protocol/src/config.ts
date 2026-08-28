import {createConfig, str} from '@shipfox/config';

let bootstrapToken = process.env.SHIPFOX_RUNNER_BOOTSTRAP_TOKEN ?? '';
delete process.env.SHIPFOX_RUNNER_BOOTSTRAP_TOKEN;

export const config = createConfig({
  SHIPFOX_API_URL: str({
    desc: 'Base URL of the Shipfox API the runner connects to, such as https://api.shipfox.io. Required.',
  }),
  SHIPFOX_RUNNER_REGISTRATION_TOKEN: str({
    desc: 'Manual registration token the runner exchanges for a short-lived runner session token at startup. Use a value starting with sf_mrt_. Set this or SHIPFOX_RUNNER_BOOTSTRAP_TOKEN, but not both.',
    default: '',
  }),
  SHIPFOX_RUNNER_BOOTSTRAP_TOKEN: str({
    desc: 'One-use provisioner-managed bootstrap token. The runner exchanges it for a workspace-neutral control session before waiting for an assignment. Set this or SHIPFOX_RUNNER_REGISTRATION_TOKEN, but not both.',
    default: '',
  }),
  SHIPFOX_RUNNER_PROVIDER_KIND: str({
    desc: 'Provider kind the managed runner declares during enrollment, such as ec2 or docker. Required when SHIPFOX_RUNNER_BOOTSTRAP_TOKEN is set.',
    default: '',
  }),
  SHIPFOX_RUNNER_PROTOCOL_VERSION: str({
    desc: 'Runner protocol version the managed runner declares during enrollment. Use the version supported by this runner image.',
    default: '1',
  }),
  SHIPFOX_RUNNER_LABELS: str({
    desc: 'Comma-separated labels this runner registers with, such as linux,x64,self-hosted. Required, with no default, so startup fails when labels are missing.',
  }),
});

export type RunnerStartupMode = 'direct' | 'managed';

export function runnerStartupMode(): RunnerStartupMode {
  const hasRegistrationToken = config.SHIPFOX_RUNNER_REGISTRATION_TOKEN.length > 0;
  const hasBootstrapToken = bootstrapToken.length > 0;
  if (hasRegistrationToken === hasBootstrapToken) {
    throw new Error(
      'Set exactly one of SHIPFOX_RUNNER_REGISTRATION_TOKEN or SHIPFOX_RUNNER_BOOTSTRAP_TOKEN.',
    );
  }
  if (hasBootstrapToken && config.SHIPFOX_RUNNER_PROVIDER_KIND.length === 0) {
    throw new Error(
      'SHIPFOX_RUNNER_PROVIDER_KIND is required with SHIPFOX_RUNNER_BOOTSTRAP_TOKEN.',
    );
  }
  return hasBootstrapToken ? 'managed' : 'direct';
}

export function consumeManagedRunnerBootstrapToken(): string {
  if (bootstrapToken.length === 0)
    throw new Error('SHIPFOX_RUNNER_BOOTSTRAP_TOKEN is required for managed startup.');
  const token = bootstrapToken;
  bootstrapToken = '';
  return token;
}

export function managedRunnerEnrollmentConfig(): {
  providerKind: string;
  protocolVersion: string;
} {
  return {
    providerKind: config.SHIPFOX_RUNNER_PROVIDER_KIND,
    protocolVersion: config.SHIPFOX_RUNNER_PROTOCOL_VERSION,
  };
}
