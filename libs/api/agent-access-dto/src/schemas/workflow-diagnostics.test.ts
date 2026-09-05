import {agentAccessOutputSchema} from './envelope.js';
import {AGENT_ACCESS_PAGE_LIMIT_MAX} from './paged-tools.js';
import {
  AGENT_ACCESS_WORKFLOW_SOURCE_MAX_BYTES,
  getStepAttemptResultJsonSchema,
  getStepAttemptResultSchema,
  getWorkflowExecutionContextResultJsonSchema,
  getWorkflowExecutionContextResultSchema,
  getWorkflowRunSourceInputJsonSchema,
  getWorkflowRunSourceInputSchema,
  getWorkflowRunSourceResultJsonSchema,
  getWorkflowRunSourceResultSchema,
  listWorkflowRunJobExplanationsResultJsonSchema,
  listWorkflowRunJobExplanationsResultSchema,
} from './workflow-diagnostics.js';
import {AGENT_ACCESS_WORKFLOW_ATTEMPT_MAX} from './workflow-tools.js';

const runId = '00000000-0000-4000-8000-000000000001';
const jobId = '00000000-0000-4000-8000-000000000002';
const executionId = '00000000-0000-4000-8000-000000000003';
const stepId = '00000000-0000-4000-8000-000000000004';
const stepAttemptId = '00000000-0000-4000-8000-000000000005';
const projectId = '00000000-0000-4000-8000-000000000006';
const deliveryId = '00000000-0000-4000-8000-000000000007';
const isoDate = '2026-08-01T00:00:00.000Z';

describe('workflow diagnostic Agent Access schemas', () => {
  test('allows the latest run source attempt to be resolved when omitted', () => {
    expect(getWorkflowRunSourceInputSchema.safeParse({run_id: runId}).success).toBe(true);
    expect(getWorkflowRunSourceInputJsonSchema.required).toEqual(['run_id']);
  });

  test('accepts canonical source, context, step, and explanation values', () => {
    expect(getWorkflowRunSourceResultSchema.safeParse(sourceAvailable()).success).toBe(true);
    expect(getWorkflowRunSourceResultSchema.safeParse(sourceUnavailable()).success).toBe(true);
    expect(getWorkflowExecutionContextResultSchema.safeParse(contextResult()).success).toBe(true);
    expect(getStepAttemptResultSchema.safeParse(stepResult()).success).toBe(true);
    expect(listWorkflowRunJobExplanationsResultSchema.safeParse(explanationsResult()).success).toBe(
      true,
    );
  });

  test('keeps source availability branches distinct in the JSON schema mirror', () => {
    const branches = getWorkflowRunSourceResultJsonSchema.oneOf;
    expect(branches).toHaveLength(2);
    expect(branches[0]).toMatchObject({
      properties: {kind: {const: 'available'}},
      required: expect.arrayContaining(['source_snapshot']),
    });
    expect(branches[1]).toMatchObject({
      properties: {kind: {const: 'unavailable'}},
      required: expect.arrayContaining(['reason']),
    });

    expect(
      getWorkflowRunSourceResultSchema.safeParse({
        ...sourceAvailable(),
        reason: 'temporary_run',
      }).success,
    ).toBe(false);
    expect(
      getWorkflowRunSourceResultSchema.safeParse({
        ...sourceUnavailable(),
        source_snapshot: {content: 'name: build', format: 'yaml'},
      }).success,
    ).toBe(false);
  });

  test('mirrors collection, truncation, and response-field bounds in tool schemas', () => {
    const envelopes = [
      agentAccessOutputSchema(getWorkflowRunSourceResultJsonSchema),
      agentAccessOutputSchema(getWorkflowExecutionContextResultJsonSchema),
      agentAccessOutputSchema(getStepAttemptResultJsonSchema),
      agentAccessOutputSchema(listWorkflowRunJobExplanationsResultJsonSchema),
    ];
    for (const envelope of envelopes) {
      expect(envelope.type).toBe('object');
      expect(envelope).not.toHaveProperty('oneOf');
    }

    expect(getWorkflowRunSourceResultJsonSchema.properties.workflow_run_attempt).toMatchObject({
      maximum: AGENT_ACCESS_WORKFLOW_ATTEMPT_MAX,
    });
    expect(getWorkflowRunSourceResultJsonSchema.properties.source_snapshot).toMatchObject({
      properties: {content: {maxLength: AGENT_ACCESS_WORKFLOW_SOURCE_MAX_BYTES}},
    });
    expect(getWorkflowRunSourceResultJsonSchema.properties.reason).toMatchObject({
      enum: ['temporary_run', 'pre_snapshot_run', 'legacy_snapshot_too_large'],
    });

    expect(getStepAttemptResultJsonSchema.properties.error.anyOf[0]).toMatchObject({
      properties: {
        reason: {
          enum: [
            'checkout_failed',
            'checkout_auth_failed',
            'checkout_unavailable',
            'checkout_path_invalid',
            'checkout_destination_occupied',
            'git_unavailable',
            'workspace_prep_failed',
            'setup_aborted',
            'config_unresolvable',
            'output_invalid',
            'agent_config_invalid',
            'agent_invocation_failed',
            'agent_harness_unavailable',
            'agent_inference_credentials_unavailable',
            'agent_session_key_invalid',
            'agent_session_held',
            'agent_session_harness_mismatch',
            'agent_session_unavailable',
            'execution_payload_too_large',
            'step_result_too_large',
            'diagnostic_too_large',
            'tool_error',
            'tool_config_invalid',
            'invocation_interrupted',
          ],
        },
        agent_config_issue: {
          enum: [
            'step_config_invalid',
            'provider_not_configured',
            'provider_unsupported',
            'model_unavailable',
            'credentials_invalid',
          ],
        },
        category: {enum: ['setup', 'user']},
      },
    });
    expect(getStepAttemptResultJsonSchema.properties.gate_result.anyOf[0]).toMatchObject({
      properties: {
        kind: {
          enum: [
            'none',
            'not_evaluated',
            'passed',
            'failed',
            'uncheckable',
            'evaluation_error',
            'unknown',
          ],
        },
      },
    });
    expect(
      listWorkflowRunJobExplanationsResultJsonSchema.properties.explanations.items.properties
        .status,
    ).toMatchObject({enum: ['failed', 'skipped']});
    expect(
      getWorkflowExecutionContextResultJsonSchema.properties.oversized_fields.items.properties
        .reason,
    ).toMatchObject({
      enum: [
        'legacy_value_exceeds_inline_limit',
        'value_exceeds_inline_limit',
        'value_truncated_at_write_limit',
      ],
    });

    expect(getWorkflowExecutionContextResultJsonSchema.properties.trigger_events).toMatchObject({
      type: 'array',
      maxItems: AGENT_ACCESS_PAGE_LIMIT_MAX,
    });
    expect(getWorkflowExecutionContextResultJsonSchema.properties.trigger_events_truncated).toEqual(
      {const: true},
    );
    expect(getWorkflowExecutionContextResultJsonSchema.properties.condition_truncated).toEqual({
      const: true,
    });

    expect(getStepAttemptResultJsonSchema.properties.response_text_truncated).toEqual({
      const: true,
    });
    expect(getStepAttemptResultJsonSchema.properties.restart_feedback_truncated).toEqual({
      const: true,
    });
    expect(listWorkflowRunJobExplanationsResultJsonSchema.properties.explanations).toMatchObject({
      type: 'array',
      maxItems: AGENT_ACCESS_PAGE_LIMIT_MAX,
    });
  });
});

function sourceAvailable() {
  return {
    kind: 'available' as const,
    workflow_run_id: runId,
    workflow_run_attempt: 1,
    source_snapshot: {content: 'name: build', format: 'yaml' as const},
  };
}

function sourceUnavailable() {
  return {
    kind: 'unavailable' as const,
    workflow_run_id: runId,
    workflow_run_attempt: 1,
    reason: 'pre_snapshot_run' as const,
  };
}

function contextResult() {
  return {
    workflow_run_id: runId,
    workflow_run_attempt: 1,
    job_id: jobId,
    job_execution_id: executionId,
    job_runner: ['runner-a'],
    execution_runner: null,
    job_outputs: {closed: {status: 'succeeded'}},
    execution_outputs: {mapped: [{id: 1}]},
    trigger_events: [
      {
        source: 'github',
        event: 'push',
        delivery_id: deliveryId,
        received_at: isoDate,
        project: {id: projectId},
        repository: 'shipfox/app',
        ref: 'refs/heads/main',
        commit: 'abc123',
        data: {message: 'external data'},
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
  };
}

function stepResult() {
  return {
    workflow_run_id: runId,
    workflow_run_attempt: 1,
    job_id: jobId,
    job_execution_id: executionId,
    step_id: stepId,
    step_attempt_id: stepAttemptId,
    attempt: 1,
    authored_config: {prompt: 'external data'},
    config: null,
    session: null,
    evaluation_trace: null,
    output: {value: 1},
    outputs: {answer: 42},
    response: 'done',
    error: {message: 'tool failed', reason: 'tool_error' as const, category: 'user' as const},
    gate_result: {kind: 'passed' as const, passed: true, source: 'test', exit_code: 0},
    invocations: [{call_index: 0, started_at: isoDate}],
    restart_feedback: null,
    oversized_fields: [],
  };
}

function explanationsResult() {
  return {
    workflow_run_id: runId,
    workflow_run_attempt: 1,
    explanations: [
      {
        job_id: jobId,
        job_label: 'Build',
        job_position: 0,
        status: 'failed' as const,
        status_reason: 'condition_errored',
        evaluation_trace: null,
      },
    ],
    next_cursor: null,
  };
}
