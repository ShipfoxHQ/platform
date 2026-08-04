import {PROVIDER_ICONS} from '@shipfox/integration-icons';
import type {IconName} from '@shipfox/react-ui/icon';

// Literal union (not string) so `<Link to={catalog.setupPath}>` stays typed
// against TanStack Router's route tree.
export type ProviderSetupPath =
  | '/w/$workspaceSlug/integrations/github'
  | '/w/$workspaceSlug/integrations/gitea'
  | '/w/$workspaceSlug/integrations/sentry'
  | '/w/$workspaceSlug/integrations/linear'
  | '/w/$workspaceSlug/integrations/slack'
  | '/w/$workspaceSlug/integrations/jira';

interface RouteProviderCatalogEntry {
  kind: 'redirect-install' | 'direct-connect';
  iconName: IconName;
  setupPath: ProviderSetupPath;
}

interface ModalProviderCatalogEntry {
  kind: 'modal-connect';
  iconName: IconName;
}

export type ProviderCatalogEntry = RouteProviderCatalogEntry | ModalProviderCatalogEntry;

export const PROVIDER_CATALOG: Record<string, ProviderCatalogEntry> = {
  github: {
    kind: 'redirect-install',
    iconName: PROVIDER_ICONS.github,
    setupPath: '/w/$workspaceSlug/integrations/github',
  },
  sentry: {
    kind: 'redirect-install',
    iconName: PROVIDER_ICONS.sentry,
    setupPath: '/w/$workspaceSlug/integrations/sentry',
  },
  linear: {
    kind: 'redirect-install',
    iconName: PROVIDER_ICONS.linear,
    setupPath: '/w/$workspaceSlug/integrations/linear',
  },
  slack: {
    kind: 'redirect-install',
    iconName: PROVIDER_ICONS.slack,
    setupPath: '/w/$workspaceSlug/integrations/slack',
  },
  jira: {
    kind: 'redirect-install',
    iconName: PROVIDER_ICONS.jira,
    setupPath: '/w/$workspaceSlug/integrations/jira',
  },
  gitea: {
    kind: 'direct-connect',
    iconName: PROVIDER_ICONS.gitea,
    setupPath: '/w/$workspaceSlug/integrations/gitea',
  },
  webhook: {
    kind: 'modal-connect',
    iconName: PROVIDER_ICONS.webhook,
  },
};
