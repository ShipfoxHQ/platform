import {
  WORKFLOW_DIAGNOSTIC_ERROR_MAX_BYTES,
  WORKFLOW_DIAGNOSTIC_RESPONSE_MAX_BYTES,
  WORKFLOW_STEP_CONFIG_INLINE_MAX_BYTES,
} from '@shipfox/api-workflows-dto';
import {diagnosticValueByteLength} from '#core/diagnostics.js';
import type {Step, StepAttempt} from '#core/entities/step.js';
import {fromStepErrorDto, toStepAttemptDetailResponseDto, toStepDto} from './step.js';

function step(overrides: Partial<Step> & {type: string}): Step {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    jobExecutionId: '00000000-0000-0000-0000-0000000000bb',
    key: null,
    name: 'step',
    sourceLocation: null,
    status: 'failed',
    statusReason: null,
    evaluationTrace: null,
    config: {},
    condition: null,
    configPlan: null,
    authoredConfig: null,
    error: null,
    position: 0,
    version: 1,
    currentAttempt: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('fromStepErrorDto', () => {
  it('persists the machine-readable reason in camelCase', () => {
    const persisted = fromStepErrorDto({
      message: 'mkdir denied',
      reason: 'workspace_prep_failed',
    });

    expect(persisted).toEqual({message: 'mkdir denied', reason: 'workspace_prep_failed'});
  });

  it('persists the machine-readable agent config issue in camelCase', () => {
    const persisted = fromStepErrorDto({
      message: 'Missing credentials',
      code: 'workspace-providers-disabled',
      managed_provider_id: 'shipfox',
      reason: 'agent_config_invalid',
      agent_config_issue: 'provider_not_configured',
    });

    expect(persisted).toEqual({
      message: 'Missing credentials',
      code: 'workspace-providers-disabled',
      managedProviderId: 'shipfox',
      reason: 'agent_config_invalid',
      agentConfigIssue: 'provider_not_configured',
    });
  });

  it('round-trips an agent harness availability failure without inventing an issue code', () => {
    const persisted = fromStepErrorDto({
      message: 'Pi extension setup failed: Unknown option: --mcp-config',
      reason: 'agent_harness_unavailable',
    });

    expect(persisted).toEqual({
      message: 'Pi extension setup failed: Unknown option: --mcp-config',
      reason: 'agent_harness_unavailable',
    });

    const dto = toStepDto(step({type: 'agent', error: persisted}));

    expect(dto.error).toEqual({
      message: 'Pi extension setup failed: Unknown option: --mcp-config',
      reason: 'agent_harness_unavailable',
      category: 'user',
    });
  });

  it('persists config error field and source diagnostics', () => {
    const persisted = fromStepErrorDto({
      message: 'Could not resolve env.VERSION',
      reason: 'config_unresolvable',
      field: 'env.VERSION',
      source: 'steps.build.outputs.version',
    });

    expect(persisted).toEqual({
      message: 'Could not resolve env.VERSION',
      reason: 'config_unresolvable',
      field: 'env.VERSION',
      source: 'steps.build.outputs.version',
    });
  });

  it('round-trips measured size details for a bounded step result', () => {
    const persisted = fromStepErrorDto({
      message: 'Workflow step result is too large.',
      code: 'step_result_too_large',
      reason: 'step_result_too_large',
      field: 'response',
      source: 'workflows',
      retryable: false,
      limit_bytes: 8 * 1024,
      measured_bytes: 12 * 1024,
      overshoot_bytes: 4 * 1024,
    });

    expect(persisted).toMatchObject({
      code: 'step_result_too_large',
      reason: 'step_result_too_large',
      field: 'response',
      retryable: false,
      limitBytes: 8 * 1024,
      measuredBytes: 12 * 1024,
      overshootBytes: 4 * 1024,
    });

    expect(toStepDto(step({type: 'run', error: persisted})).error).toMatchObject({
      code: 'step_result_too_large',
      reason: 'step_result_too_large',
      field: 'response',
      retryable: false,
      limit_bytes: 8 * 1024,
      measured_bytes: 12 * 1024,
      overshoot_bytes: 4 * 1024,
    });
  });

  it('ignores a runner-supplied category (the server derives it on read)', () => {
    const persisted = fromStepErrorDto({
      message: 'mkdir denied',
      reason: 'workspace_prep_failed',
      category: 'setup',
    });

    expect(persisted).not.toHaveProperty('category');
  });

  it('returns null for a missing error', () => {
    expect(fromStepErrorDto(undefined)).toBeNull();
    expect(fromStepErrorDto(null)).toBeNull();
  });
});

describe('toStepDto error category', () => {
  it('surfaces status reasons and evaluation traces', () => {
    const dto = toStepDto(
      step({
        type: 'run',
        statusReason: 'condition_errored',
        evaluationTrace: [
          {
            expression: 'inputs.environment',
            roots: ['inputs.environment'],
            fillTarget: 'step-dispatch',
            evaluatedAt: 'step-dispatch',
            field: 'condition',
            value: 'production',
          },
        ],
      }),
    );

    expect(dto.status_reason).toBe('condition_errored');
    expect(dto.evaluation_trace).toEqual([
      {
        expression: 'inputs.environment',
        roots: ['inputs.environment'],
        fill_target: 'step-dispatch',
        evaluated_at: 'step-dispatch',
        field: 'condition',
        value: 'production',
      },
    ]);
  });

  it("derives category 'setup' for a setup step error and surfaces the reason", () => {
    const dto = toStepDto(
      step({type: 'setup', error: {message: 'mkdir denied', reason: 'workspace_prep_failed'}}),
    );

    expect(dto.error).toEqual({
      message: 'mkdir denied',
      reason: 'workspace_prep_failed',
      category: 'setup',
    });
  });

  it.each([
    'setup',
    'checkout',
    'agent',
    'run',
  ] as const)('derives category setup for %s steps with infrastructure failure reasons', (type) => {
    for (const reason of [
      'checkout_auth_failed',
      'checkout_unavailable',
      'checkout_failed',
      'checkout_path_invalid',
      'checkout_destination_occupied',
      'git_unavailable',
      'workspace_prep_failed',
      'setup_aborted',
    ] as const) {
      const dto = toStepDto(step({type, error: {message: 'Checkout failed', reason}}));

      expect(dto.error).toMatchObject({
        message: 'Checkout failed',
        reason,
        category: 'setup',
      });
    }
  });

  it.each([
    ['setup', 'setup'],
    ['checkout', 'setup'],
    ['agent', 'user'],
    ['run', 'user'],
  ] as const)('keeps config failures in the expected category for %s steps', (type, category) => {
    const dto = toStepDto(
      step({type, error: {message: 'Command failed', reason: 'config_unresolvable'}}),
    );

    expect(dto.error?.category).toBe(category);
  });

  it("derives category 'user' for a run step error", () => {
    const dto = toStepDto(
      step({type: 'run', error: {message: 'Command exited with code 1', exitCode: 1}}),
    );

    expect(dto.error).toEqual({
      message: 'Command exited with code 1',
      exit_code: 1,
      category: 'user',
    });
  });

  it("derives category 'user' for an agent config error and surfaces the reason", () => {
    const dto = toStepDto(
      step({
        type: 'agent',
        error: {
          message: 'Unknown provider "foo" for agent step.',
          code: 'workspace-providers-disabled',
          managedProviderId: 'shipfox',
          reason: 'agent_config_invalid',
          agentConfigIssue: 'provider_unsupported',
        },
      }),
    );

    expect(dto.error).toEqual({
      message: 'Unknown provider "foo" for agent step.',
      code: 'workspace-providers-disabled',
      managed_provider_id: 'shipfox',
      reason: 'agent_config_invalid',
      agent_config_issue: 'provider_unsupported',
      category: 'user',
    });
  });

  it('surfaces config error field and source diagnostics', () => {
    const dto = toStepDto(
      step({
        type: 'run',
        error: {
          message: 'Could not resolve env.VERSION',
          reason: 'config_unresolvable',
          field: 'env.VERSION',
          source: 'steps.build.outputs.version',
        },
      }),
    );

    expect(dto.error).toEqual({
      message: 'Could not resolve env.VERSION',
      reason: 'config_unresolvable',
      field: 'env.VERSION',
      source: 'steps.build.outputs.version',
      category: 'user',
    });
  });

  it('renders no error (and no category) for a successful step', () => {
    const dto = toStepDto(step({type: 'run', status: 'succeeded', error: null}));

    expect(dto.error).toBeNull();
  });

  it('maps source locations to snake_case', () => {
    const dto = toStepDto(
      step({type: 'run', sourceLocation: {startLine: 5, endLine: 8}, error: null}),
    );

    expect(dto.source_location).toEqual({start_line: 5, end_line: 8});
  });

  it('maps missing source locations to null', () => {
    const dto = toStepDto(step({type: 'setup', sourceLocation: null, error: null}));

    expect(dto.source_location).toBeNull();
  });

  it('surfaces the resolved session descriptor from the dispatch config', () => {
    const dto = toStepDto(
      step({
        type: 'agent',
        error: null,
        config: {
          prompt: 'Plan.',
          session: {
            id: '00000000-0000-4000-8000-000000000001',
            key: 'main',
            mode: 'resume',
            segment: 2,
          },
        },
      }),
    );

    expect(dto.session).toEqual({
      id: '00000000-0000-4000-8000-000000000001',
      key: 'main',
      mode: 'resume',
      segment: 2,
    });
  });

  it('surfaces null when the config carries no session descriptor', () => {
    const dto = toStepDto(step({type: 'agent', error: null, config: {prompt: 'Plan.'}}));

    expect(dto.session).toBeNull();
  });

  it('surfaces null for an authored session intent without a descriptor', () => {
    const dto = toStepDto(
      step({
        type: 'agent',
        error: null,
        config: {prompt: 'Plan.', session: {key: 'main', mode: 'resume'}},
      }),
    );

    expect(dto.session).toBeNull();
  });
});

const baseAttempt: StepAttempt = {
  id: '11111111-1111-4111-8111-111111111111',
  stepId: '22222222-2222-4222-8222-222222222222',
  attempt: 1,
  executionOrder: 1,
  status: 'failed',
  config: null,
  evaluationTrace: null,
  output: null,
  response: null,
  error: null,
  exitCode: 1,
  gateResult: {passed: 'yes'},
  restartFeedback: null,
  logOutcome: null,
  invocations: [],
  startedAt: new Date('2026-01-01T00:00:00.000Z'),
  finishedAt: new Date('2026-01-01T00:01:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('toStepAttemptDetailResponseDto', () => {
  it('keeps authored and resolved config inline through the 256 KiB detail limit', () => {
    const configJsonOverheadBytes = diagnosticValueByteLength({run: ''});
    const config = {
      run: 'x'.repeat(WORKFLOW_STEP_CONFIG_INLINE_MAX_BYTES - configJsonOverheadBytes),
    };
    const attempt: StepAttempt = {...baseAttempt, config};

    const result = toStepAttemptDetailResponseDto(
      step({type: 'run', authoredConfig: config}),
      attempt,
      {
        workflowRunId: '33333333-3333-4333-8333-333333333333',
        workflowRunAttempt: 2,
        jobId: '44444444-4444-4444-8444-444444444444',
        jobExecutionId: '55555555-5555-4555-8555-555555555555',
      },
      {
        authoredConfig: WORKFLOW_STEP_CONFIG_INLINE_MAX_BYTES,
        config: WORKFLOW_STEP_CONFIG_INLINE_MAX_BYTES,
      },
    );

    expect(result.authored_config).toEqual(config);
    expect(result.config).toEqual(config);
    expect(result.oversized_fields).toEqual([]);
  });

  it('preserves a valid session descriptor when the resolved config is omitted', () => {
    const session = {
      id: '66666666-6666-4666-8666-666666666666',
      key: 'main',
      mode: 'resume' as const,
      segment: 3,
    };

    const result = toStepAttemptDetailResponseDto(
      step({type: 'agent'}),
      {...baseAttempt, config: null},
      {
        workflowRunId: '33333333-3333-4333-8333-333333333333',
        workflowRunAttempt: 2,
        jobId: '44444444-4444-4444-8444-444444444444',
        jobExecutionId: '55555555-5555-4555-8555-555555555555',
      },
      {config: WORKFLOW_STEP_CONFIG_INLINE_MAX_BYTES + 1},
      session,
    );

    expect(result.session).toEqual(session);
  });

  it('returns authored config, resolved config, and attempt trace', () => {
    const stepData = step({
      type: 'run',
      authoredConfig: {run: 'echo $' + '{{ inputs.message }}'},
      config: {run: 'echo hello'},
    });
    const attempt: StepAttempt = {
      ...baseAttempt,
      config: {run: 'echo hello'},
      evaluationTrace: [
        {
          expression: 'inputs.message',
          roots: ['inputs.message'],
          fillTarget: 'step-dispatch',
          evaluatedAt: 'step-dispatch',
          field: 'run',
          value: 'hello',
        },
      ],
    };

    expect(
      toStepAttemptDetailResponseDto(stepData, attempt, {
        workflowRunId: '33333333-3333-4333-8333-333333333333',
        workflowRunAttempt: 2,
        jobId: '44444444-4444-4444-8444-444444444444',
        jobExecutionId: stepData.jobExecutionId,
      }),
    ).toEqual({
      workflow_run_id: '33333333-3333-4333-8333-333333333333',
      workflow_run_attempt: 2,
      job_id: '44444444-4444-4444-8444-444444444444',
      job_execution_id: stepData.jobExecutionId,
      step_id: stepData.id,
      step_attempt_id: attempt.id,
      attempt: 1,
      authored_config: {run: 'echo $' + '{{ inputs.message }}'},
      config: {run: 'echo hello'},
      session: null,
      evaluation_trace: [
        {
          expression: 'inputs.message',
          roots: ['inputs.message'],
          fill_target: 'step-dispatch',
          evaluated_at: 'step-dispatch',
          field: 'run',
          value: 'hello',
        },
      ],
      output: null,
      outputs: null,
      response: null,
      error: null,
      gate_result: {kind: 'unknown', data: {passed: 'yes'}},
      invocations: [],
      restart_feedback: null,
      oversized_fields: [],
    });
  });

  it('maps populated diagnostics and describes oversized legacy values', () => {
    const oversizedResponse = 'x'.repeat(WORKFLOW_DIAGNOSTIC_RESPONSE_MAX_BYTES + 1);
    const attempt: StepAttempt = {
      ...baseAttempt,
      config: {run: 'echo hello'},
      output: {artifact: 'dist/app.tgz'},
      response: oversizedResponse,
      error: {message: 'diagnostic rejected', reason: 'diagnostic_too_large', field: 'response'},
      gateResult: {passed: false, source: 'exit_code == 0', exit_code: 1},
      invocations: [
        {
          call_index: 0,
          started_at: '2026-01-01T00:00:00.000Z',
          finished_at: '2026-01-01T00:01:00.000Z',
          outcome: 'error',
        },
      ],
      restartFeedback: 'retry with the corrected input',
    };

    const result = toStepAttemptDetailResponseDto(step({type: 'run'}), attempt, {
      workflowRunId: '33333333-3333-4333-8333-333333333333',
      workflowRunAttempt: 2,
      jobId: '44444444-4444-4444-8444-444444444444',
      jobExecutionId: '55555555-5555-4555-8555-555555555555',
    });

    expect(result).toMatchObject({
      config: {run: 'echo hello'},
      output: {artifact: 'dist/app.tgz'},
      outputs: {artifact: 'dist/app.tgz'},
      response: null,
      error: {
        message: 'diagnostic rejected',
        reason: 'diagnostic_too_large',
        field: 'response',
        category: 'user',
      },
      gate_result: {
        kind: 'failed',
        passed: false,
        source: 'exit_code == 0',
        exit_code: 1,
      },
      invocations: [expect.objectContaining({call_index: 0, outcome: 'error'})],
      restart_feedback: 'retry with the corrected input',
    });
    expect(result.oversized_fields).toEqual([
      {
        field: 'response',
        stored_bytes: Buffer.byteLength(oversizedResponse, 'utf8'),
        reason: 'legacy_value_exceeds_inline_limit',
      },
    ]);
  });

  it('describes an oversized diagnostic omitted by the lazy detail query', () => {
    const result = toStepAttemptDetailResponseDto(
      step({type: 'run'}),
      {...baseAttempt, config: null},
      {
        workflowRunId: '33333333-3333-4333-8333-333333333333',
        workflowRunAttempt: 2,
        jobId: '44444444-4444-4444-8444-444444444444',
        jobExecutionId: '55555555-5555-4555-8555-555555555555',
      },
      {config: WORKFLOW_STEP_CONFIG_INLINE_MAX_BYTES + 1},
    );

    expect(result.config).toBeNull();
    expect(result.oversized_fields).toContainEqual({
      field: 'config',
      stored_bytes: WORKFLOW_STEP_CONFIG_INLINE_MAX_BYTES + 1,
      reason: 'value_exceeds_inline_limit',
    });
  });

  it('describes a legacy step error omitted by the lazy detail query', () => {
    const result = toStepAttemptDetailResponseDto(
      step({type: 'run', error: {message: 'legacy failure'}}),
      baseAttempt,
      {
        workflowRunId: '33333333-3333-4333-8333-333333333333',
        workflowRunAttempt: 2,
        jobId: '44444444-4444-4444-8444-444444444444',
        jobExecutionId: '55555555-5555-4555-8555-555555555555',
      },
      {stepError: WORKFLOW_DIAGNOSTIC_ERROR_MAX_BYTES + 1},
    );

    expect(result.oversized_fields).toContainEqual({
      field: 'error',
      stored_bytes: WORKFLOW_DIAGNOSTIC_ERROR_MAX_BYTES + 1,
      reason: 'legacy_value_exceeds_inline_limit',
    });
  });

  it('describes values truncated at the write limit', () => {
    const result = toStepAttemptDetailResponseDto(
      step({type: 'run'}),
      {
        ...baseAttempt,
        error: {
          code: 'step_result_too_large',
          reason: 'step_result_too_large',
          field: 'response',
          measuredBytes: 12_345,
        },
      },
      {
        workflowRunId: '33333333-3333-4333-8333-333333333333',
        workflowRunAttempt: 2,
        jobId: '44444444-4444-4444-8444-444444444444',
        jobExecutionId: '55555555-5555-4555-8555-555555555555',
      },
    );

    expect(result.oversized_fields).toContainEqual({
      field: 'response',
      stored_bytes: 12_345,
      reason: 'value_truncated_at_write_limit',
    });
  });

  it('derives a status-based gate result when the stored gate value is null', () => {
    const result = toStepAttemptDetailResponseDto(
      step({type: 'run'}),
      {...baseAttempt, status: 'succeeded', gateResult: null},
      {
        workflowRunId: '33333333-3333-4333-8333-333333333333',
        workflowRunAttempt: 2,
        jobId: '44444444-4444-4444-8444-444444444444',
        jobExecutionId: '55555555-5555-4555-8555-555555555555',
      },
    );

    expect(result.gate_result).toEqual({kind: 'none'});
  });
});
