import type {IntegrationEventCatalog} from '@shipfox/api-integration-core-dto';
import {giteaWebhookEventNames} from './schemas/index.js';

const giteaWebhookDocsUrl = 'https://docs.gitea.com/usage/repository/webhooks/';

const eventDetails = {
  push: {
    summary: 'A Git reference receives one or more commits.',
    emittedWhen:
      'Gitea sends a push webhook for a non-deleted branch in the connected organization.',
  },
} as const satisfies Record<
  (typeof giteaWebhookEventNames)[number],
  {summary: string; emittedWhen: string}
>;

export const giteaEventCatalog = {
  provider: 'Gitea',
  events: giteaWebhookEventNames.map((name) => ({
    name,
    ...eventDetails[name],
    payloadKind: 'raw-provider' as const,
    payloadDocUrl: giteaWebhookDocsUrl,
  })),
} as const satisfies IntegrationEventCatalog;
