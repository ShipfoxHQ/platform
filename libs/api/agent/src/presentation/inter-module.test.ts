import type {ManagedModelProvider} from '@shipfox/api-agent-dto';
import {agentInterModuleContract} from '@shipfox/api-agent-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {setDefaultHarness} from '#db/index.js';
import {agentTestSecretsClient} from '#test/fixtures/secrets-client.js';
import {createAgentInterModulePresentation} from './inter-module.js';

const workspaceDefaultsResolverMocks = vi.hoisted(() => ({
  getWorkspaceAgentValidationCatalog: vi.fn(),
}));

vi.mock('#core/workspace-agent-defaults-resolver.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('#core/workspace-agent-defaults-resolver.js')>();
  workspaceDefaultsResolverMocks.getWorkspaceAgentValidationCatalog.mockImplementation(
    actual.getWorkspaceAgentValidationCatalog,
  );
  return {
    ...actual,
    getWorkspaceAgentValidationCatalog:
      workspaceDefaultsResolverMocks.getWorkspaceAgentValidationCatalog,
  };
});

describe('agent inter-module presentation', () => {
  beforeEach(() => {
    workspaceDefaultsResolverMocks.getWorkspaceAgentValidationCatalog.mockClear();
  });

  test('preserves the original validation catalog response', async () => {
    const presentation = createAgentInterModulePresentation({secrets: agentTestSecretsClient});

    const catalog = await presentation.handlers.getValidationCatalog(
      {},
      {signal: new AbortController().signal},
    );

    expect(catalog.version).toBe(1);
    expect(catalog).not.toHaveProperty('default_harness_id');
  });

  test('uses the built-in default harness without workspace context', async () => {
    const presentation = createAgentInterModulePresentation({secrets: agentTestSecretsClient});

    const catalog = await presentation.handlers.getValidationCatalogV2(
      {workspaceId: null},
      {signal: new AbortController().signal},
    );

    expect(catalog.default_harness_id).toBe('pi');
    expect(
      workspaceDefaultsResolverMocks.getWorkspaceAgentValidationCatalog,
    ).not.toHaveBeenCalled();
  });

  test('uses the built-in default harness for a workspace without settings', async () => {
    const workspaceId = crypto.randomUUID();
    const presentation = createAgentInterModulePresentation({secrets: agentTestSecretsClient});

    const catalog = await presentation.handlers.getValidationCatalogV2(
      {workspaceId},
      {signal: new AbortController().signal},
    );

    expect(catalog.default_harness_id).toBe('pi');
    expect(workspaceDefaultsResolverMocks.getWorkspaceAgentValidationCatalog).toHaveBeenCalledWith(
      workspaceId,
      undefined,
      undefined,
    );
  });

  test('loads the workspace default harness for managed inference validation', async () => {
    const workspaceId = crypto.randomUUID();
    await setDefaultHarness({workspaceId, harnessId: 'claude'});
    const presentation = createAgentInterModulePresentation({
      secrets: agentTestSecretsClient,
      managedProvider: {
        id: 'shipfox',
        label: 'Shipfox',
        models: [{id: 'managed-model', label: 'Managed model', api: 'anthropic-messages'}],
        defaultModel: 'managed-model',
        resolveCredentials: vi.fn(),
      },
      workspaceProviders: 'disabled',
    });

    const catalog = await presentation.handlers.getValidationCatalogV2(
      {workspaceId},
      {signal: new AbortController().signal},
    );

    expect(catalog.default_harness_id).toBe('claude');
  });

  test('preserves managed provider policy details for runtime credentials', async () => {
    const managedProvider: ManagedModelProvider = {
      id: 'shipfox',
      label: 'Shipfox',
      models: [{id: 'managed-model', label: 'Managed model', api: 'openai-responses'}],
      defaultModel: 'managed-model',
      resolveCredentials: vi.fn(),
    };
    const presentation = createAgentInterModulePresentation({
      secrets: agentTestSecretsClient,
      managedProvider,
      workspaceProviders: 'disabled',
    });
    const input = {
      workspaceId: crypto.randomUUID(),
      runId: crypto.randomUUID(),
      stepAttemptId: crypto.randomUUID(),
      harness: 'pi' as const,
      provider: 'anthropic' as const,
      model: 'claude-opus-4-8',
      thinking: 'high' as const,
    };

    const result = await Promise.resolve(
      presentation.handlers.resolveRuntimeCredentials(input, {
        signal: new AbortController().signal,
      }),
    ).catch((error: unknown) => error);

    expect(
      isInterModuleKnownError(agentInterModuleContract.methods.resolveRuntimeCredentials, result),
    ).toBe(true);
    if (
      !isInterModuleKnownError(agentInterModuleContract.methods.resolveRuntimeCredentials, result)
    ) {
      throw new Error('Expected a managed provider policy error');
    }
    expect(result.code).toBe('workspace-providers-disabled');
    expect(result.details).toEqual({
      message: 'This instance only supports provider `shipfox`.',
      managed_provider_id: 'shipfox',
    });
  });
});
