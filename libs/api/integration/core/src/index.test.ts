import type {StoredWebhookRequest, WebhookRequestProcessor} from '@shipfox/api-integration-spi';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {createOutboxRegistry, type ModuleService, startModuleServices} from '@shipfox/node-module';
import {
  createIntegrationsContext,
  createRepositoryAuthorizer,
  WebhookProcessorNotConfiguredError,
} from './index.js';

const disabledRepositoryAuthorizer = createRepositoryAuthorizer({enabled: false});

const request = {
  schema_version: 1,
  request_id: 'a8a44e12-f4bd-4bd1-82d4-ccdba70a9f3e',
  route_id: 'github',
  received_at: '2026-07-20T12:00:00.000Z',
  method: 'POST',
  path_parameters: {},
  raw_query_string: '',
  headers: {},
  body: {encoding: 'base64', data: ''},
} as const satisfies StoredWebhookRequest;

describe('createIntegrationsContext', () => {
  it('binds the composed direct-route processor to an optional delivery source', async () => {
    const directProcessor: WebhookRequestProcessor = {
      process: vi.fn().mockResolvedValue({outcome: 'processed', deliveryId: 'delivery-1'}),
    };
    const stop = vi.fn().mockResolvedValue(undefined);
    const service: ModuleService = {
      name: 'queued-webhook-deliveries',
      shutdownTimeoutMs: 1_000,
      start: vi.fn().mockResolvedValue({finished: Promise.resolve(), stop}),
    };
    const deliverySource = {createService: vi.fn().mockReturnValue(service)};

    const context = await createIntegrationsContext({
      parts: [
        {
          provider: {provider: 'github', displayName: 'GitHub', adapters: {}},
          webhookProcessors: [{routeIds: ['github'], processor: directProcessor}],
        },
      ],
      webhookDeliverySource: deliverySource,
      repositoryAuthorizer: disabledRepositoryAuthorizer,
    });

    expect(context.module.services).toEqual([service]);
    expect(deliverySource.createService).toHaveBeenCalledWith(context.webhookProcessor);

    const result = await context.webhookProcessor.process(request);
    const services = await startModuleServices({
      services: context.module.services ?? [],
      context: {outboxRegistry: createOutboxRegistry()},
    });
    await services.stop();

    expect(result).toEqual({outcome: 'processed', deliveryId: 'delivery-1'});
    expect(directProcessor.process).toHaveBeenCalledWith(request);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('does not register a service without a delivery source', async () => {
    const context = await createIntegrationsContext({
      parts: [{provider: {provider: 'github', displayName: 'GitHub', adapters: {}}}],
      repositoryAuthorizer: disabledRepositoryAuthorizer,
    });

    expect(context.module.services).toBeUndefined();
  });

  it('registers provider-owned services without a delivery source', async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const service: ModuleService = {
      name: 'test-vcs-fixture',
      shutdownTimeoutMs: 1_000,
      start: vi.fn().mockResolvedValue({finished: Promise.resolve(), stop}),
    };

    const context = await createIntegrationsContext({
      parts: [
        {
          provider: {provider: 'test-vcs', displayName: 'Test VCS', adapters: {}},
          services: [service],
        },
      ],
      repositoryAuthorizer: disabledRepositoryAuthorizer,
    });

    expect(context.module.services).toEqual([service]);
    const services = await startModuleServices({
      services: context.module.services ?? [],
      context: {outboxRegistry: createOutboxRegistry()},
    });
    await services.stop();

    expect(stop).toHaveBeenCalledOnce();
  });

  it('rejects a queued request with no registered processor', async () => {
    const context = await createIntegrationsContext({
      parts: [{provider: {provider: 'github', displayName: 'GitHub', adapters: {}}}],
      repositoryAuthorizer: disabledRepositoryAuthorizer,
    });

    const result = context.webhookProcessor.process(request);

    await expect(result).rejects.toEqual(new WebhookProcessorNotConfiguredError('github'));
  });

  it('fails composition when more than one processor handles a route', async () => {
    const processor: WebhookRequestProcessor = {
      process: vi.fn().mockResolvedValue({outcome: 'processed', deliveryId: 'delivery-1'}),
    };

    const result = createIntegrationsContext({
      parts: [
        {
          provider: {provider: 'github', displayName: 'GitHub', adapters: {}},
          webhookProcessors: [
            {routeIds: ['github'], processor},
            {routeIds: ['github'], processor},
          ],
        },
      ],
      repositoryAuthorizer: disabledRepositoryAuthorizer,
    });

    await expect(result).rejects.toThrow(
      'Webhook processor is registered more than once for github',
    );
  });

  it('fails composition when a configured delivery source is invalid', async () => {
    const sourceError = new Error('WEBHOOK_QUEUE_URL is required');

    const result = createIntegrationsContext({
      parts: [{provider: {provider: 'github', displayName: 'GitHub', adapters: {}}}],
      webhookDeliverySource: {
        createService: () => {
          throw sourceError;
        },
      },
      repositoryAuthorizer: disabledRepositoryAuthorizer,
    });

    await expect(result).rejects.toThrow(sourceError);
  });

  it('enforces repository authorization by default', async () => {
    const getProjectBySource = vi.fn().mockResolvedValue({project: null});
    const projects = {
      getProjectBySource,
      findProjectBySourceRepositoryName: vi.fn(),
    } as unknown as ProjectsModuleClient;
    const workspaceId = crypto.randomUUID();
    const connection = {
      id: crypto.randomUUID(),
      workspaceId,
      provider: 'github',
      externalAccountId: 'github-test-account',
      slug: 'github_test',
      displayName: 'GitHub Test',
      lifecycleStatus: 'active' as const,
      repositoryAccessMode: 'selected' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const getIntegrationConnectionById = vi.fn(async (id: string) =>
      id === connection.id ? connection : undefined,
    );
    const createCheckoutSpec = vi.fn().mockResolvedValue({
      repositoryUrl: 'https://github.com/acme/platform.git',
      ref: 'main',
    });

    const context = await createIntegrationsContext({
      parts: [
        {
          provider: {
            provider: 'github',
            displayName: 'GitHub',
            repositoryAuthorization: 'enforced',
            adapters: {
              source_control: {
                checkoutRepositoryAuthorization: 'enforced',
                listRepositories: vi.fn(),
                resolveRepository: vi.fn(),
                listFiles: vi.fn(),
                fetchFile: vi.fn(),
                resolveTriggerReference: vi.fn().mockReturnValue(null),
                resolveRef: vi.fn(),
                createCheckoutSpec,
              },
            },
          },
        },
      ],
      projects,
      getIntegrationConnectionById,
    });

    expect(context.repositoryAuthorizer.enabled).toBe(true);
    await expect(
      context.repositoryAuthorizer.resolveRepositoryAuthorization({
        workspaceId,
        connectionId: connection.id,
        mode: 'selected',
        repository: {kind: 'external-id', externalRepositoryId: 'github:42'},
        capability: 'checkout',
      }),
    ).resolves.toEqual({authorized: false, reason: 'repository_not_granted'});
    expect(getProjectBySource).toHaveBeenCalledWith({
      workspaceId,
      sourceConnectionId: connection.id,
      sourceExternalRepositoryId: 'github:42',
    });

    await expect(
      context.sourceControl.createCheckoutSpec({
        workspaceId,
        connectionId: connection.id,
        target: {kind: 'external-id', externalRepositoryId: 'github:42'},
      }),
    ).rejects.toMatchObject({reason: 'repository_not_granted'});
    expect(createCheckoutSpec).not.toHaveBeenCalled();
    expect(getProjectBySource).toHaveBeenLastCalledWith({
      workspaceId,
      sourceConnectionId: connection.id,
      sourceExternalRepositoryId: 'github:42',
    });
  });
});
