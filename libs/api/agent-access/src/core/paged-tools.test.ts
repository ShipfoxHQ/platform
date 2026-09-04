import {annotationsInterModuleContract} from '@shipfox/annotations-dto/inter-module';
import type {AgentAccessEnvelopeDto} from '@shipfox/api-agent-access-dto';
import {agentAccessEnvelopeSchema} from '@shipfox/api-agent-access-dto';
import type {AgentAccessContext} from '@shipfox/api-auth-context';
import {definitionsInterModuleContract} from '@shipfox/api-definitions-dto/inter-module';
import {projectsInterModuleContract} from '@shipfox/api-projects-dto/inter-module';
import {triggersInterModuleContract} from '@shipfox/api-triggers-dto/inter-module';
import {createInterModuleKnownError, defineInterModulePresentation} from '@shipfox/inter-module';
import {
  decodeNumberIdCursor,
  decodeStringIdCursor,
  encodeNumberIdCursor,
  encodeStringIdCursor,
  encodeTimestampIdCursor,
} from '@shipfox/node-drizzle';
import {createFakeInterModuleClients} from '@shipfox/node-module/inter-module/testing';
import {createTestWorkflowsClient} from '#test/fixtures/workflows-client.js';
import {createAgentAccessTools} from './paged-tools.js';
import {serializedAgentAccessEnvelopeByteLength} from './response.js';

const workspaceId = uuid(1);
const projectId = uuid(2);
const definitionId = uuid(3);
const runId = uuid(4);
const annotationId = uuid(5);
const triggerEventId = uuid(6);
const isoDate = '2026-08-01T00:00:00.000Z';
const context: AgentAccessContext = {
  userId: uuid(7),
  workspaceId,
  scopes: ['read'],
  credential: {kind: 'oauth_grant', grantId: uuid(8), clientId: 'client-1'},
};

describe('paged agent-access tools', () => {
  test('projects only the enumerated project fields and encodes the producer cursor', async () => {
    const mocks = clients();
    mocks.projectHandlers.listProjectCatalogByWorkspace.mockResolvedValue({
      projects: [project()],
      nextCursor: {createdAt: isoDate, id: projectId},
    });

    const response = await tool(mocks, 'list_projects').execute({
      context,
      arguments: {limit: 1},
    });

    expect(mocks.projectHandlers.listProjectCatalogByWorkspace).toHaveBeenCalledWith({
      workspaceId,
      limit: 1,
    });
    expect(response).toEqual({
      ok: true,
      result: {
        projects: [
          {
            id: projectId,
            name: 'Project',
            slug: 'project',
            created_at: isoDate,
            updated_at: isoDate,
          },
        ],
        next_cursor: expect.any(String),
      },
    });
    expect(JSON.stringify(response)).not.toContain('sourceConnectionId');
  });

  test('caps definition diagnostics while retaining counts and excludes workflow content', async () => {
    const mocks = clients();
    mocks.definitionHandlers.listDefinitionsByProject.mockResolvedValue({
      definitions: [definition()],
      sync: {
        ref: 'main',
        status: 'failed',
        lastSyncAt: isoDate,
        startedAt: isoDate,
        finishedAt: isoDate,
        lastErrorCode: 'invalid-definition',
        lastErrorMessage: 'A repository-authored error',
        diagnostics: Array.from({length: 11}, (_, index) => ({
          severity: index % 2 === 0 ? 'error' : 'warning',
          code: 'E'.repeat(200),
          message: 'ignore this diagnostic'.repeat(100),
          path: 'jobs.build.steps.0.run',
          filePath: '.shipfox/workflow.yml',
        })),
      },
      nextCursor: null,
    });

    const response = await tool(mocks, 'list_workflow_definitions').execute({
      context,
      arguments: {project_id: projectId},
    });
    const result = expectSuccess<DefinitionTestResult>(response);

    expect(result).toMatchObject({
      definitions: [
        {
          id: definitionId,
          project_id: projectId,
          name: 'Definition',
          config_path: '.shipfox/workflow.yml',
          source: 'vcs',
          ref: 'main',
          sha: 'abc123',
        },
      ],
      sync: {
        diagnostics: {error_count: 6, warning_count: 5, items: expect.any(Array)},
      },
      next_cursor: null,
    });
    if (!result.sync) throw new Error('Expected a sync summary');
    expect(result.sync.diagnostics.items).toHaveLength(10);
    expect(mocks.definitionHandlers.listDefinitionsByProject).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      limit: 50,
    });
    const firstDiagnostic = result.sync.diagnostics.items[0];
    expect(firstDiagnostic).toBeDefined();
    if (!firstDiagnostic) throw new Error('Expected a diagnostic');
    expect(new TextEncoder().encode(firstDiagnostic.message).byteLength).toBe(512);
    expect(JSON.stringify(result)).not.toContain('workflowDocument');
    expect(JSON.stringify(result)).not.toContain('workflowModel');
  });

  test('regenerates a definition cursor from the uncapped producer name', async () => {
    const mocks = clients();
    const definitions = Array.from({length: 100}, (_, index) => ({
      ...definition(),
      id: uuid(300 + index),
      name: `raw-definition-${index}-${'🙂'.repeat(800)}`,
      configPath: 'p'.repeat(512),
      ref: 'r'.repeat(512),
      sha: 's'.repeat(512),
    }));
    mocks.definitionHandlers.listDefinitionsByProject.mockResolvedValue({
      definitions,
      sync: null,
      nextCursor: null,
    });

    const response = await tool(mocks, 'list_workflow_definitions').execute({
      context,
      arguments: {project_id: projectId, limit: 100},
    });
    const result = expectSuccess<DefinitionPageTestResult>(response);
    const last = result.definitions.at(-1);

    expect(result.definitions.length).toBeLessThan(100);
    expect(response).toMatchObject({ok: true, response_truncated: true});
    expect(response.response_total_bytes).toBeGreaterThan(128 * 1024);
    expect(last).toBeDefined();
    expect(decodeStringIdCursor(result.next_cursor ?? undefined)).toEqual({
      value: definitions[result.definitions.length - 1]?.name,
      id: last?.id,
    });
    expect(serializedAgentAccessEnvelopeByteLength(response)).toBeLessThanOrEqual(128 * 1024);
  });

  test('checks project ownership before listing runs and excludes payload, inputs, and jobs', async () => {
    const mocks = clients();
    mocks.projectHandlers.requireProjectForWorkspace.mockResolvedValue({project: project()});
    mocks.workflowHandlers.listWorkflowRuns.mockResolvedValue({
      runs: [run()],
      nextCursor: null,
      filteredTotalCount: 1,
    });

    const response = await tool(mocks, 'list_workflow_runs').execute({
      context,
      arguments: {project_id: projectId, status: 'failed', trigger_source: 'push'},
    });
    const result = expectSuccess<RunTestResult>(response);

    expect(mocks.projectHandlers.requireProjectForWorkspace).toHaveBeenCalledWith({
      workspaceId,
      projectId,
    });
    expect(mocks.workflowHandlers.listWorkflowRuns).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      limit: 50,
      filters: {status: 'failed', triggerSource: 'push'},
    });
    expect(result.runs[0]).not.toHaveProperty('trigger_payload');
    expect(result.runs[0]).not.toHaveProperty('inputs');
    expect(result.runs[0]).not.toHaveProperty('jobs');
  });

  test('omits absent filters from initial run and trigger event pages', async () => {
    const mocks = clients();
    mocks.projectHandlers.requireProjectForWorkspace.mockResolvedValue({project: project()});
    mocks.workflowHandlers.listWorkflowRuns.mockResolvedValue({
      runs: [],
      nextCursor: null,
      filteredTotalCount: 0,
    });
    mocks.triggerHandlers.listTriggerEvents.mockResolvedValue({events: [], nextCursor: null});

    await tool(mocks, 'list_workflow_runs').execute({
      context,
      arguments: {project_id: projectId},
    });
    await tool(mocks, 'list_trigger_events').execute({context, arguments: {}});

    expect(mocks.workflowHandlers.listWorkflowRuns).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      limit: 50,
    });
    expect(mocks.triggerHandlers.listTriggerEvents).toHaveBeenCalledWith({
      workspaceId,
      limit: 50,
    });
  });

  test('forwards valid cursors through every paged catalog read', async () => {
    const mocks = clients();
    const timestampCursor = encodeTimestampIdCursor({createdAt: new Date(isoDate), id: projectId});
    const definitionCursor = encodeStringIdCursor({value: 'Definition', id: definitionId});
    mocks.projectHandlers.listProjectCatalogByWorkspace.mockResolvedValue({
      projects: [],
      nextCursor: null,
    });
    mocks.definitionHandlers.listDefinitionsByProject.mockResolvedValue({
      definitions: [],
      sync: null,
      nextCursor: null,
    });
    mocks.projectHandlers.requireProjectForWorkspace.mockResolvedValue({project: project()});
    mocks.workflowHandlers.listWorkflowRuns.mockResolvedValue({
      runs: [],
      nextCursor: null,
      filteredTotalCount: 0,
    });
    mocks.triggerHandlers.listTriggerEvents.mockResolvedValue({events: [], nextCursor: null});

    await tool(mocks, 'list_projects').execute({
      context,
      arguments: {cursor: timestampCursor},
    });
    await tool(mocks, 'list_workflow_definitions').execute({
      context,
      arguments: {project_id: projectId, cursor: definitionCursor},
    });
    await tool(mocks, 'list_workflow_runs').execute({
      context,
      arguments: {project_id: projectId, cursor: timestampCursor},
    });
    await tool(mocks, 'list_trigger_events').execute({
      context,
      arguments: {cursor: timestampCursor},
    });

    const timestampReadCursor = {createdAt: isoDate, id: projectId};
    expect(mocks.projectHandlers.listProjectCatalogByWorkspace).toHaveBeenCalledWith({
      workspaceId,
      limit: 50,
      cursor: timestampReadCursor,
    });
    expect(mocks.definitionHandlers.listDefinitionsByProject).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      limit: 50,
      cursor: {value: 'Definition', id: definitionId},
    });
    expect(mocks.workflowHandlers.listWorkflowRuns).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      limit: 50,
      cursor: timestampReadCursor,
    });
    expect(mocks.triggerHandlers.listTriggerEvents).toHaveBeenCalledWith({
      workspaceId,
      limit: 50,
      cursor: {receivedAt: isoDate, id: projectId},
    });
  });

  test('resolves the latest annotation attempt and marks UTF-8 body truncation', async () => {
    const mocks = clients();
    mocks.workflowHandlers.getLatestRunAttempt.mockResolvedValue({attempt: 2});
    mocks.annotationHandlers.listAnnotationsForRunAttempt.mockResolvedValue({
      annotations: [
        {
          id: annotationId,
          job_id: uuid(9),
          job_execution_id: uuid(10),
          origin_step_id: uuid(11),
          origin_step_attempt: 1,
          context: 'failure',
          style: 'error',
          sequence: 4,
          body: '🙂'.repeat(3_000),
          createdAt: isoDate,
        },
      ],
      hasMore: false,
      nextCursor: null,
    });

    const response = await tool(mocks, 'get_run_annotations').execute({
      context,
      arguments: {run_id: runId},
    });
    const result = expectSuccess<AnnotationTestResult>(response);

    expect(mocks.workflowHandlers.getLatestRunAttempt).toHaveBeenCalledWith({
      workspaceId,
      workflowRunId: runId,
    });
    expect(mocks.annotationHandlers.listAnnotationsForRunAttempt).toHaveBeenCalledWith({
      workspaceId,
      workflowRunId: runId,
      workflowRunAttempt: 2,
      limit: 50,
    });
    expect(result.annotations[0]).toMatchObject({
      id: annotationId,
      origin_step_id: uuid(11),
      body_truncated: true,
      body_total_bytes: 12_000,
    });
    const annotation = result.annotations[0];
    expect(annotation).toBeDefined();
    if (!annotation) throw new Error('Expected an annotation');
    expect(new TextEncoder().encode(annotation.body).byteLength).toBe(8 * 1024);
    expect(JSON.stringify(response)).not.toContain('tool-call');
  });

  test('rejects numeric cursors outside the safe integer range', async () => {
    const mocks = clients();
    const cursor = Buffer.from(
      JSON.stringify({value: '9007199254740993', id: annotationId}),
      'utf8',
    ).toString('base64url');

    const response = await tool(mocks, 'get_run_annotations').execute({
      context,
      arguments: {run_id: runId, cursor},
    });

    expect(response).toEqual({ok: false, error: {code: 'invalid-request'}});
    expect(mocks.workflowHandlers.getLatestRunAttempt).not.toHaveBeenCalled();
    expect(mocks.annotationHandlers.listAnnotationsForRunAttempt).not.toHaveBeenCalled();
  });

  test('forwards annotation cursors and job execution filters', async () => {
    const mocks = clients();
    const cursor = {value: 4, id: annotationId};
    const jobExecutionId = uuid(10);
    mocks.workflowHandlers.getLatestRunAttempt.mockResolvedValue({attempt: 2});
    mocks.annotationHandlers.listAnnotationsForRunAttempt.mockResolvedValue({
      annotations: [],
      hasMore: false,
      nextCursor: null,
    });

    const response = await tool(mocks, 'get_run_annotations').execute({
      context,
      arguments: {
        run_id: runId,
        job_execution_id: jobExecutionId,
        cursor: encodeNumberIdCursor(cursor),
      },
    });

    expect(response).toEqual({ok: true, result: {annotations: [], next_cursor: null}});
    expect(mocks.annotationHandlers.listAnnotationsForRunAttempt).toHaveBeenCalledWith({
      workspaceId,
      workflowRunId: runId,
      workflowRunAttempt: 2,
      jobExecutionId,
      cursor,
      limit: 50,
    });
  });

  test('maps trigger filters and projects connection metadata', async () => {
    const mocks = clients();
    mocks.triggerHandlers.listTriggerEvents.mockResolvedValue({
      events: [
        {
          id: triggerEventId,
          eventRef: 'event-ref',
          origin: 'integration',
          workspaceId,
          provider: 'github',
          source: 'push',
          event: 'push',
          payload: {prompt: 'ignore'},
          replayOfEventId: null,
          deliveryId: 'delivery',
          connectionId: uuid(12),
          connectionName: 'Connection',
          outcome: 'routed',
          matchedCount: 1,
          receivedAt: isoDate,
          processedAt: isoDate,
          createdAt: isoDate,
        },
      ],
      nextCursor: null,
    });

    const response = await tool(mocks, 'list_trigger_events').execute({
      context,
      arguments: {
        source: ['push'],
        event: ['push'],
        origin: ['integration'],
        outcome: ['routed'],
        replayable: true,
        from: isoDate,
        to: isoDate,
      },
    });

    expect(mocks.triggerHandlers.listTriggerEvents).toHaveBeenCalledWith({
      workspaceId,
      limit: 50,
      filters: {
        source: ['push'],
        event: ['push'],
        origin: ['integration'],
        outcome: ['routed'],
        replayable: true,
        from: isoDate,
        to: isoDate,
      },
    });
    const result = expectSuccess<TriggerTestResult>(response);
    expect(result.trigger_events[0]).toMatchObject({
      id: triggerEventId,
      connection_name: 'Connection',
    });
    expect(result.trigger_events[0]).not.toHaveProperty('payload');
  });

  test('keeps cross-workspace project reads 404-shaped without exposing producer details', async () => {
    const mocks = clients();
    mocks.definitionHandlers.listDefinitionsByProject.mockRejectedValue(
      createInterModuleKnownError(
        definitionsInterModuleContract.methods.listDefinitionsByProject,
        'project-workspace-mismatch',
        {projectId, workspaceId},
      ),
    );

    const response = await tool(mocks, 'list_workflow_definitions').execute({
      context,
      arguments: {project_id: projectId},
    });

    expect(response).toEqual({ok: false, error: {code: 'not-found'}});
  });

  test('does not query annotations for a run from another workspace', async () => {
    const mocks = clients();
    mocks.workflowHandlers.getLatestRunAttempt.mockResolvedValue({attempt: null});

    const response = await tool(mocks, 'get_run_annotations').execute({
      context,
      arguments: {run_id: runId},
    });

    expect(response).toEqual({ok: false, error: {code: 'not-found'}});
    expect(mocks.annotationHandlers.listAnnotationsForRunAttempt).not.toHaveBeenCalled();
  });

  test('reduces an oversized annotation page and anchors its cursor to the retained item', async () => {
    const mocks = clients();
    mocks.workflowHandlers.getLatestRunAttempt.mockResolvedValue({attempt: 1});
    const annotations = Array.from({length: 100}, (_, index) => ({
      id: uuid(100 + index),
      job_id: uuid(200),
      job_execution_id: uuid(201),
      origin_step_id: uuid(202),
      origin_step_attempt: 1,
      context: `annotation-${index}`,
      style: 'info' as const,
      sequence: index + 1,
      body: 'x'.repeat(9_000),
      createdAt: isoDate,
    }));
    mocks.annotationHandlers.listAnnotationsForRunAttempt.mockResolvedValue({
      annotations,
      hasMore: false,
      nextCursor: null,
    });

    const response = await tool(mocks, 'get_run_annotations').execute({
      context,
      arguments: {run_id: runId, limit: 100},
    });
    const result = expectSuccess<AnnotationPageTestResult>(response);
    const last = result.annotations.at(-1);

    expect(result.annotations.length).toBeLessThan(100);
    expect(response).toMatchObject({ok: true, response_truncated: true});
    expect(response.response_total_bytes).toBeGreaterThan(128 * 1024);
    expect(last).toBeDefined();
    expect(result.next_cursor).toBeDefined();
    expect(decodeNumberIdCursor(result.next_cursor ?? undefined)).toEqual({
      value: last?.sequence,
      id: last?.id,
    });
    expect(serializedAgentAccessEnvelopeByteLength(response)).toBeLessThanOrEqual(128 * 1024);
  });
});

function clients() {
  const projectHandlers = {
    listProjectCatalogByWorkspace: vi.fn(),
    requireProjectForWorkspace: vi.fn(),
  };
  const definitionHandlers = {listDefinitionsByProject: vi.fn()};
  const {workflows, handlers: workflowHandlers} = createTestWorkflowsClient();
  const listAnnotationsForRunAttempt = vi.fn();
  const triggerHandlers = {listTriggerEvents: vi.fn()};
  const fakeClients = createFakeInterModuleClients({
    projects: defineInterModulePresentation(projectsInterModuleContract, {
      getProjectById: vi.fn(),
      getProjectBySource: vi.fn(),
      findProjectBySourceRepositoryName: vi.fn(),
      listProjectsBySourceConnection: vi.fn(),
      listProjectsByWorkspace: vi.fn(),
      listProjectCatalogByWorkspace: (input) =>
        projectHandlers.listProjectCatalogByWorkspace(input),
      requireProjectForWorkspace: (input) => projectHandlers.requireProjectForWorkspace(input),
      getWorkspaceProjectCounts: vi.fn(),
      resolveCheckoutTarget: vi.fn(),
    }),
    definitions: defineInterModulePresentation(definitionsInterModuleContract, {
      getDefinitionForWorkflowRun: vi.fn(),
      listDefinitionsByProject: (input) => definitionHandlers.listDefinitionsByProject(input),
      resolveDefinitionAtRef: vi.fn(),
      listDefinitionsAtRef: vi.fn(),
    }),
    annotations: defineInterModulePresentation(annotationsInterModuleContract, {
      replaceOrRemoveAnnotation: () => ({}),
      listAnnotationsForRunAttempt: (input) => listAnnotationsForRunAttempt(input),
    }),
    triggers: defineInterModulePresentation(triggersInterModuleContract, {
      listTriggerEvents: (input) => triggerHandlers.listTriggerEvents(input),
      getTriggerEvent: vi.fn(),
      getTriggerEventFacets: vi.fn(),
    }),
  });

  return {
    ...fakeClients,
    workflows,
    projectHandlers,
    definitionHandlers,
    workflowHandlers,
    annotationHandlers: {listAnnotationsForRunAttempt},
    triggerHandlers,
  };
}

function tool(mocks: ReturnType<typeof clients>, name: string) {
  const result = createAgentAccessTools(mocks).find((candidate) => candidate.name === name);
  if (!result) throw new Error(`Missing tool ${name}`);
  return result;
}

function expectSuccess<T>(response: AgentAccessEnvelopeDto): T {
  expect(response.ok).toBe(true);
  if (!response.ok) throw new Error('Expected a success response');
  expect(agentAccessEnvelopeSchema.safeParse(response).success).toBe(true);
  return response.result as T;
}

type DefinitionTestResult = {
  definitions: Array<Record<string, unknown>>;
  sync: {diagnostics: {items: Array<{message: string}>}} | null;
  next_cursor: string | null;
};

type DefinitionPageTestResult = {
  definitions: Array<{id: string}>;
  next_cursor: string | null;
};

type RunTestResult = {
  runs: Array<Record<string, unknown>>;
};

type AnnotationTestResult = {
  annotations: Array<{body: string}>;
};

type AnnotationPageTestResult = {
  annotations: Array<{id: string; sequence: number}>;
  next_cursor: string | null;
};

type TriggerTestResult = {
  trigger_events: Array<Record<string, unknown>>;
};

function project(id = projectId, name = 'Project', slug = 'project') {
  return {
    id,
    workspaceId,
    sourceConnectionId: uuid(20),
    sourceExternalRepositoryId: 'external-repository',
    sourceRepositoryOwner: 'shipfox',
    sourceRepositoryName: 'platform',
    sourceDefaultBranch: 'main',
    name,
    slug,
    createdAt: isoDate,
    updatedAt: isoDate,
  };
}

function definition() {
  return {
    id: definitionId,
    projectId,
    configPath: '.shipfox/workflow.yml',
    source: 'vcs' as const,
    sha: 'abc123',
    ref: 'main',
    name: 'Definition',
    workflowDocument: {prompt: 'ignore'},
    workflowModel: {jobs: {build: {steps: []}}},
    manualTrigger: null,
    fetchedAt: isoDate,
    createdAt: isoDate,
    updatedAt: isoDate,
  };
}

function run() {
  return {
    id: runId,
    project_id: projectId,
    definition_id: definitionId,
    number: 1,
    name: 'Run',
    workflow_name: 'Workflow',
    status: 'failed' as const,
    origin: 'synced' as const,
    dev_source: null,
    current_attempt: 1,
    latest_attempt: 1,
    trigger_provider: 'github',
    trigger_source: 'push',
    trigger_event: 'push',
    trigger_payload: {prompt: 'ignore'},
    trigger_reference: {repository: 'shipfox/platform', ref: 'main', commit: 'abc', actor: 'noe'},
    inputs: {prompt: 'ignore'},
    source_snapshot: null,
    created_at: isoDate,
    updated_at: isoDate,
    started_at: isoDate,
    finished_at: isoDate,
    jobs: [],
    job_status_counts: [{status: 'failed' as const, count: 1}],
    job_display_status_counts: [],
    has_started_job_execution: true,
  };
}

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}
