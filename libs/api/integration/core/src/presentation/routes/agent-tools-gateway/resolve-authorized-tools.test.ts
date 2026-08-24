import {setLeasedJobContext} from '@shipfox/api-auth-context';
import {workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {createIntegrationProviderRegistry} from '#core/providers/registry.js';
import {
  agentStepConfig,
  catalogTool,
  connection,
  leaseContext,
  materializedIntegration,
  registryWithAgentTools,
} from '#test/agent-tools-gateway-helpers.js';
import {
  createWorkflowsLeasedAgentStepLoader,
  mcpToolName,
  narrowMethodEnum,
  resolveAuthorizedIntegrationTools,
  sanitizeSlug,
} from './resolve-authorized-tools.js';

describe('resolveAuthorizedIntegrationTools', () => {
  it.each([
    ['lease-not-active', 404],
    ['step-not-found', 404],
    ['job-not-found', 404],
    ['step-attempt-mismatch', 409],
    ['step-not-running', 409],
    ['leased-step-not-agent', 409],
    ['agent-step-config-invalid', 409],
  ] as const)('maps %s from Workflows to HTTP %i', async (code, status) => {
    const request = {};
    const lease = leaseContext();
    setLeasedJobContext(request, lease);
    const workflows = {
      getLeasedAgentToolContext: () =>
        Promise.reject(
          createInterModuleKnownError(
            workflowsInterModuleContract.methods.getLeasedAgentToolContext,
            code,
            {},
          ),
        ),
    };
    const loadLeasedAgentStep = createWorkflowsLeasedAgentStepLoader(workflows as never);

    const error = await loadLeasedAgentStep({
      request,
      stepId: lease.currentStepId as string,
      attempt: lease.currentStepAttempt as number,
    }).catch((error: unknown) => error);

    expect(error).toMatchObject({code, status});
  });

  it('resolves namespaced tools with live descriptions and Anthropic-compatible method schemas', async () => {
    const request = {};
    const lease = leaseContext();
    const integration = materializedIntegration({connectionId: 'connection-1'});
    setLeasedJobContext(request, lease);

    const result = await resolveAuthorizedIntegrationTools({
      request,
      registry: registryWithAgentTools([catalogTool({description: 'Live issue reader'})]),
      getIntegrationConnectionById: async () =>
        connection({
          id: 'connection-1',
          workspaceId: lease.workspaceId,
          slug: integration.connectionSlug,
        }),
      loadLeasedAgentStep: async () => ({
        workspaceId: lease.workspaceId,
        step: {type: 'agent', config: agentStepConfig([integration])},
      }),
    });

    const authorizedTool = result.get('github_main__issue_read');
    expect(authorizedTool?.description).toBe('Live issue reader');
    const properties = authorizedTool?.inputSchema.properties as Record<string, unknown>;
    expect(properties.method).toMatchObject({
      enum: ['get', 'get_comments'],
    });
    expect(authorizedTool?.inputSchema.oneOf).toBeUndefined();
  });

  it('fails closed when the lease has no current step', async () => {
    const request = {};
    setLeasedJobContext(
      request,
      leaseContext({currentStepId: undefined, currentStepAttempt: undefined}),
    );

    const act = resolveAuthorizedIntegrationTools({
      request,
      registry: registryWithAgentTools(),
      getIntegrationConnectionById: async () => undefined,
      loadLeasedAgentStep: () => Promise.reject(new Error('should not load')),
    });

    await expect(act).rejects.toMatchObject({code: 'lease-missing-step', status: 409});
  });

  it('fails closed when the current step is not an agent step', async () => {
    const request = {};
    const lease = leaseContext();
    setLeasedJobContext(request, lease);

    const act = resolveAuthorizedIntegrationTools({
      request,
      registry: registryWithAgentTools(),
      getIntegrationConnectionById: async () => undefined,
      loadLeasedAgentStep: async () => ({
        workspaceId: lease.workspaceId,
        step: {type: 'run', config: {}},
      }),
    });

    await expect(act).rejects.toMatchObject({code: 'leased-step-not-agent', status: 409});
  });

  it.each([
    ['deleted', undefined],
    ['inactive', connection({id: 'connection-1', lifecycleStatus: 'disabled'})],
    ['workspace mismatch', connection({id: 'connection-1', workspaceId: 'other-workspace'})],
    [
      'provider changed',
      connection({id: 'connection-1', workspaceId: 'workspace-1', provider: 'slack'}),
    ],
  ])('denies when the connection is %s', async (_label, resolvedConnection) => {
    const request = {};
    const lease = leaseContext({workspaceId: 'workspace-1'});
    const integration = materializedIntegration({connectionId: 'connection-1'});
    setLeasedJobContext(request, lease);

    const act = resolveAuthorizedIntegrationTools({
      request,
      registry: registryWithAgentTools(),
      getIntegrationConnectionById: async () => resolvedConnection,
      loadLeasedAgentStep: async () => ({
        workspaceId: lease.workspaceId,
        step: {type: 'agent', config: agentStepConfig([integration])},
      }),
    });

    await expect(act).rejects.toMatchObject({
      code: 'integration-tool-connection-unavailable',
      status: 409,
    });
  });

  it('denies when the provider no longer exposes agent tools', async () => {
    const request = {};
    const lease = leaseContext({workspaceId: 'workspace-1'});
    const integration = materializedIntegration({connectionId: 'connection-1'});
    setLeasedJobContext(request, lease);

    const act = resolveAuthorizedIntegrationTools({
      request,
      registry: createIntegrationProviderRegistry([{provider: 'github', displayName: 'GitHub'}]),
      getIntegrationConnectionById: async () =>
        connection({id: 'connection-1', workspaceId: lease.workspaceId}),
      loadLeasedAgentStep: async () => ({
        workspaceId: lease.workspaceId,
        step: {type: 'agent', config: agentStepConfig([integration])},
      }),
    });

    await expect(act).rejects.toMatchObject({
      code: 'integration-tool-connection-unavailable',
      status: 409,
    });
  });

  it('detects MCP name collisions after slug sanitization', async () => {
    const request = {};
    const lease = leaseContext({workspaceId: 'workspace-1'});
    const first = materializedIntegration({
      connectionId: 'connection-1',
      connectionSlug: 'github-main',
    });
    const second = materializedIntegration({
      connectionId: 'connection-2',
      connectionSlug: 'github_main',
    });
    setLeasedJobContext(request, lease);

    const act = resolveAuthorizedIntegrationTools({
      request,
      registry: registryWithAgentTools(),
      getIntegrationConnectionById: async (id) =>
        connection({
          id,
          workspaceId: lease.workspaceId,
          slug: id === 'connection-1' ? 'github-main' : 'github_main',
        }),
      loadLeasedAgentStep: async () => ({
        workspaceId: lease.workspaceId,
        step: {type: 'agent', config: agentStepConfig([first, second])},
      }),
    });

    await expect(act).rejects.toMatchObject({
      code: 'integration-tool-name-collision',
      status: 409,
    });
  });

  it('leaves unknown method schema shapes intact while runtime enforcement remains separate', () => {
    const schema = {type: 'object', properties: {method: {type: 'string'}}};

    const narrowed = narrowMethodEnum(schema, ['allowed']);

    expect(narrowed).toEqual(schema);
  });
});

describe('MCP tool names', () => {
  it('sanitizes connection slugs without parsing names back apart', () => {
    expect(sanitizeSlug('github-main')).toBe('github_main');
    expect(mcpToolName('github-main', 'issue_read')).toBe('github_main__issue_read');
  });
});
