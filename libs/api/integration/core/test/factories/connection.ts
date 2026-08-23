import {Factory} from 'fishery';
import type {IntegrationConnection} from '#core/entities/connection.js';
import {upsertIntegrationConnection} from '#db/connections.js';

export const integrationConnectionFactory = Factory.define<IntegrationConnection>(
  ({sequence, onCreate}) => {
    onCreate(upsertIntegrationConnection);

    return {
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      provider: 'gitea',
      externalAccountId: `gitea-${sequence}`,
      slug: `gitea_${sequence}`,
      displayName: `Gitea Connection ${sequence}`,
      lifecycleStatus: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  },
);
