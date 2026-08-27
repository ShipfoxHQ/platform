import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import {createWorkflowModelSnapshot, type WorkflowModel} from '@shipfox/api-definitions-dto';
import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import {
  agentValidationCatalog,
  agentValidationCatalogV2,
} from '#test/fixtures/agent-inter-module.js';
import {workflowModel} from '#test/index.js';
import type {TriggerPayload, WorkflowRunDevSource} from './entities/workflow-run.js';
import {DefinitionNotFoundError, ProjectMismatchError} from './errors.js';
import {runDevWorkflow, runWorkflow} from './run-workflow.js';

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
  resolveDefinitionAtRef: () => {
    throw new Error('resolveDefinitionAtRef is not used by runWorkflow');
  },
  listDefinitionsAtRef: () => {
    throw new Error('listDefinitionsAtRef is not used by runWorkflow');
  },
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
    getValidationCatalogV2: vi.fn().mockResolvedValue(agentValidationCatalogV2),
    resolveAgentConfig: mockResolveAgentConfig,
    resolveRuntimeCredentials: vi.fn(),
    claimSession: vi.fn(),
    carryOverSessions: vi.fn(),
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
    expect(run.definitionId).toBe(definition.workflowId);
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

  test('numbers runs by the workflow lineage id, not the definition row id', async () => {
    const lineageId = crypto.randomUUID();
    // A lineage whose id differs from the definition row id, as happens after
    // the backfill when a lineage id diverges from the synced row it was born from.
    const definition = buildDefinition({projectId, id: crypto.randomUUID(), workflowId: lineageId});
    definitionResponse = definition;

    const first = await runWorkflow(definitions, {
      workspaceId,
      projectId,
      definitionId: definition.id,
      triggerPayload: manualPayload(),
      agent,
    });
    const second = await runWorkflow(definitions, {
      workspaceId,
      projectId,
      definitionId: definition.id,
      triggerPayload: manualPayload(),
      agent,
    });

    expect(first.definitionId).toBe(lineageId);
    expect(second.definitionId).toBe(lineageId);
    expect(first.number).toBe(1);
    expect(second.number).toBe(2);

    // A later definition row that resolves to the same lineage continues the sequence.
    const resynced = buildDefinition({projectId, id: crypto.randomUUID(), workflowId: lineageId});
    definitionResponse = resynced;
    const third = await runWorkflow(definitions, {
      workspaceId,
      projectId,
      definitionId: resynced.id,
      triggerPayload: manualPayload(),
      agent,
    });

    expect(third.definitionId).toBe(lineageId);
    expect(third.number).toBe(3);
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

describe('runDevWorkflow', () => {
  let workspaceId: string;
  let projectId: string;
  const agent: AgentInterModuleClient = {
    getValidationCatalog: vi.fn().mockResolvedValue(agentValidationCatalog),
    getValidationCatalogV2: vi.fn().mockResolvedValue(agentValidationCatalogV2),
    resolveAgentConfig: mockResolveAgentConfig,
    resolveRuntimeCredentials: vi.fn(),
    claimSession: vi.fn(),
    carryOverSessions: vi.fn(),
  };

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
    mockResolveAgentConfig.mockClear();
  });

  const devSource: WorkflowRunDevSource = {
    ref: 'fix-triage-prompt',
    commit: 'a'.repeat(40),
    configPath: '.shipfox/workflows/triage-sentry.yml',
    initiatedByUserId: crypto.randomUUID(),
    replayOfEventId: null,
  };

  function devPayload(): TriggerPayload {
    return {source: 'manual', event: 'fire', userId: crypto.randomUUID()};
  }

  function buildDevRun(workflowId: string, triggerPayload: TriggerPayload = devPayload()) {
    return runDevWorkflow(agent, {
      workspaceId,
      projectId,
      workflowId,
      model: createWorkflowModelSnapshot(workflowModel({name: 'Dev Workflow'})),
      sourceSnapshot: {content: 'name: Dev Workflow\n', format: 'yaml'},
      devSource,
      triggerPayload,
    });
  }

  test('creates a dev run with the lineage id as definition_id and dev provenance', async () => {
    const workflowId = crypto.randomUUID();
    const triggerPayload = devPayload();
    const run = await buildDevRun(workflowId, triggerPayload);

    expect(run.definitionId).toBe(workflowId);
    expect(run.origin).toBe('dev');
    expect(run.devSource).toEqual(devSource);
    expect(run.name).toBe('Dev Workflow');
    expect(run.workflowName).toBe('Dev Workflow');
    expect(run.sourceSnapshot).toEqual({content: 'name: Dev Workflow\n', format: 'yaml'});
    expect(run.triggerPayload).toEqual(triggerPayload);
    expect(run.triggerIdempotencyKey).toBeNull();
  });

  test('continues the lineage number sequence across dev and synced runs of one workflow file', async () => {
    const workflowId = crypto.randomUUID();
    // The file exists on the branch only: the dev run opens the sequence.
    const devRun = await buildDevRun(workflowId);
    expect(devRun.number).toBe(1);

    // After merge, the synced run of the same lineage continues the sequence.
    const definition = buildDefinition({
      projectId,
      id: crypto.randomUUID(),
      workflowId,
      model: workflowModel({name: 'Dev Workflow'}),
    });
    definitionResponse = definition;
    const syncedRun = await runWorkflow(definitions, {
      workspaceId,
      projectId,
      definitionId: definition.id,
      triggerPayload: manualPayload(),
      agent,
    });
    expect(syncedRun.definitionId).toBe(workflowId);
    expect(syncedRun.origin).toBe('synced');
    expect(syncedRun.number).toBe(2);

    // And a later dev run of the same file keeps the sequence going.
    const secondDevRun = await buildDevRun(workflowId);
    expect(secondDevRun.number).toBe(3);
  });

  test('accepts a manual payload without a subscription id, as a dev trigger has no row', async () => {
    const workflowId = crypto.randomUUID();
    const triggerPayload = {
      source: 'manual' as const,
      event: 'fire' as const,
      userId: crypto.randomUUID(),
    };
    const run = await buildDevRun(workflowId, triggerPayload);

    expect(run.triggerProvider).toBeNull();
    expect(run.triggerSource).toBe('manual');
    expect(run.triggerPayload).toEqual(triggerPayload);
  });
});
