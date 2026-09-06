import type {
  GetWorkflowJobResultDto,
  GetWorkflowRunResultDto,
  ListWorkflowExecutionStepsResultDto,
  ListWorkflowJobExecutionsResultDto,
  ListWorkflowRunAttemptsResultDto,
  ListWorkflowRunJobsResultDto,
  ListWorkflowStepAttemptsResultDto,
} from '@shipfox/api-agent-access-dto';
import {
  type AgentAccessEnvelopeDto,
  agentAccessEnvelopeSchema,
} from '@shipfox/api-agent-access-dto';
import type {AgentAccessContext} from '@shipfox/api-auth-context';
import type {
  JobExecutionSummaryDto,
  StepAttemptSummaryDto,
  StepSummaryDto,
  WorkflowJobDetailDto,
  WorkflowRunJobOverviewDto,
  WorkflowRunOverviewResponseDto,
} from '@shipfox/api-workflows-dto';
import {
  decodeStringIdCursor,
  encodeNumberIdCursor,
  encodeStringIdCursor,
} from '@shipfox/node-drizzle';
import {createTestWorkflowsClient} from '#test/fixtures/workflows-client.js';
import {createAgentAccessTools} from './paged-tools.js';
import {serializedAgentAccessEnvelopeByteLength} from './response.js';

const workspaceId = uuid(1);
const runId = uuid(2);
const projectId = uuid(3);
const definitionId = uuid(4);
const jobId = uuid(5);
const executionId = uuid(6);
const stepId = uuid(7);
const attemptId = uuid(8);
const isoDate = '2026-08-01T00:00:00.000Z';
const context: AgentAccessContext = {
  userId: uuid(9),
  workspaceId,
  scopes: ['read'],
  credential: {kind: 'oauth_grant', grantId: uuid(10), clientId: 'client-1'},
};

describe('bounded workflow agent-access tools', () => {
  test('registers the complete progressive traversal without a workspace argument', () => {
    const mocks = clients();
    const tools = createAgentAccessTools(mocks).filter((tool) => tool.name.includes('workflow'));

    expect(tools.map((tool) => tool.name)).toEqual([
      'list_workflow_definitions',
      'list_workflow_runs',
      'get_workflow_run',
      'list_workflow_run_attempts',
      'list_workflow_run_jobs',
      'get_workflow_job',
      'list_workflow_job_executions',
      'list_workflow_execution_steps',
      'list_workflow_step_attempts',
    ]);
    for (const tool of tools) {
      expect(tool.annotations).toEqual({readOnlyHint: true});
      expect(tool.inputSchema.properties).not.toHaveProperty('workspace_id');
    }
  });

  test('returns a compact selected-attempt summary and pins the latest attempt', async () => {
    const mocks = clients();
    mocks.workflowHandlers.getWorkflowRunOverview.mockResolvedValue(overview());

    const response = await tool(mocks, 'get_workflow_run').execute({
      context,
      arguments: {run_id: runId},
    });
    const result = expectSuccess<GetWorkflowRunResultDto>(response);

    expect(mocks.workflowHandlers.getWorkflowRunOverview.mock.calls[0]?.[0]).toStrictEqual({
      workspaceId,
      workflowRunId: runId,
    });
    expect(result).toMatchObject({
      id: runId,
      status: 'failed',
      attempt: {attempt: 2, workflow_run_id: runId},
      job_status_counts: [
        {status: 'failed', count: 1},
        {status: 'succeeded', count: 1},
      ],
      has_started_job_execution: true,
    });
    expect(result).not.toHaveProperty('jobs');
    expect(result).not.toHaveProperty('trigger_payload');
  });

  test('passes an explicit run attempt through to the bounded overview', async () => {
    const mocks = clients();
    mocks.workflowHandlers.getWorkflowRunOverview.mockResolvedValue(overview(1));

    await tool(mocks, 'get_workflow_run').execute({
      context,
      arguments: {run_id: runId, attempt: 1},
    });

    expect(mocks.workflowHandlers.getWorkflowRunOverview).toHaveBeenCalledWith({
      workspaceId,
      workflowRunId: runId,
      attempt: 1,
    });
  });

  test('relays status counts from the large workflow overview variant', async () => {
    const mocks = clients();
    mocks.workflowHandlers.getWorkflowRunOverview.mockResolvedValue({
      ...overview(),
      jobs: {
        kind: 'large',
        total: 250,
        status_counts: [
          {status: 'failed', count: 3},
          {status: 'succeeded', count: 247},
        ],
        first_page: {items: [], next_cursor: null, total: 100},
      },
    });

    const response = await tool(mocks, 'get_workflow_run').execute({
      context,
      arguments: {run_id: runId},
    });
    const result = expectSuccess<GetWorkflowRunResultDto>(response);

    expect(result.job_status_counts).toEqual([
      {status: 'failed', count: 3},
      {status: 'succeeded', count: 247},
    ]);
  });

  test('pages run attempts with the producer cursor and exposes run coordinates', async () => {
    const mocks = clients();
    const nextCursor = encodeNumberIdCursor({value: 1, id: attemptId});
    mocks.workflowHandlers.listWorkflowRunAttempts.mockResolvedValue({
      items: [runAttempt(2), runAttempt(1)],
      nextCursor,
    });

    const response = await tool(mocks, 'list_workflow_run_attempts').execute({
      context,
      arguments: {run_id: runId, limit: 2},
    });
    const result = expectSuccess<ListWorkflowRunAttemptsResultDto>(response);

    expect(mocks.workflowHandlers.listWorkflowRunAttempts).toHaveBeenCalledWith({
      workspaceId,
      workflowRunId: runId,
      limit: 2,
    });
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]).toMatchObject({workflow_run_id: runId, attempt: 2});
    expect(result.next_cursor).toBe(nextCursor);
    expect(agentAccessEnvelopeSchema.safeParse(response).success).toBe(true);
  });

  test('pages jobs for a pinned attempt and excludes dependency data', async () => {
    const mocks = clients();
    const producerCursor = encodeStringIdCursor({value: '0', id: jobId});
    mocks.workflowHandlers.listWorkflowRunJobs.mockResolvedValue({
      workflow_run_attempt: 2,
      items: [{...job(), dependencies: ['other-job']}],
      nextCursor: producerCursor,
      total: 1,
    });

    const response = await tool(mocks, 'list_workflow_run_jobs').execute({
      context,
      arguments: {run_id: runId, attempt: 2, limit: 1},
    });
    const result = expectSuccess<ListWorkflowRunJobsResultDto>(response);

    expect(mocks.workflowHandlers.listWorkflowRunJobs).toHaveBeenCalledWith({
      workspaceId,
      workflowRunId: runId,
      attempt: 2,
      limit: 1,
    });
    expect(result).toMatchObject({
      workflow_run_id: runId,
      workflow_run_attempt: 2,
      jobs: [{id: jobId, position: 0}],
      total: 1,
    });
    expect(result.jobs[0]).not.toHaveProperty('dependencies');
  });

  test('shortens an oversized job page and anchors its cursor to the retained job', async () => {
    const mocks = clients();
    const jobs = Array.from({length: 100}, (_, index) => ({
      ...job(),
      id: uuid(100 + index),
      key: 'k'.repeat(20_000),
      name: 'n'.repeat(20_000),
      position: index,
      default_execution: execution(uuid(200 + index), index + 1, 'e'.repeat(20_000)),
    }));
    mocks.workflowHandlers.listWorkflowRunJobs.mockResolvedValue({
      workflow_run_attempt: 2,
      items: jobs,
      nextCursor: null,
      total: 100,
    });

    const response = await tool(mocks, 'list_workflow_run_jobs').execute({
      context,
      arguments: {run_id: runId, attempt: 2, limit: 100},
    });
    const result = expectSuccess<ListWorkflowRunJobsResultDto>(response);
    const last = result.jobs.at(-1);

    expect(result.jobs.length).toBeLessThan(100);
    expect(response).toMatchObject({ok: true, response_truncated: true});
    expect(response.response_total_bytes).toBeGreaterThan(128 * 1024);
    expect(serializedAgentAccessEnvelopeByteLength(response)).toBeLessThanOrEqual(128 * 1024);
    expect(last).toBeDefined();
    expect(decodeStringIdCursor(result.next_cursor ?? undefined)).toEqual({
      value: String(last?.position),
      id: last?.id,
    });
  });

  test('returns a compact job while leaving selected child collections lazy', async () => {
    const mocks = clients();
    mocks.workflowHandlers.getWorkflowJobDetail.mockResolvedValue(jobDetail());

    const response = await tool(mocks, 'get_workflow_job').execute({
      context,
      arguments: {job_id: jobId, execution_id: executionId},
    });
    const result = expectSuccess<GetWorkflowJobResultDto>(response);

    expect(mocks.workflowHandlers.getWorkflowJobDetail).toHaveBeenCalledWith({
      workspaceId,
      jobId,
      executionId,
    });
    expect(result).toMatchObject({
      workflow_run_id: runId,
      workflow_run_attempt: 2,
      job: {id: jobId},
      selected_execution: {id: executionId, has_context: true},
    });
    expect(result.job).not.toHaveProperty('dependencies');
    expect(result.selected_execution).not.toHaveProperty('steps');
    expect(JSON.stringify(result)).not.toContain('source_location');
    expect(JSON.stringify(result)).not.toContain('gate_result');
    expect(JSON.stringify(result)).not.toContain('error');
  });

  test('supports jobs without an execution without fabricating a child id', async () => {
    const mocks = clients();
    mocks.workflowHandlers.getWorkflowJobDetail.mockResolvedValue({
      ...jobDetail(),
      selected_execution: null,
    });

    const response = await tool(mocks, 'get_workflow_job').execute({
      context,
      arguments: {job_id: jobId},
    });
    const result = expectSuccess<GetWorkflowJobResultDto>(response);

    expect(mocks.workflowHandlers.getWorkflowJobDetail).toHaveBeenCalledWith({
      workspaceId,
      jobId,
    });
    expect(result.selected_execution).toBeNull();
  });

  test('pages execution history with job coordinates and caps large text fields', async () => {
    const mocks = clients();
    const executions = Array.from({length: 100}, (_, index) =>
      execution(uuid(100 + index), index + 1, 'x'.repeat(20_000)),
    );
    mocks.workflowHandlers.listWorkflowJobExecutions.mockResolvedValue({
      items: executions,
      nextCursor: null,
      total: 100,
    });

    const response = await tool(mocks, 'list_workflow_job_executions').execute({
      context,
      arguments: {job_id: jobId, limit: 100},
    });
    const result = expectSuccess<ListWorkflowJobExecutionsResultDto>(response);

    expect(mocks.workflowHandlers.listWorkflowJobExecutions).toHaveBeenCalledWith({
      workspaceId,
      jobId,
      limit: 100,
    });
    expect(result.job_id).toBe(jobId);
    expect(result.executions).toHaveLength(100);
    expect(result.executions[0]?.name).toHaveLength(512);
    expect(response).toMatchObject({ok: true});
    expect(result.next_cursor).toBeNull();
  });

  test('pages steps and attempts with the canonical parent coordinates', async () => {
    const mocks = clients();
    mocks.workflowHandlers.listWorkflowExecutionSteps.mockResolvedValue({
      items: [step()],
      nextCursor: null,
      total: 1,
    });
    mocks.workflowHandlers.listWorkflowStepAttempts.mockResolvedValue({
      items: [stepAttempt()],
      nextCursor: null,
      total: 1,
      stepType: 'run',
    });

    const stepsResponse = await tool(mocks, 'list_workflow_execution_steps').execute({
      context,
      arguments: {job_id: jobId, execution_id: executionId},
    });
    const steps = expectSuccess<ListWorkflowExecutionStepsResultDto>(stepsResponse);
    expect(mocks.workflowHandlers.listWorkflowExecutionSteps).toHaveBeenCalledWith({
      workspaceId,
      jobId,
      executionId,
      limit: 100,
    });
    expect(steps).toMatchObject({
      job_id: jobId,
      execution_id: executionId,
      steps: [{id: stepId}],
    });
    expect(steps.steps[0]).not.toHaveProperty('attempts');
    expect(steps.steps[0]).not.toHaveProperty('source_location');

    const attemptsResponse = await tool(mocks, 'list_workflow_step_attempts').execute({
      context,
      arguments: {step_id: stepId},
    });
    const attempts = expectSuccess<ListWorkflowStepAttemptsResultDto>(attemptsResponse);
    expect(mocks.workflowHandlers.listWorkflowStepAttempts).toHaveBeenCalledWith({
      workspaceId,
      stepId,
      limit: 25,
    });
    expect(attempts).toMatchObject({step_id: stepId, attempts: [{id: attemptId, attempt: 1}]});
    expect(attempts.attempts[0]).not.toHaveProperty('error');
    expect(attempts.attempts[0]).not.toHaveProperty('gate_result');
  });

  test('forwards valid cursors through every workflow traversal page', async () => {
    const mocks = clients();
    const numberCursor = encodeNumberIdCursor({value: 1, id: attemptId});
    const positionCursor = encodeStringIdCursor({value: '0', id: jobId});
    mocks.workflowHandlers.listWorkflowRunAttempts.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    mocks.workflowHandlers.listWorkflowRunJobs.mockResolvedValue({
      workflow_run_attempt: 2,
      items: [],
      nextCursor: null,
    });
    mocks.workflowHandlers.listWorkflowJobExecutions.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    mocks.workflowHandlers.listWorkflowExecutionSteps.mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    mocks.workflowHandlers.listWorkflowStepAttempts.mockResolvedValue({
      items: [],
      nextCursor: null,
      stepType: 'run',
    });

    await tool(mocks, 'list_workflow_run_attempts').execute({
      context,
      arguments: {run_id: runId, cursor: numberCursor},
    });
    await tool(mocks, 'list_workflow_run_jobs').execute({
      context,
      arguments: {run_id: runId, attempt: 2, cursor: positionCursor},
    });
    await tool(mocks, 'list_workflow_job_executions').execute({
      context,
      arguments: {job_id: jobId, cursor: numberCursor},
    });
    await tool(mocks, 'list_workflow_execution_steps').execute({
      context,
      arguments: {job_id: jobId, execution_id: executionId, cursor: positionCursor},
    });
    await tool(mocks, 'list_workflow_step_attempts').execute({
      context,
      arguments: {step_id: stepId, cursor: numberCursor},
    });

    expect(mocks.workflowHandlers.listWorkflowRunAttempts).toHaveBeenCalledWith(
      expect.objectContaining({cursor: numberCursor}),
    );
    expect(mocks.workflowHandlers.listWorkflowRunJobs).toHaveBeenCalledWith(
      expect.objectContaining({cursor: positionCursor}),
    );
    expect(mocks.workflowHandlers.listWorkflowJobExecutions).toHaveBeenCalledWith(
      expect.objectContaining({cursor: numberCursor}),
    );
    expect(mocks.workflowHandlers.listWorkflowExecutionSteps).toHaveBeenCalledWith(
      expect.objectContaining({cursor: positionCursor}),
    );
    expect(mocks.workflowHandlers.listWorkflowStepAttempts).toHaveBeenCalledWith(
      expect.objectContaining({cursor: numberCursor}),
    );
  });

  test('turns inaccessible or malformed traversal reads into bounded tool errors', async () => {
    const mocks = clients();
    mocks.workflowHandlers.listWorkflowRunJobs.mockResolvedValue(null);

    const missing = await tool(mocks, 'list_workflow_run_jobs').execute({
      context,
      arguments: {run_id: runId, attempt: 2},
    });
    expect(missing).toEqual({ok: false, error: {code: 'not-found'}});

    const invalid = await tool(mocks, 'list_workflow_run_jobs').execute({
      context,
      arguments: {run_id: runId, attempt: 2, cursor: 'not-a-cursor'},
    });
    expect(invalid).toEqual({ok: false, error: {code: 'invalid-request'}});
    expect(mocks.workflowHandlers.listWorkflowRunJobs).toHaveBeenCalledTimes(1);
  });
});

function clients() {
  const {workflows, handlers: workflowHandlers} = createTestWorkflowsClient();
  return {
    projects: {
      listProjectCatalogByWorkspace: vi.fn(),
      requireProjectForWorkspace: vi.fn(),
    },
    definitions: {listDefinitionsByProject: vi.fn()},
    workflows,
    workflowHandlers,
    annotations: {listAnnotationsForRunAttempt: vi.fn()},
    triggers: {listTriggerEvents: vi.fn()},
  } as unknown as Parameters<typeof createAgentAccessTools>[0] & {
    workflowHandlers: typeof workflowHandlers;
  };
}

function tool(mocks: ReturnType<typeof clients>, name: string) {
  const candidate = createAgentAccessTools(mocks).find((entry) => entry.name === name);
  if (!candidate) throw new Error(`Missing tool ${name}`);
  return candidate;
}

function expectSuccess<T>(response: AgentAccessEnvelopeDto): T {
  expect(response.ok).toBe(true);
  if (!response.ok) throw new Error('Expected a successful tool response');
  expect(agentAccessEnvelopeSchema.safeParse(response).success).toBe(true);
  return response.result as T;
}

function overview(attempt = 2): WorkflowRunOverviewResponseDto {
  return {
    run: {
      id: runId,
      project_id: projectId,
      definition_id: definitionId,
      number: 1,
      name: 'Run',
      workflow_name: 'Workflow',
      origin: 'synced',
      dev_source: null,
      trigger_provider: 'github',
      trigger_source: 'push',
      trigger_event: 'push',
      trigger_reference: {repository: 'shipfox/platform', ref: 'main', commit: 'abc', actor: 'noe'},
      created_at: isoDate,
    },
    attempt: runAttempt(attempt),
    has_started_job_execution: true,
    jobs: {
      kind: 'complete',
      total: 2,
      items: [job(), {...job(), id: uuid(11), status: 'succeeded', default_execution: null}],
    },
  };
}

function runAttempt(attempt: number) {
  return {
    id: attempt === 2 ? attemptId : uuid(12),
    workflow_run_id: runId,
    attempt,
    status: attempt === 2 ? ('failed' as const) : ('succeeded' as const),
    created_at: isoDate,
    started_at: isoDate,
    finished_at: isoDate,
    rerun_mode: null,
  };
}

function job(): WorkflowRunJobOverviewDto {
  return {
    id: jobId,
    key: 'build',
    name: 'Build',
    position: 0,
    dependencies: [],
    status: 'failed',
    status_reason: 'step_failed',
    mode: 'one_shot',
    listener_status: 'inactive',
    carried_over: false,
    execution_count: 1,
    execution_status_counts: {pending: 0, running: 0, succeeded: 0, failed: 1, cancelled: 0},
    default_execution: execution(executionId),
  };
}

function execution(id: string, sequence = 1, name = 'Build execution'): JobExecutionSummaryDto {
  return {
    id,
    sequence,
    name,
    status: 'failed',
    display_status: 'failed',
    status_reason: 'step_failed',
    status_reason_message: 'The step failed',
    queued_at: isoDate,
    started_at: isoDate,
    finished_at: isoDate,
    timed_out_at: null,
    updated_at: isoDate,
  };
}

function jobDetail(): WorkflowJobDetailDto {
  return {
    workflow_run_id: runId,
    workflow_run_attempt: 2,
    job: job(),
    selected_execution: {
      ...execution(executionId),
      has_context: true,
      steps: {items: [step()], next_cursor: null, total: 1},
    },
  };
}

function step(): StepSummaryDto {
  return {
    id: stepId,
    key: 'run',
    name: 'Run command',
    type: 'run',
    position: 0,
    status: 'failed',
    status_reason: null,
    source_location: {start_line: 1, end_line: 2},
    current_attempt: 1,
    error: {message: 'do not expose'},
    attempts: {items: [stepAttempt()], next_cursor: null, total: 1},
  };
}

function stepAttempt(): StepAttemptSummaryDto {
  return {
    id: attemptId,
    attempt: 1,
    execution_order: 1,
    status: 'failed',
    exit_code: 1,
    started_at: isoDate,
    finished_at: isoDate,
    error: {message: 'do not expose'},
    gate_result: {kind: 'none'},
  };
}

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}
