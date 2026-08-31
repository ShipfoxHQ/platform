import {integrationConnectionFactory} from '#test/factories/connection.js';
import {
  buildAgentToolCatalogs,
  buildAgentToolSelectionCatalogs,
  createWorkspaceConnectionSnapshotLoader,
} from './agent-tool-selection.js';
import {createIntegrationProviderRegistry} from './providers/registry.js';

describe('buildAgentToolSelectionCatalogs', () => {
  it('builds a catalog map from registered agent tool adapters', async () => {
    const selectionCatalog = {
      selectors: [
        {
          token: 'issue_read',
          kind: 'family' as const,
          sensitivity: 'read' as const,
          sensitive: false,
        },
      ],
    };
    const registry = createIntegrationProviderRegistry([
      {
        provider: 'github',
        displayName: 'GitHub',
        adapters: {
          agent_tools: {
            catalog: () => [],
            selectionCatalog: () => selectionCatalog,
            openSession: async () => {
              await Promise.resolve();
              return {
                call: async () => {
                  await Promise.resolve();
                  return {};
                },
              };
            },
          },
        },
      },
    ]);

    const result = await buildAgentToolSelectionCatalogs(registry);

    expect(result.get('github')).toBe(selectionCatalog);
  });
});

describe('buildAgentToolCatalogs', () => {
  it('requires scope classifiers before an agent-tools provider is enforced', async () => {
    const registry = createIntegrationProviderRegistry([
      {
        provider: 'github',
        displayName: 'GitHub',
        repositoryAuthorization: 'enforced',
        adapters: {
          agent_tools: {
            catalog: () => [
              {
                id: 'issue_read',
                description: 'Read an issue',
                sensitivity: 'read',
                sensitive: false,
                requiredScope: [],
                inputSchema: {type: 'object'},
              },
            ],
            selectionCatalog: () => ({selectors: []}),
            openSession: async () => ({call: async () => ({})}),
          },
        },
      },
    ]);

    await expect(buildAgentToolCatalogs(registry)).rejects.toThrow(
      'Agent tool issue_read is missing a repository scope classifier',
    );
  });
});

describe('createWorkspaceConnectionSnapshotLoader', () => {
  it('returns workspace-scoped connection capability snapshots', async () => {
    const workspaceId = crypto.randomUUID();
    const otherWorkspaceId = crypto.randomUUID();
    const registry = createIntegrationProviderRegistry([
      sourceProvider('gitea'),
      agentToolsProvider('github'),
    ]);
    const loader = createWorkspaceConnectionSnapshotLoader(registry);
    const giteaConnection = await integrationConnectionFactory.create({
      workspaceId,
      provider: 'gitea',
      slug: 'gitea_main',
    });
    const githubConnection = await integrationConnectionFactory.create({
      workspaceId,
      provider: 'github',
      slug: 'github_main',
    });
    await integrationConnectionFactory.create({
      workspaceId: otherWorkspaceId,
      provider: 'github',
      slug: 'other_github',
    });

    const snapshot = await loader(workspaceId);

    expect(snapshot).toEqual(
      new Map([
        [
          'gitea_main',
          {id: giteaConnection.id, provider: 'gitea', capabilities: ['source_control']},
        ],
        [
          'github_main',
          {id: githubConnection.id, provider: 'github', capabilities: ['agent_tools']},
        ],
      ]),
    );
  });
});

function sourceProvider(provider: string) {
  return {
    provider,
    displayName: provider,
    adapters: {
      source_control: {
        listRepositories: async () => {
          await Promise.resolve();
          return {repositories: [], nextCursor: null};
        },
        resolveRepository: async () => {
          await Promise.resolve();
          throw new Error('not used');
        },
        listFiles: async () => {
          await Promise.resolve();
          return {files: [], nextCursor: null};
        },
        fetchFile: async () => {
          await Promise.resolve();
          throw new Error('not used');
        },
        resolveTriggerReference: () => null,
        resolveRef: async () => {
          await Promise.resolve();
          throw new Error('not used');
        },
      },
    },
  };
}

function agentToolsProvider(provider: string) {
  return {
    provider,
    displayName: provider,
    adapters: {
      agent_tools: {
        catalog: () => [],
        selectionCatalog: () => ({selectors: []}),
        openSession: async () => {
          await Promise.resolve();
          return {
            call: async () => {
              await Promise.resolve();
              return {};
            },
          };
        },
      },
    },
  };
}
