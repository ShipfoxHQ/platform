import type {ManagedModelProvider} from '@shipfox/api-agent-dto';
import {agentInterModuleContract} from '@shipfox/api-agent-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {agentTestSecretsClient} from '#test/fixtures/secrets-client.js';
import {createAgentInterModulePresentation} from './inter-module.js';

describe('agent inter-module presentation', () => {
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
