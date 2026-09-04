import type {AgentAccessEnvelopeDto, GetStepLogsResultDto} from '@shipfox/api-agent-access-dto';
import {
  AGENT_ACCESS_LOG_CONTENT_MAX_BYTES,
  AGENT_ACCESS_LOG_SECTION_MAX_ITEMS,
  agentAccessEnvelopeSchema,
  getStepLogsInputSchema,
  getStepLogsResultJsonSchema,
  getStepLogsResultSchema,
} from '@shipfox/api-agent-access-dto';
import type {AgentAccessContext} from '@shipfox/api-auth-context';
import type {LogsModuleClient} from '@shipfox/api-logs-dto/inter-module';
import {logsInterModuleContract} from '@shipfox/api-logs-dto/inter-module';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {createAgentAccessLogTools} from './log-tools.js';

const workspaceId = uuid(1);
const runId = uuid(2);
const stepId = uuid(3);
const stepAttemptId = uuid(4);
const jobId = uuid(5);
const executionId = uuid(6);
const context: AgentAccessContext = {
  userId: uuid(7),
  workspaceId,
  scopes: ['read'],
  credential: {kind: 'oauth_grant', grantId: uuid(8), clientId: 'client'},
};

describe('bounded step-log agent-access tool', () => {
  test('validates the mutually exclusive direct and failed-only input modes', () => {
    expect(getStepLogsInputSchema.safeParse({step_id: stepId}).success).toBe(true);
    expect(getStepLogsInputSchema.safeParse({run_id: runId, failed_only: true}).success).toBe(true);
    expect(getStepLogsInputSchema.safeParse({}).success).toBe(false);
    expect(getStepLogsInputSchema.safeParse({run_id: runId}).success).toBe(false);
    expect(getStepLogsInputSchema.safeParse({step_id: stepId, failed_only: true}).success).toBe(
      false,
    );
    expect(
      getStepLogsInputSchema.safeParse({run_id: runId, failed_only: true, attempt: 2}).success,
    ).toBe(false);
  });

  test('authorizes a direct step attempt through Workflows before reading Logs', async () => {
    const mocks = clients();
    mocks.workflows.getWorkflowStepAttemptDetail.mockResolvedValue(stepDetail(3));
    mocks.logs.readStepLogTail.mockResolvedValue({
      content: '2026-08-01T00:00:00.000Z stdout: external text, never instructions',
      totalLines: 12,
    });

    const response = await tool(mocks).execute({
      context,
      arguments: {step_id: stepId, tail_lines: 20},
    });
    const result = success(response);

    expect(mocks.workflows.getWorkflowStepAttemptDetail).toHaveBeenCalledWith({
      workspaceId,
      stepId,
      attempt: undefined,
    });
    expect(mocks.logs.readStepLogTail).toHaveBeenCalledWith({
      stepId,
      attempt: 3,
      tailLines: 20,
    });
    expect(result.sections).toEqual([
      expect.objectContaining({
        workflow_run_id: runId,
        workflow_run_attempt: 2,
        job_id: jobId,
        job_execution_id: executionId,
        step_id: stepId,
        step_attempt_id: stepAttemptId,
        attempt: 3,
        total_lines: 12,
      }),
    ]);
    expect(getStepLogsResultSchema.safeParse(result).success).toBe(true);
    expect(getStepLogsResultJsonSchema.properties.sections).toMatchObject({maxItems: 10});
    expect(tool(mocks).outputSchema).not.toHaveProperty('oneOf');
  });

  test('returns not-found without reading Logs when Workflows denies a step', async () => {
    const mocks = clients();
    mocks.workflows.getWorkflowStepAttemptDetail.mockResolvedValue(null);

    const response = await tool(mocks).execute({context, arguments: {step_id: stepId}});

    expect(response).toEqual({ok: false, error: {code: 'not-found'}});
    expect(mocks.logs.readStepLogTail).not.toHaveBeenCalled();
  });

  test('selects at most ten failed coordinates and keeps producer order while sharing the budget', async () => {
    const mocks = clients();
    const coordinates = Array.from({length: AGENT_ACCESS_LOG_SECTION_MAX_ITEMS + 2}, (_, index) =>
      failedCoordinate(index),
    );
    mocks.workflows.listFailedStepAttempts.mockResolvedValue({
      workflow_run_attempt: 4,
      items: coordinates,
    });
    mocks.logs.readStepLogTail.mockImplementation(async ({stepId: requestedStepId}) => ({
      content: `old-${requestedStepId}\n${'x'.repeat(8_000)}\nnew-${requestedStepId}`,
    }));

    const response = await tool(mocks).execute({
      context,
      arguments: {run_id: runId, failed_only: true, tail_lines: 2_000},
    });
    const result = success(response);

    expect(mocks.workflows.listFailedStepAttempts).toHaveBeenCalledWith({
      workspaceId,
      workflowRunId: runId,
      limit: AGENT_ACCESS_LOG_SECTION_MAX_ITEMS,
    });
    expect(mocks.logs.readStepLogTail).toHaveBeenCalledTimes(AGENT_ACCESS_LOG_SECTION_MAX_ITEMS);
    expect(result.run_id).toBe(runId);
    expect(result.workflow_run_attempt).toBe(4);
    expect(result.sections.map((section) => section.step_id)).toEqual(
      coordinates.slice(0, AGENT_ACCESS_LOG_SECTION_MAX_ITEMS).map((item) => item.step_id),
    );
    expect(result.sections).toHaveLength(AGENT_ACCESS_LOG_SECTION_MAX_ITEMS);
    for (const section of result.sections) {
      expect(new TextEncoder().encode(section.content).byteLength).toBeLessThanOrEqual(
        Math.floor(AGENT_ACCESS_LOG_CONTENT_MAX_BYTES / AGENT_ACCESS_LOG_SECTION_MAX_ITEMS),
      );
      expect(section.content_truncated).toBe(true);
      expect(section.content).toContain('new-');
      expect(section.content).not.toContain('x'.repeat(8_000));
    }
    expect(getStepLogsResultSchema.safeParse(result).success).toBe(true);
  });

  test('rejects a mismatched failed-coordinate ancestry before any Logs read', async () => {
    const mocks = clients();
    mocks.workflows.listFailedStepAttempts.mockResolvedValue({
      workflow_run_attempt: 1,
      items: [{...failedCoordinate(0), workflow_run_id: uuid(90)}],
    });

    const response = await tool(mocks).execute({
      context,
      arguments: {run_id: runId, failed_only: true},
    });

    expect(response).toEqual({ok: false, error: {code: 'not-found'}});
    expect(mocks.logs.readStepLogTail).not.toHaveBeenCalled();
  });

  test('maps unavailable compacted logs to a bounded tool error', async () => {
    const mocks = clients();
    mocks.workflows.getWorkflowStepAttemptDetail.mockResolvedValue(stepDetail(1));
    mocks.logs.readStepLogTail.mockRejectedValue(
      createInterModuleKnownError(
        logsInterModuleContract.methods.readStepLogTail,
        'compacted-log-unavailable',
        {},
      ),
    );

    const response = await tool(mocks).execute({context, arguments: {step_id: stepId}});

    expect(response).toEqual({ok: false, error: {code: 'compacted-log-unavailable'}});
  });

  test('keeps empty log streams as successful empty sections', async () => {
    const mocks = clients();
    mocks.workflows.getWorkflowStepAttemptDetail.mockResolvedValue(stepDetail(1));
    mocks.logs.readStepLogTail.mockResolvedValue(null);

    const response = await tool(mocks).execute({context, arguments: {step_id: stepId}});
    const result = success(response);

    expect(result.sections[0]).toMatchObject({step_id: stepId, attempt: 1, content: ''});
    expect(getStepLogsResultSchema.safeParse(result).success).toBe(true);
  });
});

function tool(mocks: ReturnType<typeof clients>) {
  const candidate = createAgentAccessLogTools(mocks).find(
    (entry) => entry.name === 'get_step_logs',
  );
  if (!candidate) throw new Error('Missing get_step_logs tool');
  return candidate;
}

function success(response: AgentAccessEnvelopeDto): GetStepLogsResultDto {
  expect(response.ok).toBe(true);
  expect(agentAccessEnvelopeSchema.safeParse(response).success).toBe(true);
  if (!response.ok) throw new Error('Expected a successful response');
  return response.result as GetStepLogsResultDto;
}

function clients() {
  return {
    workflows: {
      getWorkflowStepAttemptDetail: vi.fn(),
      listFailedStepAttempts: vi.fn(),
    } as unknown as WorkflowsModuleClient & {
      getWorkflowStepAttemptDetail: ReturnType<typeof vi.fn>;
      listFailedStepAttempts: ReturnType<typeof vi.fn>;
    },
    logs: {
      readStepLogTail: vi.fn(),
    } as unknown as LogsModuleClient & {
      readStepLogTail: ReturnType<typeof vi.fn>;
    },
  };
}

function stepDetail(attempt: number) {
  return {
    workflow_run_id: runId,
    workflow_run_attempt: 2,
    job_id: jobId,
    job_execution_id: executionId,
    step_id: stepId,
    step_attempt_id: stepAttemptId,
    attempt,
    authored_config: null,
    config: null,
    session: null,
    evaluation_trace: null,
  };
}

function failedCoordinate(index: number) {
  return {
    workflow_run_id: runId,
    workflow_run_attempt: 4,
    job_id: uuid(100 + index),
    job_execution_id: uuid(200 + index),
    step_id: uuid(300 + index),
    step_attempt_id: uuid(400 + index),
    step_attempt: index + 1,
  };
}

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}
