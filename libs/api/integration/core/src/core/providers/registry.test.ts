import {
  IntegrationCapabilityUnavailableError,
  IntegrationProviderUnavailableError,
} from '#core/errors.js';
import {createIntegrationProviderRegistry} from './registry.js';

function sourceControlAdapter() {
  return {
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
  };
}

function agentToolsAdapter() {
  return {
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
  };
}

describe('integration provider registry', () => {
  it('lists providers by capability', () => {
    const registry = createIntegrationProviderRegistry([
      {
        provider: 'gitea',
        displayName: 'Gitea',
        adapters: {
          source_control: sourceControlAdapter(),
        },
      },
      {
        provider: 'github',
        displayName: 'GitHub',
      },
    ]);

    const result = registry.list('source_control');

    expect(result.map((provider) => provider.provider)).toEqual(['gitea']);
  });

  it('computes the agent tools capability from the adapter', () => {
    const registry = createIntegrationProviderRegistry([
      {
        provider: 'github',
        displayName: 'GitHub',
        adapters: {
          agent_tools: agentToolsAdapter(),
        },
      },
    ]);

    const result = registry.list('agent_tools');

    expect(result.map((provider) => provider.provider)).toEqual(['github']);
    expect(registry.get('github').capabilities).toEqual(['agent_tools']);
  });

  it('keeps provider sets isolated per registry instance', () => {
    const emptyRegistry = createIntegrationProviderRegistry([]);
    const giteaRegistry = createIntegrationProviderRegistry([
      {
        provider: 'gitea',
        displayName: 'Gitea',
        adapters: {
          source_control: sourceControlAdapter(),
        },
      },
    ]);

    expect(giteaRegistry.get('gitea').provider).toBe('gitea');
    expect(() => emptyRegistry.get('gitea')).toThrow(IntegrationProviderUnavailableError);
  });

  it('rejects source-control access for providers without the capability implementation', () => {
    const registry = createIntegrationProviderRegistry([
      {
        provider: 'gitea',
        displayName: 'Gitea',
      },
    ]);

    const result = () => registry.getSourceControl('gitea');

    expect(result).toThrow(IntegrationCapabilityUnavailableError);
  });

  it('rejects checkout-capable source-control adapters without an authorization state', () => {
    const result = () =>
      createIntegrationProviderRegistry([
        {
          provider: 'gitea',
          displayName: 'Gitea',
          adapters: {
            source_control: {
              ...sourceControlAdapter(),
              createCheckoutSpec: async () => ({
                repositoryUrl: 'https://gitea.local/owner/repository.git',
                ref: 'main',
              }),
            },
          },
        },
      ]);

    expect(result).toThrow(
      'Source-control provider gitea must declare checkout repository authorization',
    );
  });

  it('rejects credential-capable source-control adapters without an authorization state', () => {
    const result = () =>
      createIntegrationProviderRegistry([
        {
          provider: 'gitea',
          displayName: 'Gitea',
          adapters: {
            source_control: {
              ...sourceControlAdapter(),
              createCheckoutCredentials: async () => ({
                username: 'x-access-token',
                token: 'secret',
                expiresAt: new Date('2027-01-01T00:00:00.000Z'),
              }),
            },
          },
        },
      ]);

    expect(result).toThrow(
      'Source-control provider gitea must declare checkout repository authorization',
    );
  });

  it('rejects duplicate provider registrations', () => {
    const result = () =>
      createIntegrationProviderRegistry([
        {
          provider: 'gitea',
          displayName: 'Gitea',
        },
        {
          provider: 'gitea',
          displayName: 'Gitea Duplicate',
        },
      ]);

    expect(result).toThrow('Duplicate integration provider registered');
  });

  it('rejects invalid provider ids', () => {
    const result = () =>
      createIntegrationProviderRegistry([
        {
          provider: 'GitHub',
          displayName: 'GitHub',
        },
      ]);

    expect(result).toThrow('Invalid integration provider id');
  });
});
