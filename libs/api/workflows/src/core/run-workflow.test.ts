import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import {createWorkflowModelSnapshot, type WorkflowModel} from '@shipfox/api-definitions-dto';
import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import {agentValidationCatalog} from '#test/fixtures/agent-inter-module.js';
import {workflowModel} from '#test/index.js';
import type {TriggerPayload} from './entities/workflow-run.js';
import {DefinitionNotFoundError, ProjectMismatchError} from './errors.js';
import {runWorkflow} from './run-workflow.js';

const mockResolveAgentConfig = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    harness: 'pi',
    provider: 'openai',
    model: 'gpt-5.5-pro',
    thinking: 'medium',
  }),
);

type DefinitionForWorkflowRun = NonNullable<
  Awaited<ReturnType<DefinitionsInterModuleClient['getDefinitionForWorkflowRun']>>['definition']
>;

let definitionResponse: DefinitionForWorkflowRun | null = null;
const definitions: DefinitionsInterModuleClient = {
  getDefinitionForWorkflowRun: async () => ({definition: definitionResponse}),
};

function buildDefinition(
  overrides: Partial<Omit<DefinitionForWorkflowRun, 'model'>> & {model?: WorkflowModel} = {},
): DefinitionForWorkflowRun {
  const {model = workflowModel(), ...definitionOverrides} = overrides;
  return {
    id: crypto.randomUUID(),
    workflowId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    name: 'Test Workflow',
    model: createWorkflowModelSnapshot(model),
    sourceSnapshot: null,
    ...definitionOverrides,
  };
}

function manualPayload(): TriggerPayload {
  return {
    source: 'manual',
    event: 'fire',
    subscriptionId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
  };
}

describe('runWorkflow', () => {
  let workspaceId: string;
  let projectId: string;
  const agent: AgentInterModuleClient = {
    getValidationCatalog: vi.fn().mockResolvedValue(agentValidationCatalog),
    resolveAgentConfig: mockResolveAgentConfig,
    resolveRuntimeCredentials: vi.fn(),
  };

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    mockResolveAgentConfig.mockClear();
    definitionResponse = null;
  });

  test('creates a run from a valid definition with the provided manual trigger payload', async () => {
    const definition = buildDefinition({projectId});
    definitionResponse = definition;
    const triggerPayload = manualPayload();

    const run = await runWorkflow(definitions, {
      workspaceId,
      projectId,
      definitionId: definition.id,
      triggerPayload,
      agent,
    });

    expect(run.id).toBeDefined();
    expect(run.projectId).toBe(projectId);
    expect(run.definitionId).toBe(definition.id);
    expect(run.name).toBe(definition.name);
    expect(run.status).toBe('pending');
    expect(run.triggerProvider).toBeNull();
    expect(run.triggerSource).toBe('manual');
    expect(run.triggerEvent).toBe('fire');
    expect(run.triggerPayload).toEqual(triggerPayload);
    expect(mockResolveAgentConfig).not.toHaveBeenCalled();
  });

  test('builds the workspace agent resolver only when the definition has an agent step', async () => {
    const model = workflowModel({
      jobs: {
        fix: {steps: [{prompt: 'Fix the failing tests.'}]},
      },
    });
    const definition = buildDefinition({projectId, model});
    definitionResponse = definition;

    const run = await runWorkflow(definitions, {
      workspaceId,
      projectId,
      definitionId: definition.id,
      triggerPayload: manualPayload(),
      agent,
    });

    expect(run.id).toBeDefined();
    expect(mockResolveAgentConfig).toHaveBeenCalledWith({workspaceId, config: {}});
  });

  test('persists an integration trigger payload intact', async () => {
    const definition = buildDefinition({projectId});
    definitionResponse = definition;
    const triggerPayload: TriggerPayload = {
      provider: 'github',
      source: 'github_acme',
      event: 'push',
      deliveryId: crypto.randomUUID(),
      data: {ref: 'main', headCommitSha: 'abc', externalRepositoryId: 'github:1'},
    };

    const run = await runWorkflow(definitions, {
      workspaceId,
      projectId,
      definitionId: definition.id,
      triggerPayload,
      agent,
    });

    expect(run.triggerProvider).toBe('github');
    expect(run.triggerSource).toBe('github_acme');
    expect(run.triggerEvent).toBe('push');
    expect(run.triggerPayload).toEqual(triggerPayload);
  });

  test('creates the run with the definition source snapshot', async () => {
    const sourceSnapshot = {content: 'name: Test Workflow\njobs: {}\n', format: 'yaml'} as const;
    const definition = buildDefinition({projectId, sourceSnapshot});
    definitionResponse = definition;

    const run = await runWorkflow(definitions, {
      workspaceId,
      projectId,
      definitionId: definition.id,
      triggerPayload: manualPayload(),
      agent,
    });

    expect(run.sourceSnapshot).toEqual(sourceSnapshot);
  });

  test('throws DefinitionNotFoundError for unknown definition', async () => {
    definitionResponse = null;

    const unknownId = crypto.randomUUID();

    await expect(
      runWorkflow(definitions, {
        workspaceId,
        projectId,
        definitionId: unknownId,
        triggerPayload: manualPayload(),
        agent,
      }),
    ).rejects.toThrow(DefinitionNotFoundError);
  });

  test('throws ProjectMismatchError when definition.projectId does not match', async () => {
    const otherProjectId = crypto.randomUUID();
    const definition = buildDefinition({projectId: otherProjectId});
    definitionResponse = definition;

    await expect(
      runWorkflow(definitions, {
        workspaceId,
        projectId,
        definitionId: definition.id,
        triggerPayload: manualPayload(),
        agent,
      }),
    ).rejects.toThrow(ProjectMismatchError);
  });

  test('passes inputs through to the run', async () => {
    const definition = buildDefinition({projectId});
    definitionResponse = definition;

    const run = await runWorkflow(definitions, {
      workspaceId,
      projectId,
      definitionId: definition.id,
      triggerPayload: manualPayload(),
      agent,
      inputs: {env: 'staging'},
    });

    expect(run.inputs).toEqual({env: 'staging'});
  });
});
