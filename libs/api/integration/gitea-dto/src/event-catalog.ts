import type {IntegrationEventCatalog} from '@shipfox/api-integration-core-dto';
import {giteaWebhookEventNames} from './schemas/index.js';

const eventDetails = {
  push: {
    summary: 'A Gitea repository receives one or more commits.',
    emittedWhen: 'Gitea sends a push webhook for the connected organization.',
  },
} as const satisfies Record<
  (typeof giteaWebhookEventNames)[number],
  {
    summary: string;
    emittedWhen: string;
  }
>;

export const giteaEventCatalog = {
  provider: 'Gitea',
  events: giteaWebhookEventNames.map((name) => ({
    name,
    ...eventDetails[name],
    payloadKind: 'raw-provider' as const,
  })),
} as const satisfies IntegrationEventCatalog;
