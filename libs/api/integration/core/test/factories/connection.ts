import {Factory} from 'fishery';
import type {IntegrationConnection} from '#core/entities/connection.js';
import {upsertIntegrationConnection} from '#db/connections.js';

export const integrationConnectionFactory = Factory.define<IntegrationConnection>(
  ({sequence, onCreate}) => {
    onCreate(upsertIntegrationConnection);

    return {
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      provider: 'debug',
      externalAccountId: `debug-${sequence}`,
      displayName: `Debug Connection ${sequence}`,
      lifecycleStatus: 'active',
      capabilities: ['source_control'],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  },
);
