import {Factory} from 'fishery';
import type {VcsConnection} from '#core/entities/index.js';
import {createVcsConnection} from '#db/index.js';

export const vcsConnectionFactory = Factory.define<VcsConnection>(({sequence, onCreate}) => {
  onCreate((connection) =>
    createVcsConnection({
      workspaceId: connection.workspaceId,
      provider: connection.provider,
      providerHost: connection.providerHost,
      externalConnectionId: connection.externalConnectionId,
      displayName: connection.displayName,
      credentials: connection.credentials,
    }),
  );

  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    provider: 'test',
    providerHost: 'test.local',
    externalConnectionId: `installation-${sequence}`,
    displayName: `Test Connection ${sequence}`,
    credentials: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
});
