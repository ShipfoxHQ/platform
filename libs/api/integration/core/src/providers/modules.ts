import {cronProviderModule} from '#providers/cron.js';
import {giteaProviderModule} from '#providers/gitea.js';
import {githubProviderModule} from '#providers/github.js';
import {jiraProviderModule} from '#providers/jira.js';
import {linearProviderModule} from '#providers/linear.js';
import {sentryProviderModule} from '#providers/sentry.js';
import {slackProviderModule} from '#providers/slack.js';
import {testVcsProviderModule} from '#providers/test-vcs-module.js';
import type {
  IntegrationModuleParts,
  IntegrationProviderModuleLoadOptions,
} from '#providers/types.js';
import {webhookProviderModule} from '#providers/webhook.js';

// Order is significant: databases are migrated in this order, so list a provider
// before any that depend on its tables.
const providerModules = [
  githubProviderModule,
  linearProviderModule,
  slackProviderModule,
  jiraProviderModule,
  sentryProviderModule,
  giteaProviderModule,
  testVcsProviderModule,
  cronProviderModule,
  webhookProviderModule,
];

export async function loadEnabledProviderModules(
  options: IntegrationProviderModuleLoadOptions = {},
): Promise<IntegrationModuleParts[]> {
  const parts: IntegrationModuleParts[] = [];
  for (const module of providerModules) {
    if (!module.enabled) continue;
    parts.push(await module.load(options));
  }
  return parts;
}
