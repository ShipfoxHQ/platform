import type {Step, StepAttempt} from '#core/entities/step.js';
import {
  fromStepErrorDto,
  toStepAttemptDetailResponseDto,
  toStepAttemptDto,
  toStepDto,
} from './step.js';

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

  it("derives category 'setup' for a checkout step error and surfaces the reason", () => {
    const dto = toStepDto(
      step({type: 'checkout', error: {message: 'Checkout failed', reason: 'checkout_failed'}}),
    );

    expect(dto.error).toEqual({
      message: 'Checkout failed',
      reason: 'checkout_failed',
      category: 'setup',
    });
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
  startedAt: new Date('2026-01-01T00:00:00.000Z'),
  finishedAt: new Date('2026-01-01T00:01:00.000Z'),
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('toStepAttemptDto', () => {
  it('keeps evaluation traces on the lazy detail response instead of run polling', () => {
    const result = toStepAttemptDto({
      ...baseAttempt,
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
    });

    expect(result).not.toHaveProperty('evaluation_trace');
  });

  it('maps passed gate payloads to typed gate results', () => {
    const attempt: StepAttempt = {
      ...baseAttempt,
      status: 'succeeded',
      exitCode: 0,
      gateResult: {passed: true, source: 'exit_code == 0', exit_code: 0},
    };

    const result = toStepAttemptDto(attempt);

    expect(result.gate_result).toEqual({
      kind: 'passed',
      passed: true,
      source: 'exit_code == 0',
      exit_code: 0,
    });
  });

  it('maps failed gate payloads to typed gate results', () => {
    const attempt: StepAttempt = {
      ...baseAttempt,
      gateResult: {passed: false, source: 'exit_code == 0', exit_code: 1},
    };

    const result = toStepAttemptDto(attempt);

    expect(result.gate_result).toEqual({
      kind: 'failed',
      passed: false,
      source: 'exit_code == 0',
      exit_code: 1,
    });
  });

  it('maps uncheckable gate payloads before generic failed payloads', () => {
    const attempt: StepAttempt = {
      ...baseAttempt,
      gateResult: {passed: false, uncheckable: true, reason: 'missing output', exit_code: null},
    };

    const result = toStepAttemptDto(attempt);

    expect(result.gate_result).toEqual({
      kind: 'uncheckable',
      passed: false,
      uncheckable: true,
      reason: 'missing output',
      exit_code: null,
    });
  });

  it('maps missing gate payloads to an explicit none result', () => {
    const attempt: StepAttempt = {...baseAttempt, gateResult: null};

    const result = toStepAttemptDto(attempt);

    expect(result.gate_result).toEqual({kind: 'none'});
    expect(result.restart_feedback).toBeNull();
  });

  it('maps running attempts without gate payloads to not evaluated', () => {
    const attempt: StepAttempt = {...baseAttempt, status: 'running', gateResult: null};

    const result = toStepAttemptDto(attempt);

    expect(result.gate_result).toEqual({kind: 'not_evaluated'});
  });

  it('maps gate expression failures to typed evaluation errors', () => {
    const attempt: StepAttempt = {
      ...baseAttempt,
      gateResult: {
        passed: false,
        uncheckable: true,
        reason: 'gate expression evaluation failed',
        exit_code: 1,
      },
    };

    const result = toStepAttemptDto(attempt);

    expect(result.gate_result).toEqual({
      kind: 'evaluation_error',
      reason: 'gate expression evaluation failed',
      exit_code: 1,
    });
  });

  it('maps restart feedback', () => {
    const attempt: StepAttempt = {
      ...baseAttempt,
      output: {summary: 'looks good'},
      response: 'done',
      restartFeedback: 'gate condition not met',
    };

    const result = toStepAttemptDto(attempt);

    expect(result.output).toEqual({summary: 'looks good'});
    expect(result.outputs).toEqual({summary: 'looks good'});
    expect(result.response).toBe('done');
    expect(result.restart_feedback).toBe('gate condition not met');
  });

  it('maps legacy gate payloads to an explicit unknown result', () => {
    const attempt = baseAttempt;

    const result = toStepAttemptDto(attempt);

    expect(result.gate_result).toEqual({
      kind: 'unknown',
      data: {passed: 'yes'},
    });
  });
});

describe('toStepAttemptDetailResponseDto', () => {
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

    expect(toStepAttemptDetailResponseDto(stepData, attempt)).toEqual({
      step_id: stepData.id,
      attempt: 1,
      authored_config: {run: 'echo $' + '{{ inputs.message }}'},
      config: {run: 'echo hello'},
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
    });
  });
});
