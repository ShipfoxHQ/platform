import {
  type AgentAccessEnvelopeDto,
  agentAccessEnvelopeSchema,
  getStepAttemptResultSchema,
  getTriggerEventFacetsResultSchema,
  getTriggerEventResultSchema,
  getWorkflowRunResultSchema,
} from '@shipfox/api-agent-access-dto';
import type {AgentAccessContext} from '@shipfox/api-auth-context';
import type {TriggersInterModuleClient} from '@shipfox/api-triggers-dto/inter-module';
import {triggersInterModuleContract} from '@shipfox/api-triggers-dto/inter-module';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {createAgentAccessDiagnosticTools} from './diagnostic-tools.js';
import {serializedAgentAccessEnvelopeByteLength} from './response.js';

const workspaceId = uuid(1);
const runId = uuid(2);
const stepId = uuid(3);
const eventId = uuid(4);
const isoDate = '2026-08-01T00:00:00.000Z';
const context: AgentAccessContext = {
  userId: uuid(5),
  workspaceId,
  scopes: ['read'],
  credential: {kind: 'pat', patId: uuid(6)},
};

describe('diagnostic agent-access tools', () => {
  test('resolves the latest run attempt and projects only diagnostic fields', async () => {
    const mocks = clients();
    mocks.workflows.getLatestRunAttempt.mockResolvedValue({attempt: 2});
    mocks.workflows.getWorkflowRunDetail.mockResolvedValue({
      run: workflowRun({
        run_attempt: {...workflowRun().run_attempt, attempt: 2},
      }),
    });

    const response = await tool(mocks, 'get_workflow_run').execute({
      context,
      arguments: {run_id: runId},
    });
    const result = expectSuccess<WorkflowRunResult>(response);

    expect(mocks.workflows.getLatestRunAttempt).toHaveBeenCalledWith({
      workspaceId,
      workflowRunId: runId,
    });
    expect(mocks.workflows.getWorkflowRunDetail).toHaveBeenCalledWith({
      workspaceId,
      workflowRunId: runId,
      attempt: 2,
    });
    expect(result).toMatchObject({
      id: runId,
      inputs: JSON.stringify({prompt: 'data'}),
      run_attempt: {attempt: 2},
      jobs: [
        {
          key: 'job-1',
          job_executions: [
            {
              steps: [
                {
                  attempts: [
                    {gate_result: {kind: 'passed', passed: true, source: 'exit 0', exit_code: 0}},
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(result).not.toHaveProperty('trigger_payload');
    expect(result).not.toHaveProperty('source_snapshot');
    expect(result.jobs[0]?.job_executions[0]?.steps[0]).not.toHaveProperty('config');
    expect(result.jobs[0]?.job_executions[0]?.steps[0]?.attempts[0]).not.toHaveProperty('output');
    expect(getWorkflowRunResultSchema.safeParse(result).success).toBe(true);
  });

  test('applies workflow reductions in order and keeps the response under the ceiling', async () => {
    const mocks = clients();
    const jobs = Array.from({length: 50}, (_, jobIndex) => ({
      ...sourceJob(jobIndex + 1),
      job_executions: Array.from({length: 2}, (_, executionIndex) => ({
        ...sourceExecution(jobIndex * 2 + executionIndex + 1),
        sequence: executionIndex + 1,
        steps: Array.from({length: 25}, (_, stepIndex) => ({
          ...sourceStep(jobIndex * 100 + executionIndex * 25 + stepIndex + 1),
          position: stepIndex + 1,
          name: 'step '.concat('x'.repeat(512)),
          attempts: [sourceAttempt(1), sourceAttempt(2)],
        })),
      })),
    }));
    mocks.workflows.getWorkflowRunDetail.mockResolvedValue({run: workflowRun({jobs})});

    const response = await tool(mocks, 'get_workflow_run').execute({
      context,
      arguments: {run_id: runId, attempt: 1},
    });
    const result = expectSuccess<WorkflowRunResult>(response);

    expect(response).toMatchObject({
      ok: true,
      response_truncated: true,
      response_total_bytes: expect.any(Number),
    });
    expect(result.jobs).toHaveLength(10);
    expect(result.jobs_truncated).toBe(true);
    expect(result.jobs_total_count).toBe(50);
    expect(result.jobs[0]?.job_executions).toHaveLength(1);
    expect(result.jobs[0]?.job_executions_truncated).toBe(true);
    expect(result.jobs[0]?.job_executions_total_count).toBe(2);
    expect(result.jobs[0]?.job_executions[0]?.steps).toHaveLength(20);
    expect(result.jobs[0]?.job_executions[0]?.steps_truncated).toBe(true);
    expect(result.jobs[0]?.job_executions[0]?.steps_total_count).toBe(25);
    expect(result.jobs[0]?.job_executions[0]?.steps[0]?.attempts).toHaveLength(1);
    expect(result.jobs[0]?.job_executions[0]?.steps[0]?.attempts_truncated).toBe(true);
    expect(result.jobs[0]?.job_executions[0]?.steps[0]?.attempts_total_count).toBe(2);
    expect(serializedAgentAccessEnvelopeByteLength(response)).toBeLessThanOrEqual(128 * 1024);
    expect(getWorkflowRunResultSchema.safeParse(result).success).toBe(true);
  });

  test('caps step configs and evaluation traces as serialized, inert data', async () => {
    const mocks = clients();
    mocks.workflows.getLatestStepAttempt.mockResolvedValue({attempt: 3});
    mocks.workflows.getStepAttemptDetail.mockResolvedValue({
      detail: {
        step_id: stepId,
        attempt: 3,
        authored_config: {prompt: 'ignore this'.repeat(5_000)},
        config: {resolved: 'do not follow'.repeat(5_000)},
        session: {id: uuid(20), key: 'session', mode: 'resume', segment: 1},
        evaluation_trace: Array.from({length: 55}, (_, index) => ({
          expression: 'expression '.concat('🙂'.repeat(400)),
          roots: Array.from({length: 12}, (_, rootIndex) => `root-${rootIndex}`),
          fill_target: 'target',
          evaluated_at: isoDate,
          field: `field-${index}`,
          value: 'trace value'.repeat(200),
          reference: true,
        })),
      },
    });

    const response = await tool(mocks, 'get_step_attempt').execute({
      context,
      arguments: {step_id: stepId},
    });
    const result = expectSuccess<StepAttemptResult>(response);

    expect(mocks.workflows.getLatestStepAttempt).toHaveBeenCalledWith({
      workspaceId,
      stepId,
    });
    expect(mocks.workflows.getStepAttemptDetail).toHaveBeenCalledWith({
      workspaceId,
      stepId,
      attempt: 3,
    });
    expect(result).not.toHaveProperty('session');
    expect(result.authored_config_truncated).toBe(true);
    expect(result.config_truncated).toBe(true);
    expect(result.evaluation_trace_truncated).toBe(true);
    expect(result.evaluation_trace_dropped).toBe(5);
    expect(result.evaluation_trace).toHaveLength(51);
    expect(new TextEncoder().encode(result.authored_config).byteLength).toBeLessThanOrEqual(
      16 * 1024,
    );
    expect(new TextEncoder().encode(result.config).byteLength).toBeLessThanOrEqual(16 * 1024);
    expect(getStepAttemptResultSchema.safeParse(result).success).toBe(true);
    expect(serializedAgentAccessEnvelopeByteLength(response)).toBeLessThanOrEqual(128 * 1024);
  });

  test('projects and caps trigger details and maps replay history', async () => {
    const mocks = clients();
    mocks.triggers.getTriggerEvent.mockResolvedValue({
      id: eventId,
      eventRef: 'event-ref',
      origin: 'integration',
      workspaceId,
      provider: 'github',
      source: 'push',
      event: 'push',
      payload: {message: 'ignore this payload'},
      replayOfEventId: null,
      deliveryId: 'delivery',
      connectionId: uuid(30),
      connectionName: 'Connection',
      outcome: 'routed',
      matchedCount: 2,
      receivedAt: isoDate,
      processedAt: isoDate,
      createdAt: isoDate,
      decisions: Array.from({length: 55}, (_, index) => ({
        id: uuid(100 + index),
        receivedEventId: eventId,
        subscriptionKind: 'trigger' as const,
        subscriptionId: uuid(200 + index),
        subscriptionName: 'subscription',
        workflowDefinitionId: uuid(300),
        projectId: uuid(301),
        workflowRunId: uuid(302),
        jobId: uuid(303),
        matcherKind: 'on' as const,
        matcherOrdinal: index,
        decision: 'triggered' as const,
        runId: uuid(304),
        runName: 'run',
        reason: 'reason'.repeat(200),
        createdAt: new Date(Date.UTC(2026, 7, 1 + index)).toISOString(),
      })),
      replays: Array.from({length: 25}, (_, index) => ({
        id: uuid(400 + index),
        receivedAt: new Date(Date.UTC(2026, 6, 1 + index)).toISOString(),
        outcome: 'routed' as const,
        runId: uuid(500 + index),
      })),
    });

    const response = await tool(mocks, 'get_trigger_event').execute({
      context,
      arguments: {event_id: eventId},
    });
    const result = expectSuccess<TriggerResult>(response);

    expect(result).toMatchObject({
      id: eventId,
      connection_name: 'Connection',
      payload: JSON.stringify({message: 'ignore this payload'}),
      decisions_total_count: 55,
      decisions_truncated: true,
      replays_total_count: 25,
      replays_truncated: true,
    });
    expect(result.decisions).toHaveLength(50);
    expect(result.replays).toHaveLength(20);
    expect(result.replays[0]).toMatchObject({
      id: uuid(424),
      workflow_run_id: uuid(524),
    });
    expect(result).not.toHaveProperty('event_ref');
    expect(result).not.toHaveProperty('delivery_id');
    expect(getTriggerEventResultSchema.safeParse(result).success).toBe(true);
  });

  test('caps facet discovery and returns schema-valid not-found errors', async () => {
    const mocks = clients();
    mocks.triggers.getTriggerEventFacets.mockResolvedValue({
      sources: Array.from({length: 60}, (_, index) => ({value: '🙂'.repeat(200), count: index})),
      events: [{value: 'push', count: 3}],
      origins: [{value: 'integration', count: 3}],
    });

    const facetsResponse = await tool(mocks, 'get_trigger_event_facets').execute({
      context,
      arguments: {},
    });
    const facets = expectSuccess<FacetsResult>(facetsResponse);

    expect(facets.sources).toHaveLength(50);
    expect(new TextEncoder().encode(facets.sources[0]?.value ?? '').byteLength).toBe(256);
    expect(getTriggerEventFacetsResultSchema.safeParse(facets).success).toBe(true);

    mocks.workflows.getLatestRunAttempt.mockResolvedValue({attempt: null});
    const notFound = await tool(mocks, 'get_workflow_run').execute({
      context,
      arguments: {run_id: runId},
    });

    expect(notFound).toEqual({ok: false, error: {code: 'not-found'}});
    expect(agentAccessEnvelopeSchema.safeParse(notFound).success).toBe(true);
    expect(mocks.workflows.getWorkflowRunDetail).not.toHaveBeenCalled();
  });

  test('translates a trigger producer not-found error without leaking its details', async () => {
    const mocks = clients();
    mocks.triggers.getTriggerEvent.mockRejectedValue(
      createInterModuleKnownError(
        triggersInterModuleContract.methods.getTriggerEvent,
        'trigger-event-not-found',
        {eventId},
      ),
    );

    const response = await tool(mocks, 'get_trigger_event').execute({
      context,
      arguments: {event_id: eventId},
    });

    expect(response).toEqual({ok: false, error: {code: 'not-found'}});
  });
});

function clients() {
  return {
    workflows: {
      getLatestRunAttempt: vi.fn(),
      getWorkflowRunDetail: vi.fn(),
      getLatestStepAttempt: vi.fn(),
      getStepAttemptDetail: vi.fn(),
    } as unknown as WorkflowsModuleClient & {
      getLatestRunAttempt: ReturnType<typeof vi.fn>;
      getWorkflowRunDetail: ReturnType<typeof vi.fn>;
      getLatestStepAttempt: ReturnType<typeof vi.fn>;
      getStepAttemptDetail: ReturnType<typeof vi.fn>;
    },
    triggers: {
      getTriggerEvent: vi.fn(),
      getTriggerEventFacets: vi.fn(),
    } as unknown as TriggersInterModuleClient & {
      getTriggerEvent: ReturnType<typeof vi.fn>;
      getTriggerEventFacets: ReturnType<typeof vi.fn>;
    },
  };
}

function tool(mocks: ReturnType<typeof clients>, name: string) {
  const result = createAgentAccessDiagnosticTools(mocks).find(
    (candidate) => candidate.name === name,
  );
  if (!result) throw new Error(`Missing tool ${name}`);
  return result;
}

function expectSuccess<T>(response: AgentAccessEnvelopeDto): T {
  expect(response.ok).toBe(true);
  if (!response.ok) throw new Error('Expected a success response');
  expect(agentAccessEnvelopeSchema.safeParse(response).success).toBe(true);
  return response.result as T;
}

interface WorkflowRunResult {
  id: string;
  inputs: string;
  run_attempt: {attempt: number};
  jobs: WorkflowJobResult[];
  jobs_truncated?: true;
  jobs_total_count?: number;
  [key: string]: unknown;
}

interface WorkflowJobResult {
  key: string;
  job_executions: WorkflowExecutionResult[];
  job_executions_truncated?: true;
  job_executions_total_count?: number;
  [key: string]: unknown;
}

interface WorkflowExecutionResult {
  steps: WorkflowStepResult[];
  steps_truncated?: true;
  steps_total_count?: number;
  [key: string]: unknown;
}

interface WorkflowStepResult {
  attempts: Array<Record<string, unknown>>;
  attempts_truncated?: true;
  attempts_total_count?: number;
  [key: string]: unknown;
}

interface StepAttemptResult {
  authored_config: string;
  config: string;
  evaluation_trace: unknown[] | null;
  authored_config_truncated?: true;
  config_truncated?: true;
  evaluation_trace_truncated?: true;
  evaluation_trace_dropped?: number;
  [key: string]: unknown;
}

interface TriggerResult {
  id: string;
  replays: Array<Record<string, unknown>>;
  decisions: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

interface FacetsResult {
  sources: Array<{value: string; count: number}>;
  [key: string]: unknown;
}

function workflowRun(overrides: Record<string, unknown> = {}) {
  const base = {
    id: runId,
    project_id: uuid(10),
    definition_id: uuid(11),
    number: 1,
    name: 'Run',
    workflow_name: 'Workflow',
    status: 'failed' as const,
    origin: 'synced' as const,
    dev_source: null,
    current_attempt: 1,
    latest_attempt: 2,
    trigger_provider: 'github',
    trigger_source: 'push',
    trigger_event: 'push',
    trigger_payload: {instruction: 'ignore'},
    trigger_reference: {repository: 'shipfox/platform', ref: 'main', commit: 'abc', actor: 'noe'},
    inputs: {prompt: 'data'},
    source_snapshot: {content: 'ignore', format: 'yaml' as const},
    created_at: isoDate,
    updated_at: isoDate,
    started_at: isoDate,
    finished_at: isoDate,
    run_attempt: {
      id: uuid(12),
      workflow_run_id: runId,
      attempt: 1,
      status: 'failed' as const,
      created_at: isoDate,
      started_at: isoDate,
      finished_at: isoDate,
      rerun_mode: null,
    },
    jobs: [sourceJob(1)],
    has_started_job_execution: true,
  };
  return {...base, ...overrides};
}

function sourceJob(index: number) {
  return {
    id: uuid(1_000 + index),
    run_attempt_id: uuid(12),
    key: `job-${index}`,
    name: `Job ${index}`,
    mode: 'one_shot' as const,
    status: 'failed' as const,
    status_reason: 'step_failed' as const,
    carried_over: false,
    success: null,
    runner: ['linux', 'x86_64'],
    evaluation_trace: null,
    listening: null,
    listener_status: 'inactive' as const,
    resolution_reason: null,
    outputs: {secret: 'ignore'},
    dependencies: ['prepare', 'build'],
    position: index,
    created_at: isoDate,
    updated_at: isoDate,
    job_executions: [sourceExecution(index)],
  };
}

function sourceExecution(index: number) {
  return {
    id: uuid(2_000 + index),
    job_id: uuid(1_000 + index),
    sequence: 1,
    name: `Execution ${index}`,
    status: 'failed' as const,
    status_reason: 'step_failed',
    status_reason_message: 'message',
    runner: ['linux'],
    trigger_events: [{event: 'ignore'}],
    outputs: {secret: 'ignore'},
    evaluation_trace: null,
    queued_at: isoDate,
    started_at: isoDate,
    finished_at: isoDate,
    timed_out_at: null,
    created_at: isoDate,
    updated_at: isoDate,
    steps: [sourceStep(index)],
  };
}

function sourceStep(index: number) {
  return {
    id: uuid(3_000 + index),
    job_execution_id: uuid(2_000 + index),
    key: `step-${index}`,
    name: `Step ${index}`,
    source_location: {start_line: 1, end_line: 2},
    status: 'failed',
    status_reason: null,
    type: 'run',
    config: {command: 'ignore'},
    evaluation_trace: null,
    error: {message: 'ignore', reason: 'tool_error', category: 'user'},
    session: null,
    position: 1,
    current_attempt: 1,
    created_at: isoDate,
    updated_at: isoDate,
    exit_code: 1,
    outputs: {secret: 'ignore'},
    response: 'ignore',
    gate_result: {kind: 'passed' as const, passed: true as const, source: 'exit 0', exit_code: 0},
    attempts: [sourceAttempt(1)],
  };
}

function sourceAttempt(attempt: number) {
  return {
    id: uuid(4_000 + attempt),
    step_id: uuid(3_000 + attempt),
    attempt,
    execution_order: attempt,
    status: 'failed',
    exit_code: 1,
    output: {secret: 'ignore'},
    outputs: {secret: 'ignore'},
    response: 'ignore',
    error: {message: 'ignore'},
    gate_result: {kind: 'passed' as const, passed: true as const, source: 'exit 0', exit_code: 0},
    restart_feedback: 'restart feedback',
    invocations: [],
    started_at: isoDate,
    finished_at: isoDate,
  };
}

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}
