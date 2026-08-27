import {
  agentStepSessionDescriptorSchema,
  agentStepSessionIntentSchema,
  STEP_ERROR_MESSAGE_MAX_LENGTH,
  STEP_STATUS_REASONS,
  stepAttemptDtoSchema,
  stepDtoSchema,
  stepErrorDtoSchema,
  stepStatusReasonSchema,
} from './step.js';

const baseAttempt = {
  id: '11111111-1111-4111-8111-111111111111',
  step_id: '22222222-2222-4222-8222-222222222222',
  attempt: 1,
  execution_order: 1,
  status: 'succeeded',
  exit_code: 0,
  output: null,
  outputs: null,
  response: null,
  error: null,
  restart_feedback: null,
  started_at: '2026-01-01T00:00:00.000Z',
  finished_at: '2026-01-01T00:01:00.000Z',
};

describe('stepErrorDtoSchema', () => {
  it('accepts a message at the maximum length', () => {
    const result = stepErrorDtoSchema.safeParse({
      message: 'x'.repeat(STEP_ERROR_MESSAGE_MAX_LENGTH),
    });

    expect(result.success).toBe(true);
  });

  it('rejects a message beyond the maximum length', () => {
    const result = stepErrorDtoSchema.safeParse({
      message: 'x'.repeat(STEP_ERROR_MESSAGE_MAX_LENGTH + 1),
    });

    expect(result.success).toBe(false);
  });

  it('accepts an agent config issue with an agent config failure reason', () => {
    const result = stepErrorDtoSchema.parse({
      message: 'Model provider credentials are not configured',
      reason: 'agent_config_invalid',
      agent_config_issue: 'provider_not_configured',
    });

    expect(result).toEqual({
      message: 'Model provider credentials are not configured',
      reason: 'agent_config_invalid',
      agent_config_issue: 'provider_not_configured',
    });
  });

  it('accepts a stable runtime error code and managed provider identity', () => {
    const result = stepErrorDtoSchema.parse({
      message: 'Agent runtime config request failed with status 422: workspace-providers-disabled.',
      code: 'workspace-providers-disabled',
      managed_provider_id: 'shipfox',
      reason: 'agent_config_invalid',
      agent_config_issue: 'provider_unsupported',
    });

    expect(result).toMatchObject({
      code: 'workspace-providers-disabled',
      managed_provider_id: 'shipfox',
    });
  });

  it('accepts typed output validation failures', () => {
    const result = stepErrorDtoSchema.parse({
      message: 'Output "count" must be a finite number or numeric string.',
      reason: 'output_invalid',
      field: 'outputs.count',
    });

    expect(result).toEqual({
      message: 'Output "count" must be a finite number or numeric string.',
      reason: 'output_invalid',
      field: 'outputs.count',
    });
  });

  it.each([
    'checkout_path_invalid',
    'checkout_destination_occupied',
  ] as const)('accepts the runner checkout destination reason %s', (reason) => {
    const result = stepErrorDtoSchema.parse({
      message: 'Checkout destination policy rejected the step.',
      reason,
    });

    expect(result?.reason).toBe(reason);
  });

  it('rejects unknown agent config issues', () => {
    const result = stepErrorDtoSchema.safeParse({
      message: 'Model provider credentials are not configured',
      reason: 'agent_config_invalid',
      agent_config_issue: 'unknown',
    });

    expect(result.success).toBe(false);
  });

  it.each([
    undefined,
    'workspace_prep_failed',
    'agent_invocation_failed',
    'agent_harness_unavailable',
  ] as const)('rejects an agent config issue when reason is %s', (reason) => {
    const result = stepErrorDtoSchema.safeParse({
      message: 'Model provider credentials are not configured',
      ...(reason === undefined ? {} : {reason}),
      agent_config_issue: 'provider_not_configured',
    });

    expect(result.success).toBe(false);
  });

  it('accepts an agent harness availability failure without an agent config issue', () => {
    const result = stepErrorDtoSchema.parse({
      message: 'Pi extension setup failed: Unknown option: --mcp-config',
      reason: 'agent_harness_unavailable',
    });

    expect(result).toEqual({
      message: 'Pi extension setup failed: Unknown option: --mcp-config',
      reason: 'agent_harness_unavailable',
    });
  });

  it.each([
    'agent_session_key_invalid',
    'agent_session_held',
    'agent_session_harness_mismatch',
    'agent_session_unavailable',
  ] as const)('accepts the dispatch-time session failure reason %s', (reason) => {
    const result = stepErrorDtoSchema.parse({
      message: 'Agent session could not be claimed.',
      reason,
    });

    expect(result).toEqual({message: 'Agent session could not be claimed.', reason});
  });

  it.each([
    'agent_session_key_invalid',
    'agent_session_held',
    'agent_session_harness_mismatch',
    'agent_session_unavailable',
  ] as const)('rejects an agent config issue on the session failure reason %s', (reason) => {
    const result = stepErrorDtoSchema.safeParse({
      message: 'Agent session could not be claimed.',
      reason,
      agent_config_issue: 'step_config_invalid',
    });

    expect(result.success).toBe(false);
  });
});

describe('agentStepSessionDescriptorSchema', () => {
  it('accepts a resolved session descriptor', () => {
    const result = agentStepSessionDescriptorSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      key: 'main',
      mode: 'resume',
      segment: 3,
    });

    expect(result).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      key: 'main',
      mode: 'resume',
      segment: 3,
    });
  });

  it('rejects an invalid descriptor identity', () => {
    const result = agentStepSessionDescriptorSchema.safeParse({
      id: 'not-a-uuid',
      key: 'main',
      mode: 'resume',
      segment: 0,
    });

    expect(result.success).toBe(false);
  });

  it('keeps the authored intent distinct from a resolved descriptor', () => {
    expect(agentStepSessionIntentSchema.parse({key: 'main', mode: 'resume'})).toEqual({
      key: 'main',
      mode: 'resume',
    });
    expect(
      agentStepSessionIntentSchema.safeParse({
        id: '11111111-1111-4111-8111-111111111111',
        key: 'main',
        mode: 'resume',
        segment: 0,
      }).success,
    ).toBe(false);
  });

  it('carries a nullable session on the step DTO', () => {
    const result = stepDtoSchema.parse({
      id: '11111111-1111-4111-8111-111111111111',
      job_execution_id: '33333333-3333-4333-8333-333333333333',
      key: null,
      name: 'Plan',
      source_location: null,
      status: 'pending',
      status_reason: null,
      type: 'agent',
      config: {prompt: 'Plan the work.'},
      evaluation_trace: null,
      error: null,
      session: null,
      position: 1,
      current_attempt: 1,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    expect(result.session).toBeNull();
  });

  it('accepts a legacy step DTO without the additive session field', () => {
    const {session: _session, ...legacyStep} = {
      id: '11111111-1111-4111-8111-111111111111',
      job_execution_id: '33333333-3333-4333-8333-333333333333',
      key: null,
      name: 'Plan',
      source_location: null,
      status: 'pending',
      status_reason: null,
      type: 'agent',
      config: {prompt: 'Plan the work.'},
      evaluation_trace: null,
      error: null,
      session: null,
      position: 1,
      current_attempt: 1,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };

    const result = stepDtoSchema.parse(legacyStep);

    expect(result.session).toBeUndefined();
  });
});

describe('stepStatusReasonSchema', () => {
  it.each(STEP_STATUS_REASONS)('accepts the domain reason %s', (reason) => {
    expect(stepStatusReasonSchema.parse(reason)).toBe(reason);
  });

  it('rejects an unknown step status reason', () => {
    expect(stepStatusReasonSchema.safeParse('runner_lost').success).toBe(false);
  });
});

describe('stepAttemptDtoSchema', () => {
  it('accepts an attempt with no gate or restart feedback', () => {
    const attempt = {...baseAttempt, gate_result: {kind: 'none'}};

    const result = stepAttemptDtoSchema.parse(attempt);

    expect(result.gate_result).toEqual({kind: 'none'});
    expect(result.restart_feedback).toBeNull();
  });

  it('accepts not-evaluated and evaluation-error gate results', () => {
    const notEvaluated = stepAttemptDtoSchema.parse({
      ...baseAttempt,
      gate_result: {kind: 'not_evaluated'},
    });
    const evaluationError = stepAttemptDtoSchema.parse({
      ...baseAttempt,
      gate_result: {
        kind: 'evaluation_error',
        reason: 'gate expression evaluation failed',
        exit_code: 1,
      },
    });

    expect(notEvaluated.gate_result).toEqual({kind: 'not_evaluated'});
    expect(evaluationError.gate_result).toEqual({
      kind: 'evaluation_error',
      reason: 'gate expression evaluation failed',
      exit_code: 1,
    });
  });

  it('accepts typed gate results and restart feedback', () => {
    const attempt = {
      ...baseAttempt,
      status: 'failed',
      exit_code: 1,
      gate_result: {
        kind: 'failed',
        passed: false,
        source: 'exit_code == 0',
        exit_code: 1,
      },
      restart_feedback: 'gate condition not met',
    };

    const result = stepAttemptDtoSchema.parse(attempt);

    expect(result.gate_result).toEqual({
      kind: 'failed',
      passed: false,
      source: 'exit_code == 0',
      exit_code: 1,
    });
    expect(result.restart_feedback).toBe('gate condition not met');
  });

  it('accepts an explicit unknown gate result for legacy data', () => {
    const attempt = {
      ...baseAttempt,
      gate_result: {
        kind: 'unknown',
        data: {passed: 'yes'},
      },
    };

    const result = stepAttemptDtoSchema.parse(attempt);

    expect(result.gate_result).toEqual({
      kind: 'unknown',
      data: {passed: 'yes'},
    });
  });

  it('rejects inconsistent typed gate results', () => {
    const result = stepAttemptDtoSchema.safeParse({
      ...baseAttempt,
      gate_result: {
        kind: 'passed',
        passed: false,
        source: 'exit_code == 0',
        exit_code: 1,
      },
    });

    expect(result.success).toBe(false);
  });
});
