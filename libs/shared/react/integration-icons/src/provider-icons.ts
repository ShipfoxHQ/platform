import type {IconName} from '@shipfox/react-ui/icon';

export const FALLBACK_INTEGRATION_ICON: IconName = 'componentLine';

export const PROVIDER_ICONS = {
  github: 'github',
  sentry: 'sentry',
  linear: 'linear',
  slack: 'slack',
  jira: 'jira',
  gitea: 'gitea',
  webhook: 'webhookLine',
} as const satisfies Record<string, IconName>;

/**
 * Looks up an icon by an arbitrary source string. Prefer the literal-keyed
 * `PROVIDER_ICONS.<provider>` access when the provider is statically known.
 */
export function getProviderIcon(source: string): IconName | undefined {
  return (PROVIDER_ICONS as Record<string, IconName>)[source];
}
