import type {IntegrationEventCatalog} from '@shipfox/api-integration-core-dto';

const giteaWebhookDocsUrl = 'https://docs.gitea.com/usage/repository/webhooks/';

// The Gitea webhook handler accepts and publishes only the `push` event; any
// other Gitea webhook event name is recorded and dropped.
export const giteaEventCatalog = {
  provider: 'Gitea',
  events: [
    {
      name: 'push',
      summary: 'A Git reference receives one or more commits.',
      emittedWhen: 'Gitea sends a push webhook to the connected organization.',
      payloadKind: 'raw-provider',
      payloadDocUrl: giteaWebhookDocsUrl,
    },
  ],
} as const satisfies IntegrationEventCatalog;
