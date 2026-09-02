import {bool, createConfig, str} from '@shipfox/config';
import {type EgressPolicy, parseEgressHostDenylist} from '@shipfox/node-egress-guard';

export const config = createConfig({
  AGENT_CLAUDE_ANTHROPIC_BASE_URL: str({
    desc: 'Optional Anthropic-compatible base URL for the claude harness. Unset to use the Anthropic API. Set this for automated tests or private runner operations, such as a local Ollama server at http://127.0.0.1:11434.',
    default: undefined,
  }),
  AGENT_CLAUDE_ANTHROPIC_MODEL: str({
    desc: 'Model ID the claude harness sends when AGENT_CLAUDE_ANTHROPIC_BASE_URL is set. Unset to use the model resolved by the API.',
    default: undefined,
  }),
  AGENT_CLAUDE_ANTHROPIC_SMALL_FAST_MODEL: str({
    desc: 'Small fast model ID the claude harness sends when AGENT_CLAUDE_ANTHROPIC_BASE_URL is set. Unset to use the Claude SDK default.',
    default: undefined,
  }),
  AGENT_CUSTOM_PROVIDER_ALLOW_PRIVATE_NETWORKS: bool({
    desc: 'Allows custom model providers to use private, loopback, link-local, metadata, and .internal network targets. Keep this true for local development and self-hosted private networks. Set it to false on cloud instances.',
    default: true,
  }),
  AGENT_CUSTOM_PROVIDER_HOST_DENYLIST: str({
    desc: 'Comma-separated hosts and IP ranges that custom model providers may not call. Accepts exact hosts, suffix patterns such as .internal.example or *.internal.example, IP literals, and CIDR blocks such as 10.0.0.0/8.',
    default: '',
  }),
  SHIPFOX_RUNNER_ENABLE_RENEWABLE_GIT: bool({
    desc: 'Enables the runner-local renewable Git credential broker. Keep this disabled until the runner deployment is ready for renewable checkout credentials.',
    default: false,
  }),
});

export function runnerEgressPolicy(): EgressPolicy {
  return {
    allowPrivateNetworks: config.AGENT_CUSTOM_PROVIDER_ALLOW_PRIVATE_NETWORKS,
    hostDenylist: parseEgressHostDenylist(config.AGENT_CUSTOM_PROVIDER_HOST_DENYLIST),
  };
}
