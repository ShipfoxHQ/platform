import {
  AGENT_ACCESS_WORKFLOW_EXECUTION_PAGE_LIMIT,
  AGENT_ACCESS_WORKFLOW_JOB_PAGE_LIMIT,
  AGENT_ACCESS_WORKFLOW_RUN_ATTEMPT_PAGE_LIMIT,
  AGENT_ACCESS_WORKFLOW_STEP_ATTEMPT_PAGE_LIMIT,
  AGENT_ACCESS_WORKFLOW_STEP_PAGE_LIMIT,
  getWorkflowJobInputSchema,
  getWorkflowJobResultJsonSchema,
  getWorkflowJobResultSchema,
  getWorkflowRunInputSchema,
  getWorkflowRunResultJsonSchema,
  getWorkflowRunResultSchema,
  listWorkflowExecutionStepsInputSchema,
  listWorkflowExecutionStepsResultJsonSchema,
  listWorkflowExecutionStepsResultSchema,
  listWorkflowJobExecutionsInputSchema,
  listWorkflowJobExecutionsResultJsonSchema,
  listWorkflowRunAttemptsInputSchema,
  listWorkflowRunAttemptsResultJsonSchema,
  listWorkflowRunJobsInputSchema,
  listWorkflowRunJobsResultJsonSchema,
  listWorkflowStepAttemptsInputSchema,
  listWorkflowStepAttemptsResultJsonSchema,
} from './workflow-tools.js';

const runId = '00000000-0000-4000-8000-000000000001';
const jobId = '00000000-0000-4000-8000-000000000002';
const executionId = '00000000-0000-4000-8000-000000000003';
const stepId = '00000000-0000-4000-8000-000000000004';
const isoDate = '2026-08-01T00:00:00.000Z';

describe('workflow agent-access schemas', () => {
  test('uses producer page defaults and keeps workspace implicit', () => {
    expect(listWorkflowRunAttemptsInputSchema.parse({run_id: runId}).limit).toBe(
      AGENT_ACCESS_WORKFLOW_RUN_ATTEMPT_PAGE_LIMIT,
    );
    expect(listWorkflowRunJobsInputSchema.parse({run_id: runId, attempt: 2}).limit).toBe(
      AGENT_ACCESS_WORKFLOW_JOB_PAGE_LIMIT,
    );
    expect(listWorkflowJobExecutionsInputSchema.parse({job_id: jobId}).limit).toBe(
      AGENT_ACCESS_WORKFLOW_EXECUTION_PAGE_LIMIT,
    );
    expect(
      listWorkflowExecutionStepsInputSchema.parse({job_id: jobId, execution_id: executionId}).limit,
    ).toBe(AGENT_ACCESS_WORKFLOW_STEP_PAGE_LIMIT);
    expect(listWorkflowStepAttemptsInputSchema.parse({step_id: stepId}).limit).toBe(
      AGENT_ACCESS_WORKFLOW_STEP_ATTEMPT_PAGE_LIMIT,
    );
    expect(getWorkflowRunInputSchema.safeParse({run_id: runId, workspace_id: runId}).success).toBe(
      false,
    );
    expect(getWorkflowJobInputSchema.safeParse({job_id: jobId, extra: true}).success).toBe(false);
  });

  test('requires the run attempt when listing jobs', () => {
    expect(listWorkflowRunJobsInputSchema.safeParse({run_id: runId}).success).toBe(false);
    expect(listWorkflowRunJobsInputSchema.safeParse({run_id: runId, attempt: 0}).success).toBe(
      false,
    );
  });

  test('declares one object result schema without embedded traversal children', () => {
    const schemas = [
      getWorkflowRunResultJsonSchema,
      listWorkflowRunAttemptsResultJsonSchema,
      listWorkflowRunJobsResultJsonSchema,
      getWorkflowJobResultJsonSchema,
      listWorkflowJobExecutionsResultJsonSchema,
      listWorkflowExecutionStepsResultJsonSchema,
      listWorkflowStepAttemptsResultJsonSchema,
    ];
    for (const schema of schemas) expect(schema).not.toHaveProperty('oneOf');

    expect(getWorkflowRunResultJsonSchema.properties).not.toHaveProperty('jobs');
    expect(getWorkflowJobResultJsonSchema.properties).toHaveProperty('selected_execution');
    expect(listWorkflowExecutionStepsResultJsonSchema.properties.steps).toBeDefined();
    expect(listWorkflowStepAttemptsResultJsonSchema.properties.attempts).toBeDefined();
  });

  test('rejects diagnostic and child collection fields from traversal results', () => {
    const validRun = runResult();
    expect(getWorkflowRunResultSchema.safeParse(validRun).success).toBe(true);
    expect(getWorkflowRunResultSchema.safeParse({...validRun, jobs: []}).success).toBe(false);

    const validJob = jobResult();
    expect(getWorkflowJobResultSchema.safeParse(validJob).success).toBe(true);
    expect(
      getWorkflowJobResultSchema.safeParse({
        ...validJob,
        job: {...validJob.job, dependencies: []},
      }).success,
    ).toBe(false);

    const validSteps = {
      job_id: jobId,
      execution_id: executionId,
      steps: [stepResult()],
      next_cursor: null,
    };
    expect(listWorkflowExecutionStepsResultSchema.safeParse(validSteps).success).toBe(true);
    expect(
      listWorkflowExecutionStepsResultSchema.safeParse({
        ...validSteps,
        steps: [{...stepResult(), attempts: {items: [], next_cursor: null}}],
      }).success,
    ).toBe(false);
  });
});

function runResult() {
  return {
    id: runId,
    project_id: runId,
    definition_id: jobId,
    number: 1,
    name: 'Run',
    workflow_name: 'Workflow',
    status: 'failed' as const,
    origin: 'synced' as const,
    dev_source: null,
    trigger_provider: 'github',
    trigger_source: 'push',
    trigger_event: 'push',
    trigger_reference: {repository: 'shipfox/platform', ref: 'main', commit: 'abc', actor: 'noe'},
    created_at: isoDate,
    started_at: isoDate,
    finished_at: isoDate,
    attempt: {
      id: executionId,
      workflow_run_id: runId,
      attempt: 1,
      status: 'failed' as const,
      created_at: isoDate,
      started_at: isoDate,
      finished_at: isoDate,
      rerun_mode: null,
    },
    job_status_counts: [{status: 'failed' as const, count: 1}],
    has_started_job_execution: true,
  };
}

function jobResult() {
  return {
    workflow_run_id: runId,
    workflow_run_attempt: 1,
    job: {
      id: jobId,
      key: 'build',
      name: 'Build',
      position: 0,
      status: 'failed' as const,
      status_reason: 'step_failed' as const,
      mode: 'one_shot' as const,
      listener_status: 'inactive' as const,
      carried_over: false,
      execution_count: 1,
      execution_status_counts: {pending: 0, running: 0, succeeded: 0, failed: 1, cancelled: 0},
      default_execution: executionResult(),
    },
    selected_execution: {...executionResult(), has_context: true},
  };
}

function executionResult() {
  return {
    id: executionId,
    sequence: 1,
    name: 'Build execution',
    status: 'failed' as const,
    display_status: 'failed' as const,
    status_reason: 'step_failed' as const,
    status_reason_message: 'The step failed',
    queued_at: isoDate,
    started_at: isoDate,
    finished_at: isoDate,
    timed_out_at: null,
    updated_at: isoDate,
  };
}

function stepResult() {
  return {
    id: stepId,
    key: 'run',
    name: 'Run command',
    type: 'run' as const,
    position: 0,
    status: 'failed' as const,
    status_reason: null,
    current_attempt: 1,
  };
}
