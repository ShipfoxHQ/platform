import type {
  AgentAccessEnvelopeDto,
  GetStepAttemptResultDto,
  GetWorkflowExecutionContextResultDto,
  GetWorkflowRunSourceResultDto,
  ListWorkflowRunJobExplanationsResultDto,
} from '@shipfox/api-agent-access-dto';
import {
  AGENT_ACCESS_RESPONSE_MAX_BYTES,
  AGENT_ACCESS_WORKFLOW_DIAGNOSTIC_VALUE_MAX_BYTES,
  agentAccessEnvelopeSchema,
  getStepAttemptResultSchema,
  getWorkflowExecutionContextResultSchema,
  getWorkflowRunSourceResultSchema,
  listWorkflowRunJobExplanationsResultSchema,
} from '@shipfox/api-agent-access-dto';
import type {AgentAccessContext} from '@shipfox/api-auth-context';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {decodeStringIdCursor, encodeStringIdCursor} from '@shipfox/node-drizzle';
import {createAgentAccessWorkflowDiagnosticTools} from './workflow-diagnostic-tools.js';

const workspaceId = uuid(1);
const runId = uuid(2);
const jobId = uuid(3);
const executionId = uuid(4);
const stepId = uuid(5);
const stepAttemptId = uuid(6);
const projectId = uuid(7);
const isoDate = '2026-08-01T00:00:00.000Z';
const context: AgentAccessContext = {
  userId: uuid(8),
  workspaceId,
  scopes: ['read'],
  credential: {kind: 'oauth_grant', grantId: uuid(9), clientId: 'client-1'},
};

type WorkflowMocks = WorkflowsModuleClient & {
  getWorkflowRunSource: ReturnType<typeof vi.fn>;
  getWorkflowJobExecutionContext: ReturnType<typeof vi.fn>;
  getWorkflowStepAttemptDetail: ReturnType<typeof vi.fn>;
  listWorkflowRunJobExplanations: ReturnType<typeof vi.fn>;
};

function clients(): WorkflowMocks {
  return {
    getWorkflowRunSource: vi.fn(),
    getWorkflowJobExecutionContext: vi.fn(),
    getWorkflowStepAttemptDetail: vi.fn(),
    listWorkflowRunJobExplanations: vi.fn(),
  } as unknown as WorkflowMocks;
}

function tool(workflows: WorkflowMocks, name: string) {
  const result = createAgentAccessWorkflowDiagnosticTools(workflows).find(
    (candidate) => candidate.name === name,
  );
  if (!result) throw new Error(`Missing tool ${name}`);
  return result;
}

function success<T>(response: AgentAccessEnvelopeDto): T {
  expect(response.ok).toBe(true);
  if (!response.ok) throw new Error('Expected a successful response');
  expect(agentAccessEnvelopeSchema.safeParse(response).success).toBe(true);
  return response.result as T;
}

describe('workflow diagnostic agent-access tools', () => {
  test('preserves closed, open, and schema-less values as structured content', async () => {
    const mocks = clients();
    mocks.getWorkflowJobExecutionContext.mockResolvedValue({
      workflow_run_id: runId,
      workflow_run_attempt: 2,
      job_id: jobId,
      job_execution_id: executionId,
      job_runner: ['runner-a'],
      execution_runner: null,
      job_outputs: {
        closed: {status: 'succeeded', count: 2},
        open_map: {nested: {value: true}},
        dynamic: ['value', 3, false, null],
      },
      execution_outputs: {mapped: {items: [{id: 1}, {id: 2}]}},
      trigger_events: [
        {
          source: 'github',
          event: 'push',
          delivery_id: uuid(10),
          received_at: isoDate,
          project: {id: projectId},
          repository: 'shipfox/app',
          ref: 'refs/heads/main',
          commit: 'abc123',
          data: {pull_request: {number: 42}, labels: ['external content']},
        },
      ],
      job_evaluation_trace: [
        {
          expression: 'steps.build.outputs.ok',
          roots: ['steps.build.outputs.ok'],
          fill_target: 'job.condition',
          evaluated_at: isoDate,
          field: 'condition',
          value: 'true',
        },
      ],
      execution_evaluation_trace: null,
      condition: 'steps.build.outputs.ok',
      oversized_fields: [],
    });

    const response = await tool(mocks, 'get_workflow_execution_context').execute({
      context,
      arguments: {job_id: jobId, execution_id: executionId},
    });
    const result = success<GetWorkflowExecutionContextResultDto>(response);

    expect(mocks.getWorkflowJobExecutionContext).toHaveBeenCalledWith({
      workspaceId,
      jobId,
      executionId,
    });
    expect(result.job_outputs).toEqual({
      closed: {status: 'succeeded', count: 2},
      open_map: {nested: {value: true}},
      dynamic: ['value', 3, false, null],
    });
    expect(typeof result.job_outputs).toBe('object');
    expect(result.execution_outputs).toEqual({mapped: {items: [{id: 1}, {id: 2}]}});
    expect(result.trigger_events[0]?.data).toEqual({
      pull_request: {number: 42},
      labels: ['external content'],
    });
    expect(result.job_evaluation_trace?.[0]).toMatchObject({
      expression: 'steps.build.outputs.ok',
      value: 'true',
    });
    expect(getWorkflowExecutionContextResultSchema.safeParse(result).success).toBe(true);
  });

  test('omits an oversized structured value while retaining siblings and a stable descriptor', async () => {
    const mocks = clients();
    mocks.getWorkflowJobExecutionContext.mockResolvedValue({
      workflow_run_id: runId,
      workflow_run_attempt: 1,
      job_id: jobId,
      job_execution_id: executionId,
      job_runner: null,
      execution_runner: ['runner-b'],
      job_outputs: {large: 'x'.repeat(AGENT_ACCESS_WORKFLOW_DIAGNOSTIC_VALUE_MAX_BYTES)},
      execution_outputs: {available: {value: 'kept'}},
      trigger_events: [],
      job_evaluation_trace: null,
      execution_evaluation_trace: null,
      condition: null,
      oversized_fields: [],
    });

    const response = await tool(mocks, 'get_workflow_execution_context').execute({
      context,
      arguments: {job_id: jobId, execution_id: executionId},
    });
    const result = success<GetWorkflowExecutionContextResultDto>(response);

    expect(result.job_outputs).toBeNull();
    expect(result.execution_outputs).toEqual({available: {value: 'kept'}});
    expect(result.oversized_fields).toEqual([
      expect.objectContaining({field: 'job_outputs', reason: 'value_exceeds_inline_limit'}),
    ]);
    expect(result.oversized_fields[0]?.stored_bytes).toBeGreaterThan(
      AGENT_ACCESS_WORKFLOW_DIAGNOSTIC_VALUE_MAX_BYTES,
    );
    expect(getWorkflowExecutionContextResultSchema.safeParse(result).success).toBe(true);
  });

  test('projects step attempt values without stringifying them and carries producer descriptors', async () => {
    const mocks = clients();
    mocks.getWorkflowStepAttemptDetail.mockResolvedValue({
      workflow_run_id: runId,
      workflow_run_attempt: 2,
      job_id: jobId,
      job_execution_id: executionId,
      step_id: stepId,
      step_attempt_id: stepAttemptId,
      attempt: 2,
      authored_config: {prompt: 'external prompt', options: {temperature: 0.2}},
      config: null,
      session: {id: uuid(11), key: 'main', mode: 'resume', segment: 3},
      evaluation_trace: null,
      output: {closed: {kind: 'typed', value: 7}, schema_less: [true, 'value']},
      outputs: {mapped: {answer: 42}},
      response: 'done',
      error: {message: 'tool failed', code: 'tool_error', reason: 'tool_error'},
      gate_result: {kind: 'passed', passed: true, source: 'test -f result', exit_code: 0},
      invocations: [
        {
          call_index: 0,
          started_at: isoDate,
          outcome: 'succeeded',
        },
      ],
      restart_feedback: 'retry once',
      oversized_fields: [
        {field: 'config', stored_bytes: 262_144, reason: 'value_exceeds_inline_limit'},
      ],
    });

    const response = await tool(mocks, 'get_step_attempt').execute({
      context,
      arguments: {step_id: stepId, attempt: 2},
    });
    const result = success<GetStepAttemptResultDto>(response);

    expect(mocks.getWorkflowStepAttemptDetail).toHaveBeenCalledWith({
      workspaceId,
      stepId,
      attempt: 2,
    });
    expect(result.output).toEqual({
      closed: {kind: 'typed', value: 7},
      schema_less: [true, 'value'],
    });
    expect(typeof result.output).toBe('object');
    expect(result.outputs).toEqual({mapped: {answer: 42}});
    expect(result.error).toEqual({
      message: 'tool failed',
      code: 'tool_error',
      reason: 'tool_error',
    });
    expect(result.gate_result).toEqual({
      kind: 'passed',
      passed: true,
      source: 'test -f result',
      exit_code: 0,
    });
    expect(result.config).toBeNull();
    expect(result.oversized_fields).toEqual([
      {field: 'config', stored_bytes: 262_144, reason: 'value_exceeds_inline_limit'},
    ]);
    expect(getStepAttemptResultSchema.safeParse(result).success).toBe(true);
  });

  test('caps source text at a character boundary and records its original byte size', async () => {
    const mocks = clients();
    const source = `name: ${'é'.repeat(20_000)}`;
    mocks.getWorkflowRunSource.mockResolvedValue({
      kind: 'available',
      workflow_run_id: runId,
      workflow_run_attempt: 1,
      source_snapshot: {content: source, format: 'yaml'},
    });

    const response = await tool(mocks, 'get_workflow_run_source').execute({
      context,
      arguments: {run_id: runId, attempt: 1},
    });
    const result = success<GetWorkflowRunSourceResultDto>(response);

    expect(result.kind).toBe('available');
    if (result.kind !== 'available') throw new Error('Expected source');
    expect(result.source_snapshot_truncated).toBe(true);
    expect(result.source_snapshot_total_bytes).toBeGreaterThan(
      AGENT_ACCESS_WORKFLOW_DIAGNOSTIC_VALUE_MAX_BYTES,
    );
    expect(new TextEncoder().encode(result.source_snapshot.content).byteLength).toBeLessThanOrEqual(
      AGENT_ACCESS_WORKFLOW_DIAGNOSTIC_VALUE_MAX_BYTES,
    );
    expect(result.source_snapshot.content.endsWith('�')).toBe(false);
    expect(getWorkflowRunSourceResultSchema.safeParse(result).success).toBe(true);
  });

  test('fits explanation pages and regenerates the cursor from the final retained item', async () => {
    const mocks = clients();
    const traceValue = 'external evaluation text '.repeat(60);
    mocks.listWorkflowRunJobExplanations.mockResolvedValue({
      workflow_run_attempt: 1,
      items: Array.from({length: 100}, (_, index) => ({
        job_id: uuid(100 + index),
        job_label: `job-${index}`,
        job_position: index,
        status: 'failed' as const,
        status_reason: 'condition_errored' as const,
        evaluation_trace: [
          {
            expression: traceValue,
            roots: [traceValue],
            fill_target: traceValue,
            evaluated_at: isoDate,
            field: traceValue,
            value: traceValue,
          },
        ],
      })),
      nextCursor: encodeStringIdCursor({value: '99', id: uuid(199)}),
    });

    const response = await tool(mocks, 'list_workflow_run_job_explanations').execute({
      context,
      arguments: {run_id: runId, attempt: 1, limit: 100},
    });
    const result = success<ListWorkflowRunJobExplanationsResultDto>(response);

    expect(result.explanations.length).toBeLessThan(100);
    expect(response).toMatchObject({ok: true, response_truncated: true});
    expect(response.response_total_bytes).toBeGreaterThan(AGENT_ACCESS_RESPONSE_MAX_BYTES);
    const last = result.explanations.at(-1);
    expect(last).toBeDefined();
    expect(result.next_cursor).toBeDefined();
    expect(decodeStringIdCursor(result.next_cursor ?? undefined)).toEqual({
      value: String(last?.job_position),
      id: last?.job_id,
    });
    expect(listWorkflowRunJobExplanationsResultSchema.safeParse(result).success).toBe(true);
  });

  test('rejects malformed cursors before issuing a producer read', async () => {
    const mocks = clients();

    const response = await tool(mocks, 'list_workflow_run_job_explanations').execute({
      context,
      arguments: {run_id: runId, attempt: 1, cursor: 'not-a-cursor'},
    });

    expect(response).toMatchObject({ok: false, error: {code: 'invalid-request'}});
    expect(mocks.listWorkflowRunJobExplanations).not.toHaveBeenCalled();
  });
});

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
}
