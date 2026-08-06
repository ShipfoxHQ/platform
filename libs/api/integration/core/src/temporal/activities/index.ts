import {Context} from '@temporalio/activity';
import type {IntegrationProviderRegistry} from '#core/providers/registry.js';
import {processIntegrationSecretCleanups} from '#core/secret-cleanup.js';
import {pruneWebhookDeliveriesActivity} from './prune-webhook-deliveries.js';

export function createIntegrationsMaintenanceActivities(options: {
  registry: IntegrationProviderRegistry;
}) {
  return {
    pruneWebhookDeliveriesActivity,
    cleanupIntegrationSecretsActivity: () =>
      processIntegrationSecretCleanups({
        registry: options.registry,
        heartbeat: () => Context.current().heartbeat(),
      }),
  };
}
