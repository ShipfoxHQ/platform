import {createServer, defaultModules} from '@shipfox/api-server';

const managedProvider = undefined;

void createServer({
  modules: [
    ...(await defaultModules({
      agentModuleOptions: {managedProvider},
      runnersModuleOptions: {
        installationProvisioning: {
          policy: {
            filterEligibleWorkspaceIds: async (workspaceIds) => new Set(workspaceIds),
          },
        },
      },
    })),
    {name: 'external-dummy'},
  ],
});
