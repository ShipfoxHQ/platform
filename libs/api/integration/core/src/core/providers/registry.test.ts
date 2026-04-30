import {
  IntegrationCapabilityUnavailableError,
  IntegrationProviderUnavailableError,
} from '#core/errors.js';
import {createIntegrationProviderRegistry} from './registry.js';

describe('integration provider registry', () => {
  it('lists providers by capability', () => {
    const registry = createIntegrationProviderRegistry([
      {
        provider: 'debug',
        displayName: 'Debug',
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
          },
        },
      },
      {
        provider: 'github',
        displayName: 'GitHub',
      },
    ]);

    const result = registry.list('source_control');

    expect(result.map((provider) => provider.provider)).toEqual(['debug']);
  });

  it('keeps provider sets isolated per registry instance', () => {
    const emptyRegistry = createIntegrationProviderRegistry([]);
    const debugRegistry = createIntegrationProviderRegistry([
      {
        provider: 'debug',
        displayName: 'Debug',
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
          },
        },
      },
    ]);

    expect(debugRegistry.get('debug').provider).toBe('debug');
    expect(() => emptyRegistry.get('debug')).toThrow(IntegrationProviderUnavailableError);
  });

  it('rejects source-control access for providers without the capability implementation', () => {
    const registry = createIntegrationProviderRegistry([
      {
        provider: 'debug',
        displayName: 'Debug',
      },
    ]);

    const result = () => registry.getSourceControl('debug');

    expect(result).toThrow(IntegrationCapabilityUnavailableError);
  });

  it('rejects duplicate provider registrations', () => {
    const result = () =>
      createIntegrationProviderRegistry([
        {
          provider: 'debug',
          displayName: 'Debug',
        },
        {
          provider: 'debug',
          displayName: 'Debug Duplicate',
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
