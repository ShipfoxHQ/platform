import {integrationsInterModuleContract} from '@shipfox/api-integration-core-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {createInMemoryInterModuleTransport} from '@shipfox/node-module/inter-module';
import {IntegrationProviderError} from '#core/errors.js';
import {createIntegrationProviderRegistry} from '#core/providers/registry.js';
import type {SourceControlProvider} from '#core/providers/source-control.js';
import {createSourceControlIntegrationService} from '#core/source-control-service.js';
import {createIntegrationsInterModulePresentation} from './inter-module.js';

const workspaceId = crypto.randomUUID();
const connectionId = crypto.randomUUID();

function createClient(
  resolveRef: (input: {ref: string}) => Promise<{ref: string; commit: string}>,
  resolveRepository: SourceControlProvider['resolveRepository'] = () => {
    throw new Error('not used');
  },
) {
  const transport = createInMemoryInterModuleTransport();
  const client = transport.createClient(integrationsInterModuleContract);

  const sourceControl = createSourceControlIntegrationService({
    registry: createIntegrationProviderRegistry([
      {
        provider: 'gitea',
        displayName: 'Gitea',
        adapters: {
          source_control: {
            listRepositories: vi.fn(),
            resolveRepository: vi.fn(resolveRepository),
            listFiles: vi.fn(),
            fetchFile: vi.fn(),
            resolveTriggerReference: () => null,
            resolveRef: async (input) => await resolveRef(input),
          },
        },
      },
    ]),
    getIntegrationConnectionById: async (id) => {
      await Promise.resolve();
      return id === connectionId
        ? {
            id: connectionId,
            workspaceId,
            provider: 'gitea',
            externalAccountId: 'gitea-owner',
            slug: 'gitea_owner',
            displayName: 'Gitea',
            lifecycleStatus: 'active' as const,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        : undefined;
    },
  });

  transport.register(
    createIntegrationsInterModulePresentation({
      registry: createIntegrationProviderRegistry([]),
      sourceControl,
    }),
  );
  transport.seal();
  return client;
}

describe('integrations inter-module presentation', () => {
  const input = {
    workspaceId,
    connectionId,
    externalRepositoryId: 'gitea:gitea-owner/platform',
  };

  it('resolves a source ref through the transport', async () => {
    const client = createClient(async (input) => ({
      ref: input.ref,
      commit: 'a'.repeat(40),
    }));

    const result = await client.resolveSourceRef({...input, ref: 'refs/heads/main'});

    expect(result).toEqual({ref: 'refs/heads/main', commit: 'a'.repeat(40)});
  });

  it('maps a missing ref to the ref-not-found known error', async () => {
    const client = createClient(() => {
      throw new IntegrationProviderError('ref-not-found', 'Ref not found');
    });

    const error = await client
      .resolveSourceRef({...input, ref: 'refs/heads/missing'})
      .catch((caught: unknown) => caught);

    expect(
      isInterModuleKnownError(integrationsInterModuleContract.methods.resolveSourceRef, error),
    ).toBe(true);
    if (isInterModuleKnownError(integrationsInterModuleContract.methods.resolveSourceRef, error)) {
      expect(error.code).toBe('ref-not-found');
      expect(error.details).toEqual({ref: 'refs/heads/missing'});
    }
  });

  it('maps an invalid ref to the ref-invalid known error', async () => {
    const client = createClient(() => {
      throw new IntegrationProviderError('ref-invalid', 'Ref is not a branch or tag name');
    });

    const error = await client
      .resolveSourceRef({...input, ref: 'a'.repeat(40)})
      .catch((caught: unknown) => caught);

    if (isInterModuleKnownError(integrationsInterModuleContract.methods.resolveSourceRef, error)) {
      expect(error.code).toBe('ref-invalid');
      expect(error.details).toEqual({ref: 'a'.repeat(40)});
    } else {
      throw error;
    }
  });

  it('keeps other provider failures as provider-failure known errors', async () => {
    const client = createClient(() => {
      throw new IntegrationProviderError('rate-limited', 'Rate limited', 60);
    });

    const error = await client
      .resolveSourceRef({...input, ref: 'refs/heads/main'})
      .catch((caught: unknown) => caught);

    if (isInterModuleKnownError(integrationsInterModuleContract.methods.resolveSourceRef, error)) {
      expect(error.code).toBe('provider-failure');
      expect(error.details).toEqual({reason: 'rate-limited', retryAfterSeconds: 60});
    } else {
      throw error;
    }
  });

  it('keeps ref reasons generic for methods that do not declare ref errors', async () => {
    const client = createClient(
      async (input) => ({ref: input.ref, commit: 'a'.repeat(40)}),
      () => {
        throw new IntegrationProviderError('ref-not-found', 'Ref not found');
      },
    );

    const error = await client.resolveSourceRepository(input).catch((caught: unknown) => caught);

    if (
      isInterModuleKnownError(
        integrationsInterModuleContract.methods.resolveSourceRepository,
        error,
      )
    ) {
      expect(error.code).toBe('provider-failure');
      expect(error.details).toEqual({reason: 'ref-not-found'});
    } else {
      throw error;
    }
  });
});
