import type {WorkflowDefinition} from '@shipfox/api-definitions';
import {DefinitionNotFoundError, ProjectMismatchError} from './errors.js';
import {runWorkflow} from './run-workflow.js';

vi.mock('@shipfox/api-definitions', () => ({
  getDefinitionById: vi.fn(),
}));

import {getDefinitionById} from '@shipfox/api-definitions';

const mockGetDefinitionById = vi.mocked(getDefinitionById);

function buildDefinition(overrides?: Partial<WorkflowDefinition>): WorkflowDefinition {
  return {
    id: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    configPath: '.shipfox/workflows/test.yml',
    source: 'manual',
    sha: null,
    ref: null,
    name: 'Test Workflow',
    definition: {
      name: 'Test Workflow',
      jobs: {
        build: {steps: [{run: 'echo hello'}]},
      },
    },
    fetchedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('runWorkflow', () => {
  let workspaceId: string;
  let projectId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
    projectId = crypto.randomUUID();
  });

  test('creates a run from a valid definition', async () => {
    const definition = buildDefinition({projectId});
    mockGetDefinitionById.mockResolvedValue(definition);

    const run = await runWorkflow({
      workspaceId,
      projectId,
      definitionId: definition.id,
    });

    expect(run.id).toBeDefined();
    expect(run.projectId).toBe(projectId);
    expect(run.definitionId).toBe(definition.id);
    expect(run.status).toBe('pending');
    expect(run.triggerContext).toEqual({type: 'manual'});
  });

  test('throws DefinitionNotFoundError for unknown definition', async () => {
    mockGetDefinitionById.mockResolvedValue(undefined);

    const unknownId = crypto.randomUUID();

    await expect(runWorkflow({workspaceId, projectId, definitionId: unknownId})).rejects.toThrow(
      DefinitionNotFoundError,
    );
  });

  test('throws ProjectMismatchError when definition.projectId does not match', async () => {
    const otherProjectId = crypto.randomUUID();
    const definition = buildDefinition({projectId: otherProjectId});
    mockGetDefinitionById.mockResolvedValue(definition);

    await expect(
      runWorkflow({workspaceId, projectId, definitionId: definition.id}),
    ).rejects.toThrow(ProjectMismatchError);
  });

  test('passes inputs through to the run', async () => {
    const definition = buildDefinition({projectId});
    mockGetDefinitionById.mockResolvedValue(definition);

    const run = await runWorkflow({
      workspaceId,
      projectId,
      definitionId: definition.id,
      inputs: {env: 'staging'},
    });

    expect(run.inputs).toEqual({env: 'staging'});
  });
});
