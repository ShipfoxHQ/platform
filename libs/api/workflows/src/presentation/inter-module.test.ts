import {createWorkflowModelSnapshot} from '@shipfox/api-definitions-dto';
import {WORKFLOW_SOURCE_SNAPSHOT_MAX_BYTES} from '@shipfox/api-workflows-dto';
import {workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import {workspacesInterModuleContract} from '@shipfox/api-workspaces-dto/inter-module';
import {createInterModuleKnownError, isInterModuleKnownError} from '@shipfox/inter-module';
import {decodeNumberIdCursor} from '@shipfox/node-drizzle';
import type {WorkflowRun} from '#core/entities/workflow-run.js';
import {
  InvalidJobRunnerLabelsError,
  WorkflowDiagnosticTooLargeError,
  WorkflowSourceSnapshotTooLargeError,
} from '#core/errors.js';
import {
  AgentConfigUnresolvableError,
  AgentIntegrationMaterializationError,
  DefinitionNotFoundError,
  InterpolationUnresolvableError,
  ProjectMismatchError,
} from '#core/index.js';
import {getWorkflowRunById} from '#db/workflow-runs.js';
import {workflowModel} from '#test/index.js';
import {
  createWorkflowsInterModulePresentation,
  toStartDevRunKnownError,
  toStartRunKnownError,
} from './inter-module.js';

const mocks = vi.hoisted(() => ({
  deliverEventToListener: vi.fn(),
  getJobScope: vi.fn(),
  getLatestRunAttempt: vi.fn(),
  getLatestStepAttempt: vi.fn(),
  getStepAttemptDetail: vi.fn(),
  getStepById: vi.fn(),
  getStepByIdForJobExecution: vi.fn(),
  getWorkflowJobDetail: vi.fn(),
  getWorkflowJobExecutionContext: vi.fn(),
  getWorkflowJobReadScope: vi.fn(),
  getWorkflowRunAccessScopeById: vi.fn(),
  getWorkflowRunAnnotationOrigins: vi.fn(),
  getWorkflowRunAttemptIdForScope: vi.fn(),
  getWorkflowRunDetail: vi.fn(),
  getWorkflowRunOverview: vi.fn(),
  getWorkflowRunSource: vi.fn(),
  getWorkflowStepReadScope: vi.fn(),
  listFailedStepAttempts: vi.fn(),
  listRunAttemptsPage: vi.fn(),
  listStepAttemptIdsByJobId: vi.fn(),
  listWorkflowExecutionSteps: vi.fn(),
  listWorkflowJobExecutionSummaries: vi.fn(),
  listWorkflowRunJobExplanationsPage: vi.fn(),
  listWorkflowRunJobSummaries: vi.fn(),
  listWorkflowRunJobsPage: vi.fn(),
  listWorkflowRuns: vi.fn(),
  listWorkflowStepAttemptSummaries: vi.fn(),
  workflowRunAnnotationOriginKey: (origin: {
    jobId: string;
    jobExecutionId: string;
    stepId: string;
    stepAttempt: number;
  }) => [origin.jobId, origin.jobExecutionId, origin.stepId, origin.stepAttempt].join(':'),
}));

vi.mock('#db/index.js', () => mocks);
vi.mock('#db/job-listener-events.js', () => ({
  deliverEventToListener: mocks.deliverEventToListener,
}));

const input = {
  workspaceId: '00000000-0000-4000-8000-000000000001',
  projectId: '00000000-0000-4000-8000-000000000002',
  definitionId: '00000000-0000-4000-8000-000000000003',
  triggerPayload: {
    provider: 'manual' as const,
    source: 'manual' as const,
    event: 'fire' as const,
    subscriptionId: '00000000-0000-4000-8000-000000000004',
    userId: '00000000-0000-4000-8000-000000000005',
  },
  idempotencyKey: 'manual-1',
};

type SyncedWorkflowRun = Extract<WorkflowRun, {origin: 'synced'}>;

function readTestRun(overrides: Partial<SyncedWorkflowRun> = {}): SyncedWorkflowRun {
  const createdAt = new Date('2026-08-31T10:00:00.000Z');
  return {
    id: crypto.randomUUID(),
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    definitionId: input.definitionId,
    number: 1,
    name: 'Build',
    workflowName: 'Build',
    nameOverride: null,
    origin: 'synced',
    devSource: null,
    status: 'running',
    currentAttempt: 1,
    triggerProvider: 'manual',
    triggerSource: 'manual',
    triggerEvent: 'fire',
    triggerPayload: input.triggerPayload,
    triggerReference: null,
    inputs: null,
    sourceSnapshot: null,
    triggerIdempotencyKey: null,
    timeoutMs: 3_600_000,
    version: 1,
    createdAt,
    updatedAt: createdAt,
    startedAt: createdAt,
    finishedAt: null,
    ...overrides,
  };
}

describe('Workflows inter-module presentation', () => {
  beforeEach(() => {
    mocks.getJobScope.mockReset();
    mocks.getLatestRunAttempt.mockReset();
    mocks.getLatestStepAttempt.mockReset();
    mocks.listStepAttemptIdsByJobId.mockReset();
    mocks.getStepAttemptDetail.mockReset();
    mocks.getStepById.mockReset();
    mocks.getStepByIdForJobExecution.mockReset();
    mocks.getWorkflowJobDetail.mockReset();
    mocks.getWorkflowJobExecutionContext.mockReset();
    mocks.getWorkflowJobReadScope.mockReset();
    mocks.getWorkflowRunAccessScopeById.mockReset();
    mocks.getWorkflowRunAnnotationOrigins.mockReset();
    mocks.getWorkflowRunAttemptIdForScope.mockReset();
    mocks.getWorkflowRunDetail.mockReset();
    mocks.getWorkflowRunOverview.mockReset();
    mocks.getWorkflowRunSource.mockReset();
    mocks.getWorkflowStepReadScope.mockReset();
    mocks.listFailedStepAttempts.mockReset();
    mocks.listRunAttemptsPage.mockReset();
    mocks.listWorkflowRunJobSummaries.mockReset();
    mocks.listWorkflowExecutionSteps.mockReset();
    mocks.listWorkflowJobExecutionSummaries.mockReset();
    mocks.listWorkflowRunJobExplanationsPage.mockReset();
    mocks.listWorkflowRunJobsPage.mockReset();
    mocks.listWorkflowRuns.mockReset();
    mocks.listWorkflowStepAttemptSummaries.mockReset();
    mocks.deliverEventToListener.mockReset();
    mocks.deliverEventToListener.mockResolvedValue({buffered: true, skipped: false});
  });

  it('authorizes bounded run reads and round-trips opaque cursors', async () => {
    const workspaceId = input.workspaceId;
    const workflowRunId = crypto.randomUUID();
    const projectId = input.projectId;
    const nextCursor = {value: 3, id: crypto.randomUUID()};
    mocks.getWorkflowRunAccessScopeById.mockResolvedValue({
      id: workflowRunId,
      workspaceId,
      projectId,
    });
    mocks.listRunAttemptsPage.mockResolvedValue({attempts: [], nextCursor});

    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      integrations: {} as never,
      projects: {} as never,
      runners: {} as never,
      secrets: {} as never,
      workspaces: {getWorkspaceOperatingState: vi.fn()} as never,
    });
    const result = await presentation.handlers.listWorkflowRunAttempts(
      {workspaceId, workflowRunId, limit: 1},
      {signal: new AbortController().signal},
    );

    expect(result).toMatchObject({items: [], nextCursor: expect.any(String)});
    expect(decodeNumberIdCursor(result?.nextCursor ?? undefined)).toEqual(nextCursor);
    expect(mocks.listRunAttemptsPage).toHaveBeenCalledWith({
      workflowRunId,
      projectId,
      limit: 1,
      cursor: undefined,
    });
  });

  it('resolves the latest concrete attempt before reading run source', async () => {
    const workspaceId = input.workspaceId;
    const workflowRunId = crypto.randomUUID();
    mocks.getWorkflowRunAccessScopeById.mockResolvedValue({
      id: workflowRunId,
      workspaceId,
      projectId: input.projectId,
    });
    mocks.getLatestRunAttempt.mockResolvedValue(3);
    mocks.getWorkflowRunSource.mockResolvedValue({
      workflowRunId,
      workflowRunAttempt: 3,
      origin: 'synced',
      sourceSnapshot: {content: 'name: Build\n', format: 'yaml'},
      sourceSnapshotBytes: 12,
    });

    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      integrations: {} as never,
      projects: {} as never,
      runners: {} as never,
      secrets: {} as never,
      workspaces: {getWorkspaceOperatingState: vi.fn()} as never,
    });
    await expect(
      presentation.handlers.getWorkflowRunSource(
        {workspaceId, workflowRunId},
        {signal: new AbortController().signal},
      ),
    ).resolves.toEqual({
      kind: 'available',
      workflow_run_id: workflowRunId,
      workflow_run_attempt: 3,
      source_snapshot: {content: 'name: Build\n', format: 'yaml'},
    });

    expect(mocks.getLatestRunAttempt).toHaveBeenCalledWith({workspaceId, workflowRunId});
    expect(mocks.getWorkflowRunSource).toHaveBeenCalledWith({workflowRunId, attempt: 3});
  });

  it('returns the resolved attempt on run-level pages even when they are empty', async () => {
    const workspaceId = input.workspaceId;
    const workflowRunId = crypto.randomUUID();
    const attempt = 3;
    mocks.getWorkflowRunAccessScopeById.mockResolvedValue({
      id: workflowRunId,
      workspaceId,
      projectId: input.projectId,
    });
    mocks.getLatestRunAttempt.mockResolvedValue(attempt);
    mocks.listWorkflowRunJobsPage.mockResolvedValue({items: [], nextCursor: null, total: 0});
    mocks.listWorkflowRunJobExplanationsPage.mockResolvedValue({items: [], nextCursor: null});
    mocks.listFailedStepAttempts.mockResolvedValue([]);
    mocks.getWorkflowRunAttemptIdForScope.mockResolvedValue(crypto.randomUUID());
    mocks.getWorkflowRunAnnotationOrigins.mockResolvedValue([]);
    const annotations = {
      listAnnotationsForRunAttempt: vi.fn().mockResolvedValue({
        annotations: [],
        hasMore: false,
        nextCursor: null,
      }),
    };
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      annotations: annotations as never,
      definitions: {} as never,
      integrations: {} as never,
      projects: {} as never,
      runners: {} as never,
      secrets: {} as never,
      workspaces: {getWorkspaceOperatingState: vi.fn()} as never,
    });
    const context = {signal: new AbortController().signal};

    await expect(
      presentation.handlers.listWorkflowRunJobs({workspaceId, workflowRunId, limit: 100}, context),
    ).resolves.toEqual({workflow_run_attempt: attempt, items: [], nextCursor: null, total: 0});
    await expect(
      presentation.handlers.listWorkflowRunAnnotations(
        {workspaceId, workflowRunId, limit: 100},
        context,
      ),
    ).resolves.toEqual({workflow_run_attempt: attempt, items: [], nextCursor: null});
    await expect(
      presentation.handlers.listWorkflowRunJobExplanations(
        {workspaceId, workflowRunId, limit: 100},
        context,
      ),
    ).resolves.toEqual({workflow_run_attempt: attempt, items: [], nextCursor: null});
    await expect(
      presentation.handlers.listFailedStepAttempts(
        {workspaceId, workflowRunId, limit: 10},
        context,
      ),
    ).resolves.toEqual({workflow_run_attempt: attempt, items: []});
  });

  it('masks cross-workspace bounded reads and rejects malformed cursors before the DB page', async () => {
    const workspaceId = input.workspaceId;
    const workflowRunId = crypto.randomUUID();
    mocks.getWorkflowRunAccessScopeById.mockResolvedValue({
      id: workflowRunId,
      workspaceId: crypto.randomUUID(),
      projectId: input.projectId,
    });
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      integrations: {} as never,
      projects: {} as never,
      runners: {} as never,
      secrets: {} as never,
      workspaces: {getWorkspaceOperatingState: vi.fn()} as never,
    });

    await expect(
      presentation.handlers.getWorkflowRunOverview(
        {workspaceId, workflowRunId},
        {signal: new AbortController().signal},
      ),
    ).resolves.toBeNull();
    expect(mocks.getWorkflowRunOverview).not.toHaveBeenCalled();

    mocks.getWorkflowRunAccessScopeById.mockResolvedValue({
      id: workflowRunId,
      workspaceId,
      projectId: input.projectId,
    });
    await expect(
      presentation.handlers.listWorkflowRunAttempts(
        {workspaceId, workflowRunId, limit: 1, cursor: 'malformed'},
        {signal: new AbortController().signal},
      ),
    ).rejects.toThrow('Invalid workflow read cursor');
    expect(mocks.listRunAttemptsPage).not.toHaveBeenCalled();
  });

  it('maps bounded failed step-attempt coordinates for run diagnostics', async () => {
    const workspaceId = input.workspaceId;
    const workflowRunId = crypto.randomUUID();
    const coordinate = {
      workflowRunId,
      workflowRunAttempt: 2,
      jobId: crypto.randomUUID(),
      jobExecutionId: crypto.randomUUID(),
      stepId: crypto.randomUUID(),
      stepAttemptId: crypto.randomUUID(),
      stepAttempt: 1,
    };
    mocks.getWorkflowRunAccessScopeById.mockResolvedValue({
      id: workflowRunId,
      workspaceId,
      projectId: input.projectId,
    });
    mocks.getLatestRunAttempt.mockResolvedValue(2);
    mocks.listFailedStepAttempts.mockResolvedValue([coordinate]);
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      integrations: {} as never,
      projects: {} as never,
      runners: {} as never,
      secrets: {} as never,
      workspaces: {getWorkspaceOperatingState: vi.fn()} as never,
    });

    await expect(
      presentation.handlers.listFailedStepAttempts(
        {workspaceId, workflowRunId, limit: 10},
        {signal: new AbortController().signal},
      ),
    ).resolves.toEqual({
      workflow_run_attempt: 2,
      items: [
        {
          workflow_run_id: workflowRunId,
          workflow_run_attempt: 2,
          job_id: coordinate.jobId,
          job_execution_id: coordinate.jobExecutionId,
          step_id: coordinate.stepId,
          step_attempt_id: coordinate.stepAttemptId,
          step_attempt: 1,
        },
      ],
    });
    expect(mocks.listFailedStepAttempts).toHaveBeenCalledWith({
      workspaceId,
      projectId: input.projectId,
      workflowRunId,
      attempt: 2,
      limit: 10,
    });
  });

  it('resolves latest run and step attempts within the requested workspace', async () => {
    mocks.getLatestRunAttempt.mockResolvedValue(3);
    mocks.getLatestStepAttempt.mockResolvedValue(2);
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      integrations: {} as never,
      projects: {} as never,
      runners: {} as never,
      secrets: {} as never,
      workspaces: {getWorkspaceOperatingState: vi.fn()} as never,
    });
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const workflowRunId = '00000000-0000-4000-8000-000000000002';
    const stepId = '00000000-0000-4000-8000-000000000003';

    await expect(
      presentation.handlers.getLatestRunAttempt(
        {workspaceId, workflowRunId},
        {
          signal: new AbortController().signal,
        },
      ),
    ).resolves.toEqual({attempt: 3});
    await expect(
      presentation.handlers.getLatestStepAttempt(
        {workspaceId, stepId},
        {
          signal: new AbortController().signal,
        },
      ),
    ).resolves.toEqual({attempt: 2});

    expect(mocks.getLatestRunAttempt).toHaveBeenCalledWith({workspaceId, workflowRunId});
    expect(mocks.getLatestStepAttempt).toHaveBeenCalledWith({workspaceId, stepId});
  });

  it('returns nullable exact reads for missing or cross-workspace resources', async () => {
    mocks.getWorkflowRunDetail.mockResolvedValue(undefined);
    mocks.getStepAttemptDetail.mockResolvedValue(undefined);
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      integrations: {} as never,
      projects: {} as never,
      runners: {} as never,
      secrets: {} as never,
      workspaces: {getWorkspaceOperatingState: vi.fn()} as never,
    });
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const workflowRunId = '00000000-0000-4000-8000-000000000002';
    const stepId = '00000000-0000-4000-8000-000000000003';

    await expect(
      presentation.handlers.getWorkflowRunDetail(
        {workspaceId, workflowRunId, attempt: 2},
        {signal: new AbortController().signal},
      ),
    ).resolves.toEqual({run: null});
    await expect(
      presentation.handlers.getStepAttemptDetail(
        {workspaceId, stepId, attempt: 2},
        {signal: new AbortController().signal},
      ),
    ).resolves.toEqual({detail: null});

    expect(mocks.getWorkflowRunDetail).toHaveBeenCalledWith(workflowRunId, 2, workspaceId);
    expect(mocks.getStepAttemptDetail).toHaveBeenCalledWith({
      stepId,
      attempt: 2,
      workspaceId,
    });
  });

  it('maps paginated run-list reads and only counts the first page', async () => {
    const firstRun = readTestRun({name: 'First', workflowName: 'First'});
    const secondRun = readTestRun({
      name: 'Second',
      workflowName: 'Second',
      number: 2,
    });
    const nextCursor = {
      createdAt: new Date('2026-08-31T09:00:00.000Z'),
      id: crypto.randomUUID(),
    };
    const firstJob = {
      id: crypto.randomUUID(),
      key: 'build',
      name: 'Build',
      status: 'running' as const,
      mode: 'one_shot' as const,
      listenerStatus: 'inactive' as const,
      executionStatus: 'running' as const,
      position: 0,
    };
    const secondJob = {
      ...firstJob,
      id: crypto.randomUUID(),
      key: 'deploy',
      name: 'Deploy',
      status: 'pending' as const,
      executionStatus: null,
    };
    const jobsByRun = new Map([
      [
        firstRun.id,
        {
          preview: [firstJob],
          statusCounts: [{status: 'running' as const, count: 1}],
          rawStatusCounts: [{status: 'running' as const, count: 1}],
          hasStartedJobExecution: true,
        },
      ],
      [
        secondRun.id,
        {
          preview: [secondJob],
          statusCounts: [{status: 'pending' as const, count: 1}],
          rawStatusCounts: [{status: 'pending' as const, count: 1}],
          hasStartedJobExecution: false,
        },
      ],
    ]);
    mocks.listWorkflowRuns
      .mockResolvedValueOnce({
        runs: [firstRun, secondRun],
        nextCursor,
        filteredTotalCount: 2,
      })
      .mockResolvedValueOnce({runs: [], nextCursor: null, filteredTotalCount: null});
    mocks.listWorkflowRunJobSummaries.mockResolvedValue(jobsByRun);
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      integrations: {} as never,
      projects: {} as never,
      runners: {} as never,
      secrets: {} as never,
      workspaces: {getWorkspaceOperatingState: vi.fn()} as never,
    });
    const from = '2026-08-01T00:00:00.000Z';
    const to = '2026-08-31T00:00:00.000Z';
    const handlerContext = {signal: new AbortController().signal};

    const firstPage = await presentation.handlers.listWorkflowRuns(
      {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        limit: 50,
        filters: {createdFrom: from, createdTo: to},
      },
      handlerContext,
    );
    const secondPage = await presentation.handlers.listWorkflowRuns(
      {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        limit: 50,
        cursor: {createdAt: nextCursor.createdAt.toISOString(), id: nextCursor.id},
      },
      handlerContext,
    );

    expect(mocks.listWorkflowRuns).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        limit: 50,
        cursor: undefined,
        filters: expect.objectContaining({
          createdFrom: new Date(from),
          createdTo: new Date(to),
        }),
        includeTotal: true,
      }),
    );
    expect(mocks.listWorkflowRuns).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        limit: 50,
        cursor: nextCursor,
        filters: undefined,
        includeTotal: false,
      }),
    );
    expect(mocks.listWorkflowRunJobSummaries).toHaveBeenNthCalledWith(1, [
      {id: firstRun.id, currentAttempt: firstRun.currentAttempt},
      {id: secondRun.id, currentAttempt: secondRun.currentAttempt},
    ]);
    expect(mocks.listWorkflowRunJobSummaries).toHaveBeenNthCalledWith(2, []);
    expect(firstPage).toMatchObject({
      nextCursor: {createdAt: nextCursor.createdAt.toISOString(), id: nextCursor.id},
      filteredTotalCount: 2,
      runs: [
        expect.objectContaining({
          id: firstRun.id,
          jobs: [expect.objectContaining({id: firstJob.id, key: 'build'})],
          job_status_counts: [{status: 'running', count: 1}],
          job_display_status_counts: [{status: 'running', count: 1}],
          has_started_job_execution: true,
        }),
        expect.objectContaining({
          id: secondRun.id,
          jobs: [expect.objectContaining({id: secondJob.id, key: 'deploy'})],
          job_status_counts: [{status: 'pending', count: 1}],
          job_display_status_counts: [{status: 'pending', count: 1}],
          has_started_job_execution: false,
        }),
      ],
    });
    expect(secondPage).toEqual({runs: [], nextCursor: null, filteredTotalCount: null});
  });

  it('returns the step attempt ids of a job for the session release sweep', async () => {
    const stepAttemptId = '00000000-0000-4000-8000-000000000010';
    mocks.listStepAttemptIdsByJobId.mockResolvedValue([stepAttemptId]);
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      integrations: {} as never,
      projects: {} as never,
      runners: {} as never,
      secrets: {} as never,
      workspaces: {getWorkspaceOperatingState: vi.fn()} as never,
    });

    const result = await presentation.handlers.listJobStepAttempts(
      {jobId: '00000000-0000-4000-8000-000000000006'},
      {signal: new AbortController().signal},
    );

    expect(mocks.listStepAttemptIdsByJobId).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000006',
    );
    expect(result).toEqual({stepAttemptIds: [stepAttemptId]});
  });

  it('returns only the resolved harness for Logs', async () => {
    mocks.getStepById.mockResolvedValue({config: {harness: 'claude'}});
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      integrations: {} as never,
      projects: {} as never,
      runners: {} as never,
      secrets: {} as never,
      workspaces: {getWorkspaceOperatingState: vi.fn()} as never,
    });

    const result = await presentation.handlers.getStepLogContext(
      {stepId: '00000000-0000-4000-8000-000000000006'},
      {signal: new AbortController().signal},
    );

    expect(result).toEqual({harness: 'claude'});
  });

  it('returns materialized agent integrations for the active leased step', async () => {
    const input = {
      jobId: '00000000-0000-4000-8000-000000000006',
      jobExecutionId: '00000000-0000-4000-8000-000000000007',
      runnerSessionId: '00000000-0000-4000-8000-000000000008',
      stepId: '00000000-0000-4000-8000-000000000009',
      attempt: 1,
    };
    const integration = {
      connectionId: 'connection-1',
      connectionSlug: 'github',
      provider: 'github',
      requiredScope: [],
      tools: [
        {
          id: 'files',
          sensitivity: 'read' as const,
          sensitive: false,
          requiredScope: [],
          inputSchema: {},
        },
      ],
    };
    mocks.getStepByIdForJobExecution.mockResolvedValue({
      currentAttempt: input.attempt,
      status: 'running',
      type: 'agent',
      config: {
        harness: 'pi',
        provider: 'openai',
        model: 'gpt-5',
        thinking: 'off',
        prompt: 'Review the change.',
        integrations: [integration],
      },
    });
    mocks.getJobScope.mockResolvedValue({workspaceId: '00000000-0000-4000-8000-000000000010'});
    const runners = {getLeaseState: vi.fn().mockResolvedValue({active: true})};
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      integrations: {} as never,
      projects: {} as never,
      runners: runners as never,
      secrets: {} as never,
      workspaces: {getWorkspaceOperatingState: vi.fn()} as never,
    });

    const result = await presentation.handlers.getLeasedAgentToolContext(input, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      workspaceId: '00000000-0000-4000-8000-000000000010',
      integrations: [integration],
    });
    expect(runners.getLeaseState).toHaveBeenCalledWith({
      jobId: input.jobId,
      jobExecutionId: input.jobExecutionId,
      runnerSessionId: input.runnerSessionId,
    });
  });

  describe('getLeasedAgentSessionContext', () => {
    const input = {
      jobId: '00000000-0000-4000-8000-000000000006',
      jobExecutionId: '00000000-0000-4000-8000-000000000007',
      runnerSessionId: '00000000-0000-4000-8000-000000000008',
      stepId: '00000000-0000-4000-8000-000000000009',
      attempt: 1,
    };

    const method = workflowsInterModuleContract.methods.getLeasedAgentSessionContext;

    function presentation(runners: {getLeaseState: ReturnType<typeof vi.fn>}) {
      return createWorkflowsInterModulePresentation({
        agent: {} as never,
        definitions: {} as never,
        integrations: {} as never,
        projects: {} as never,
        runners: runners as never,
        secrets: {} as never,
        workspaces: {getWorkspaceOperatingState: vi.fn()} as never,
      });
    }

    async function expectKnownError(call: Promise<unknown> | unknown, code: string): Promise<void> {
      try {
        await call;
        throw new Error(`Expected contract error ${code}, but the call succeeded`);
      } catch (error) {
        expect(isInterModuleKnownError(method, error) && (error as {code: string}).code).toBe(code);
      }
    }

    function arrangeRunningAgentStep() {
      mocks.getStepByIdForJobExecution.mockResolvedValue({
        currentAttempt: input.attempt,
        status: 'running',
        type: 'agent',
        config: {},
      });
      mocks.getJobScope.mockResolvedValue({
        workspaceId: '00000000-0000-4000-8000-000000000010',
        projectId: '00000000-0000-4000-8000-000000000011',
      });
    }

    it('returns the recorded session descriptor with the resolved scope', async () => {
      const stepAttemptId = '00000000-0000-4000-8000-000000000012';
      const sessionId = '00000000-0000-4000-8000-000000000013';
      arrangeRunningAgentStep();
      mocks.getStepAttemptDetail.mockResolvedValue({
        workflowRunId: '00000000-0000-4000-8000-000000000014',
        workflowRunAttemptId: '00000000-0000-4000-8000-000000000015',
        step: {},
        attempt: {
          id: stepAttemptId,
          config: null,
        },
        sessionDescriptor: {id: sessionId, key: 'main', mode: 'resume', segment: 3},
      });
      const runners = {getLeaseState: vi.fn().mockResolvedValue({active: true})};

      const result = await presentation(runners).handlers.getLeasedAgentSessionContext(input, {
        signal: new AbortController().signal,
      });

      expect(result).toEqual({
        workspaceId: '00000000-0000-4000-8000-000000000010',
        projectId: '00000000-0000-4000-8000-000000000011',
        workflowRunAttemptId: '00000000-0000-4000-8000-000000000015',
        stepAttemptId,
        session: {id: sessionId, key: 'main', mode: 'resume', segment: 3},
      });
      expect(mocks.getStepAttemptDetail).toHaveBeenCalledWith({
        stepId: input.stepId,
        attempt: input.attempt,
      });
    });

    it('returns a null session when the step has no recorded descriptor', async () => {
      arrangeRunningAgentStep();
      mocks.getStepAttemptDetail.mockResolvedValue({
        workflowRunId: '00000000-0000-4000-8000-000000000014',
        workflowRunAttemptId: '00000000-0000-4000-8000-000000000015',
        step: {},
        attempt: {id: '00000000-0000-4000-8000-000000000012', config: null},
        sessionDescriptor: null,
      });
      const runners = {getLeaseState: vi.fn().mockResolvedValue({active: true})};

      const result = await presentation(runners).handlers.getLeasedAgentSessionContext(input, {
        signal: new AbortController().signal,
      });

      expect(result.session).toBeNull();
    });

    it('fails fast when the lease is not active', async () => {
      arrangeRunningAgentStep();
      const runners = {getLeaseState: vi.fn().mockResolvedValue({active: false})};

      await expectKnownError(
        presentation(runners).handlers.getLeasedAgentSessionContext(input, {
          signal: new AbortController().signal,
        }),
        'lease-not-active',
      );
      expect(mocks.getStepAttemptDetail).not.toHaveBeenCalled();
    });

    it('rejects a malformed recorded descriptor', async () => {
      arrangeRunningAgentStep();
      mocks.getStepAttemptDetail.mockResolvedValue({
        workflowRunId: '00000000-0000-4000-8000-000000000014',
        workflowRunAttemptId: '00000000-0000-4000-8000-000000000015',
        step: {},
        attempt: {
          id: '00000000-0000-4000-8000-000000000012',
          config: null,
        },
        sessionDescriptor: {id: 'not-a-uuid', key: 'main', mode: 'resume', segment: 1},
      });
      const runners = {getLeaseState: vi.fn().mockResolvedValue({active: true})};

      await expectKnownError(
        presentation(runners).handlers.getLeasedAgentSessionContext(input, {
          signal: new AbortController().signal,
        }),
        'step-session-config-invalid',
      );
    });

    test.each([
      ['step-not-found', undefined],
      ['step-attempt-mismatch', {currentAttempt: 2, status: 'running', type: 'agent'}],
      ['step-not-running', {currentAttempt: 1, status: 'succeeded', type: 'agent'}],
      ['leased-step-not-agent', {currentAttempt: 1, status: 'running', type: 'run'}],
    ] as const)('maps a %s step to the published contract error', async (code, step) => {
      const runners = {getLeaseState: vi.fn().mockResolvedValue({active: true})};
      mocks.getStepByIdForJobExecution.mockResolvedValue(step);
      if (step !== undefined) {
        mocks.getJobScope.mockResolvedValue({
          workspaceId: '00000000-0000-4000-8000-000000000010',
          projectId: '00000000-0000-4000-8000-000000000011',
        });
      }

      await expectKnownError(
        presentation(runners).handlers.getLeasedAgentSessionContext(input, {
          signal: new AbortController().signal,
        }),
        code,
      );
    });

    it('maps a missing job scope to job-not-found', async () => {
      mocks.getStepByIdForJobExecution.mockResolvedValue({
        currentAttempt: input.attempt,
        status: 'running',
        type: 'agent',
        config: {},
      });
      mocks.getJobScope.mockResolvedValue(undefined);
      const runners = {getLeaseState: vi.fn().mockResolvedValue({active: true})};

      await expectKnownError(
        presentation(runners).handlers.getLeasedAgentSessionContext(input, {
          signal: new AbortController().signal,
        }),
        'job-not-found',
      );
      expect(mocks.getStepAttemptDetail).not.toHaveBeenCalled();
    });

    it('maps a missing step attempt detail to step-attempt-mismatch', async () => {
      mocks.getStepByIdForJobExecution.mockResolvedValue({
        currentAttempt: input.attempt,
        status: 'running',
        type: 'agent',
        config: {},
      });
      mocks.getJobScope.mockResolvedValue({
        workspaceId: '00000000-0000-4000-8000-000000000010',
        projectId: '00000000-0000-4000-8000-000000000011',
      });
      mocks.getStepAttemptDetail.mockResolvedValue(undefined);
      const runners = {getLeaseState: vi.fn().mockResolvedValue({active: true})};

      await expectKnownError(
        presentation(runners).handlers.getLeasedAgentSessionContext(input, {
          signal: new AbortController().signal,
        }),
        'step-attempt-mismatch',
      );
    });
  });

  test.each([
    ['definition-not-found', () => new DefinitionNotFoundError(input.definitionId)],
    ['project-mismatch', () => new ProjectMismatchError(input.projectId, input.definitionId)],
    ['agent-config-unresolvable', () => new AgentConfigUnresolvableError(input.definitionId)],
    [
      'agent-integration-materialization-failed',
      () => new AgentIntegrationMaterializationError('integration unavailable'),
    ],
    [
      'interpolation-unresolvable',
      () =>
        new InterpolationUnresolvableError(input.definitionId, {
          field: 'env',
          source: 'event.ref',
          envKey: 'REF',
        }),
    ],
    ['invalid-job-runner-labels', () => new InvalidJobRunnerLabelsError(['gpu'])],
    [
      'source-snapshot-too-large',
      () =>
        new WorkflowSourceSnapshotTooLargeError(
          WORKFLOW_SOURCE_SNAPSHOT_MAX_BYTES,
          WORKFLOW_SOURCE_SNAPSHOT_MAX_BYTES + 1,
        ),
    ],
    [
      'diagnostic-too-large',
      () => new WorkflowDiagnosticTooLargeError('config', 64 * 1024, 64 * 1024 + 1),
    ],
  ] as const)('maps %s to the published contract error', (code, error) => {
    const result = toStartRunKnownError(error(), input.definitionId);

    expect(
      isInterModuleKnownError(workflowsInterModuleContract.methods.startRunFromTrigger, result) &&
        result.code,
    ).toBe(code);
  });

  test('maps a missing workspace from the Workspace contract for start-run', async () => {
    const getWorkspaceOperatingState = vi
      .fn()
      .mockRejectedValue(
        createInterModuleKnownError(
          workspacesInterModuleContract.methods.getWorkspaceOperatingState,
          'workspace-not-found',
          {workspaceId: input.workspaceId},
        ),
      );
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      integrations: {} as never,
      projects: {} as never,
      runners: {} as never,
      secrets: {} as never,
      workspaces: {getWorkspaceOperatingState} as never,
    });

    const error = await Promise.resolve(
      presentation.handlers.startRunFromTrigger(input, {
        signal: new AbortController().signal,
      }),
    ).catch((caught: unknown) => caught);

    expect(
      isInterModuleKnownError(workflowsInterModuleContract.methods.startRunFromTrigger, error) &&
        error.code,
    ).toBe('workspace-not-found');
  });

  const devInput = {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    workflowId: '00000000-0000-4000-8000-000000000006',
    model: createWorkflowModelSnapshot(
      workflowModel({name: 'Dev Workflow', jobs: {build: {steps: [{run: 'echo dev'}]}}}),
    ),
    sourceSnapshot: {content: 'name: Dev Workflow\n', format: 'yaml' as const},
    devSource: {
      ref: 'fix-triage-prompt',
      commit: 'a'.repeat(40),
      configPath: '.shipfox/workflows/triage-sentry.yml',
      initiatedByUserId: input.triggerPayload.userId,
    },
    triggerPayload: {
      source: 'manual' as const,
      event: 'fire' as const,
      userId: input.triggerPayload.userId,
    },
  };

  test.each([
    ['agent-config-unresolvable', () => new AgentConfigUnresolvableError(devInput.workflowId)],
    [
      'agent-integration-materialization-failed',
      () => new AgentIntegrationMaterializationError('integration unavailable'),
    ],
    [
      'interpolation-unresolvable',
      () =>
        new InterpolationUnresolvableError(devInput.workflowId, {
          field: 'env',
          source: 'event.ref',
          envKey: 'REF',
        }),
    ],
    ['invalid-job-runner-labels', () => new InvalidJobRunnerLabelsError(['gpu'])],
    [
      'source-snapshot-too-large',
      () =>
        new WorkflowSourceSnapshotTooLargeError(
          WORKFLOW_SOURCE_SNAPSHOT_MAX_BYTES,
          WORKFLOW_SOURCE_SNAPSHOT_MAX_BYTES + 1,
        ),
    ],
    [
      'diagnostic-too-large',
      () => new WorkflowDiagnosticTooLargeError('evaluation_trace', 64 * 1024, 64 * 1024 + 1),
    ],
  ] as const)('maps %s to the published dev-run contract error', (code, error) => {
    const result = toStartDevRunKnownError(error());

    expect(
      isInterModuleKnownError(workflowsInterModuleContract.methods.startDevRun, result) &&
        result.code,
    ).toBe(code);
  });

  test.each([
    ['definition-not-found', () => new DefinitionNotFoundError(devInput.workflowId)],
    ['project-mismatch', () => new ProjectMismatchError(devInput.projectId, devInput.workflowId)],
  ] as const)('does not map %s on the dev-run contract', (_code, error) => {
    const result = toStartDevRunKnownError(error());

    expect(isInterModuleKnownError(workflowsInterModuleContract.methods.startDevRun, result)).toBe(
      false,
    );
  });

  test.each([
    ['suspended', 'workspace-suspended'],
    ['deleted', 'workspace-deleted'],
  ] as const)('rejects dev runs for %s workspaces before creating a run', async (status, code) => {
    const getWorkspaceOperatingState = vi.fn().mockResolvedValue({status});
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      integrations: {} as never,
      projects: {} as never,
      runners: {} as never,
      secrets: {} as never,
      workspaces: {getWorkspaceOperatingState} as never,
    });

    const error = await Promise.resolve(
      presentation.handlers.startDevRun(devInput, {
        signal: new AbortController().signal,
      }),
    ).catch((caught: unknown) => caught);

    expect(getWorkspaceOperatingState).toHaveBeenCalledWith({workspaceId: devInput.workspaceId});
    expect(
      isInterModuleKnownError(workflowsInterModuleContract.methods.startDevRun, error) &&
        error.code,
    ).toBe(code);
  });

  test('creates a dev run with dev provenance and lineage numbering', async () => {
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      integrations: {} as never,
      projects: {} as never,
      runners: {} as never,
      secrets: {} as never,
      workspaces: {
        getWorkspaceOperatingState: vi.fn().mockResolvedValue({status: 'active'}),
      } as never,
    });
    // A fresh lineage id keeps the assertion independent of counter rows left
    // behind by earlier suite runs against the shared test database.
    const workflowId = crypto.randomUUID();
    const runInput = {...devInput, workflowId};

    const first = await presentation.handlers.startDevRun(runInput, {
      signal: new AbortController().signal,
    });
    const second = await presentation.handlers.startDevRun(runInput, {
      signal: new AbortController().signal,
    });

    const firstRun = await getWorkflowRunById(first.id);
    const secondRun = await getWorkflowRunById(second.id);
    expect(firstRun).toMatchObject({
      definitionId: workflowId,
      origin: 'dev',
      devSource: {...devInput.devSource, replayOfEventId: null},
      number: 1,
      name: 'Dev Workflow',
      sourceSnapshot: devInput.sourceSnapshot,
    });
    // Each call is a distinct intent, so the lineage number sequence continues.
    expect(secondRun).toMatchObject({definitionId: workflowId, origin: 'dev', number: 2});
  });

  test.each([
    ['suspended', 'workspace-suspended'],
    ['deleted', 'workspace-deleted'],
  ] as const)('rejects new workflow runs for %s workspaces before loading the definition', async (status, code) => {
    const getWorkspaceOperatingState = vi.fn().mockResolvedValue({status});
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      integrations: {} as never,
      projects: {} as never,
      runners: {} as never,
      secrets: {} as never,
      workspaces: {getWorkspaceOperatingState} as never,
    });

    const error = await Promise.resolve(
      presentation.handlers.startRunFromTrigger(input, {
        signal: new AbortController().signal,
      }),
    ).catch((caught: unknown) => caught);

    expect(getWorkspaceOperatingState).toHaveBeenCalledWith({workspaceId: input.workspaceId});
    expect(
      isInterModuleKnownError(workflowsInterModuleContract.methods.startRunFromTrigger, error) &&
        error.code,
    ).toBe(code);
  });

  test('maps a missing workspace from the Workspace contract for listener delivery', async () => {
    const jobId = '00000000-0000-4000-8000-000000000006';
    const workspaceId = '00000000-0000-4000-8000-000000000007';
    mocks.getJobScope.mockResolvedValue({workspaceId, projectId: input.projectId});
    const getWorkspaceOperatingState = vi
      .fn()
      .mockRejectedValue(
        createInterModuleKnownError(
          workspacesInterModuleContract.methods.getWorkspaceOperatingState,
          'workspace-not-found',
          {workspaceId},
        ),
      );
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      integrations: {} as never,
      projects: {} as never,
      runners: {} as never,
      secrets: {} as never,
      workspaces: {getWorkspaceOperatingState} as never,
    });

    const error = await Promise.resolve(
      presentation.handlers.deliverEventToJobListener(
        {
          jobId,
          disposition: 'fire',
          eventRef: 'event-1',
          deliveryId: 'delivery-1',
          source: 'github',
          event: 'push',
          provider: 'github',
          payload: {},
          receivedAt: '2026-07-20T12:00:00.000Z',
        },
        {signal: new AbortController().signal},
      ),
    ).catch((caught: unknown) => caught);

    expect(
      isInterModuleKnownError(
        workflowsInterModuleContract.methods.deliverEventToJobListener,
        error,
      ) && error.code,
    ).toBe('workspace-not-found');
  });

  test.each([
    ['suspended', 'workspace-suspended'],
    ['deleted', 'workspace-deleted'],
  ] as const)('rejects listener execution materialization for %s workspaces', async (status, code) => {
    const jobId = '00000000-0000-4000-8000-000000000006';
    const workspaceId = '00000000-0000-4000-8000-000000000007';
    mocks.getJobScope.mockResolvedValue({workspaceId, projectId: input.projectId});
    const getWorkspaceOperatingState = vi.fn().mockResolvedValue({status});
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      integrations: {} as never,
      projects: {} as never,
      runners: {} as never,
      secrets: {} as never,
      workspaces: {getWorkspaceOperatingState} as never,
    });

    const error = await Promise.resolve(
      presentation.handlers.deliverEventToJobListener(
        {
          jobId,
          disposition: 'fire',
          eventRef: 'event-1',
          deliveryId: 'delivery-1',
          source: 'github',
          event: 'push',
          provider: 'github',
          payload: {},
          receivedAt: '2026-07-20T12:00:00.000Z',
        },
        {signal: new AbortController().signal},
      ),
    ).catch((caught: unknown) => caught);

    expect(getWorkspaceOperatingState).toHaveBeenCalledWith({workspaceId});
    expect(mocks.deliverEventToListener).not.toHaveBeenCalled();
    expect(
      isInterModuleKnownError(
        workflowsInterModuleContract.methods.deliverEventToJobListener,
        error,
      ) && error.code,
    ).toBe(code);
  });

  test.each([
    ['suspended', 'workspace-suspended'],
    ['deleted', 'workspace-deleted'],
  ] as const)('rejects fire deliveries with a pre-resolved trigger reference for %s workspaces', async (status, code) => {
    const jobId = '00000000-0000-4000-8000-000000000006';
    const workspaceId = '00000000-0000-4000-8000-000000000007';
    mocks.getJobScope.mockResolvedValue({workspaceId, projectId: input.projectId});
    const getWorkspaceOperatingState = vi.fn().mockResolvedValue({status});
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      integrations: {} as never,
      projects: {} as never,
      runners: {} as never,
      secrets: {} as never,
      workspaces: {getWorkspaceOperatingState} as never,
    });

    const error = await Promise.resolve(
      presentation.handlers.deliverEventToJobListener(
        {
          jobId,
          disposition: 'fire',
          eventRef: 'event-1',
          deliveryId: 'delivery-1',
          source: 'github',
          event: 'push',
          provider: 'github',
          payload: {},
          receivedAt: '2026-07-20T12:00:00.000Z',
          triggerReference: {
            project: {id: input.projectId},
            repository: 'acme/api',
            ref: 'refs/heads/main',
            commit: 'a'.repeat(40),
            actor: 'octocat',
          },
        },
        {signal: new AbortController().signal},
      ),
    ).catch((caught: unknown) => caught);

    expect(getWorkspaceOperatingState).toHaveBeenCalledWith({workspaceId});
    expect(mocks.deliverEventToListener).not.toHaveBeenCalled();
    expect(
      isInterModuleKnownError(
        workflowsInterModuleContract.methods.deliverEventToJobListener,
        error,
      ) && error.code,
    ).toBe(code);
  });

  test('allows resolve deliveries for suspended workspaces', async () => {
    const jobId = '00000000-0000-4000-8000-000000000006';
    mocks.getJobScope.mockResolvedValue({workspaceId: input.workspaceId});
    const getWorkspaceOperatingState = vi.fn().mockResolvedValue({status: 'suspended'});
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      integrations: {} as never,
      projects: {} as never,
      runners: {} as never,
      secrets: {} as never,
      workspaces: {getWorkspaceOperatingState} as never,
    });

    await expect(
      presentation.handlers.deliverEventToJobListener(
        {
          jobId,
          disposition: 'resolve',
          eventRef: 'event-1',
          deliveryId: 'delivery-1',
          source: 'github',
          event: 'push',
          provider: 'github',
          payload: {},
          receivedAt: '2026-07-20T12:00:00.000Z',
        },
        {signal: new AbortController().signal},
      ),
    ).resolves.toEqual({buffered: true, skipped: false});
    expect(mocks.getJobScope).not.toHaveBeenCalled();
    expect(getWorkspaceOperatingState).not.toHaveBeenCalled();
    expect(mocks.deliverEventToListener).toHaveBeenCalled();
  });

  test('persists a null trigger reference when fire delivery has no source connection', async () => {
    const jobId = '00000000-0000-4000-8000-000000000006';
    const workspaceId = '00000000-0000-4000-8000-000000000007';
    mocks.getJobScope.mockResolvedValue({workspaceId});
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      integrations: {} as never,
      projects: {} as never,
      runners: {} as never,
      secrets: {} as never,
      workspaces: {
        getWorkspaceOperatingState: vi.fn().mockResolvedValue({status: 'active'}),
      } as never,
    });

    await presentation.handlers.deliverEventToJobListener(
      {
        jobId,
        disposition: 'fire',
        eventRef: 'event-1',
        deliveryId: 'delivery-1',
        source: 'github',
        event: 'push',
        provider: 'github',
        payload: {},
        receivedAt: '2026-07-20T12:00:00.000Z',
      },
      {signal: new AbortController().signal},
    );

    expect(mocks.deliverEventToListener).toHaveBeenCalledWith(
      expect.objectContaining({triggerReference: null}),
    );
  });

  test('resolves and persists the trigger reference for fire deliveries', async () => {
    const jobId = '00000000-0000-4000-8000-000000000006';
    const workspaceId = '00000000-0000-4000-8000-000000000007';
    const connectionId = '00000000-0000-4000-8000-000000000008';
    const projectId = '00000000-0000-4000-8000-000000000009';
    const externalRepositoryId = 'github:42';
    const integrations = {
      resolveTriggerReference: vi.fn().mockResolvedValue({
        externalRepositoryId,
        ref: 'refs/heads/main',
        commit: 'a'.repeat(40),
      }),
      resolveSourceRepository: vi.fn().mockResolvedValue({
        repository: {owner: 'acme', name: 'api'},
      }),
    };
    const projects = {
      getProjectBySource: vi.fn().mockResolvedValue({project: {id: projectId}}),
    };
    mocks.getJobScope.mockResolvedValue({workspaceId, projectId: input.projectId});
    const getWorkspaceOperatingState = vi.fn().mockResolvedValue({status: 'active'});
    const presentation = createWorkflowsInterModulePresentation({
      agent: {} as never,
      definitions: {} as never,
      integrations: integrations as never,
      projects: projects as never,
      runners: {} as never,
      secrets: {} as never,
      workspaces: {getWorkspaceOperatingState} as never,
    });

    await presentation.handlers.deliverEventToJobListener(
      {
        jobId,
        disposition: 'fire',
        eventRef: 'event-1',
        deliveryId: 'delivery-1',
        source: 'github',
        event: 'push',
        provider: 'github',
        triggerConnectionId: connectionId,
        payload: {ref: 'refs/heads/main'},
        receivedAt: '2026-07-20T12:00:00.000Z',
      },
      {signal: new AbortController().signal},
    );

    expect(integrations.resolveTriggerReference).toHaveBeenCalledWith({
      workspaceId,
      connectionId,
      payload: {ref: 'refs/heads/main'},
    });
    expect(projects.getProjectBySource).toHaveBeenCalledWith({
      workspaceId,
      sourceConnectionId: connectionId,
      sourceExternalRepositoryId: externalRepositoryId,
    });
    expect(mocks.deliverEventToListener).toHaveBeenCalledWith({
      jobId,
      disposition: 'fire',
      eventRef: 'event-1',
      deliveryId: 'delivery-1',
      source: 'github',
      event: 'push',
      provider: 'github',
      triggerConnectionId: connectionId,
      payload: {ref: 'refs/heads/main'},
      receivedAt: new Date('2026-07-20T12:00:00.000Z'),
      triggerReference: {
        project: {id: projectId},
        repository: 'acme/api',
        ref: 'refs/heads/main',
        commit: 'a'.repeat(40),
      },
    });
  });
});
