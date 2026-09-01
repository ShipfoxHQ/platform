import {parseWorkflowTemplate, planInterpolationField} from '@shipfox/expression';
import {
  evaluateGate,
  evaluateGateFeedback,
  gateResultPayload,
  readStepGate,
} from './evaluate-gate.js';

function gateConfig(source: string, restartFrom?: string): Record<string, unknown> {
  return {
    run: 'echo hi',
    gate: {
      success: {language: 'cel', check: 'syntax', source},
      ...(restartFrom ? {on_failure: {restart_from: restartFrom}} : {}),
    },
  };
}

function feedbackTemplate(source: string) {
  const plan = planInterpolationField({
    field: 'step.feedback',
    segments: parseWorkflowTemplate(source),
  });
  if (!plan.ok) throw new Error('Expected test feedback template to plan');
  return plan.plan.field;
}

function gateTrace(source: string, value: boolean) {
  return [
    {
      expression: source,
      roots: ['step'],
      fillTarget: 'step-report',
      evaluatedAt: 'step-report',
      value: String(value),
      field: 'step.success',
    },
  ];
}

function degradedGateTrace(source: string, roots: readonly string[]) {
  return [
    {
      expression: source,
      roots,
      fillTarget: 'step-report' as const,
      evaluatedAt: 'step-report' as const,
      value: 'false',
      degraded: true,
      field: 'step.success' as const,
    },
  ];
}

describe('readStepGate', () => {
  test('returns undefined when the config has no gate', () => {
    expect(readStepGate({run: 'echo hi'})).toBeUndefined();
  });

  test('parses success and on_failure', () => {
    const gate = readStepGate(gateConfig('step.exit_code == 0', 'producer'));
    expect(gate?.success?.source).toBe('step.exit_code == 0');
    expect(gate?.onFailure).toEqual({restartFrom: 'producer'});
  });

  test('parses feedback templates from on_failure', () => {
    const gate = readStepGate({
      ...gateConfig('step.exit_code == 0'),
      gate: {
        success: {language: 'cel', check: 'syntax', source: 'step.exit_code == 0'},
        on_failure: {
          restart_from: 'producer',
          feedback: 'failed',
          feedback_template: feedbackTemplate(`failed: \${{ step.outputs.summary }}`),
        },
      },
    });

    expect(gate?.onFailure?.feedbackTemplate).toEqual(
      feedbackTemplate(`failed: \${{ step.outputs.summary }}`),
    );
  });
});

describe('evaluateGate', () => {
  test('no gate → no-gate', () => {
    expect(
      evaluateGate(readStepGate({run: 'echo hi'}), {status: 'succeeded', exitCode: 0}),
    ).toEqual({
      kind: 'no-gate',
    });
  });

  test('step.exit_code == 0 passes for exit 0', () => {
    const gate = readStepGate(gateConfig('step.exit_code == 0'));
    expect(evaluateGate(gate, {status: 'succeeded', exitCode: 0})).toEqual({
      kind: 'passed',
      source: 'step.exit_code == 0',
      trace: gateTrace('step.exit_code == 0', true),
    });
  });

  test('step.exit_code == 0 fails for a non-zero exit', () => {
    const gate = readStepGate(gateConfig('step.exit_code == 0'));
    expect(evaluateGate(gate, {status: 'failed', exitCode: 1})).toEqual({
      kind: 'failed',
      source: 'step.exit_code == 0',
      trace: gateTrace('step.exit_code == 0', false),
    });
  });

  test('a passing gate can succeed a non-zero exit (success: step.exit_code == 1)', () => {
    const gate = readStepGate(gateConfig('step.exit_code == 1'));
    expect(evaluateGate(gate, {status: 'failed', exitCode: 1})).toMatchObject({kind: 'passed'});
  });

  test('exit_code arithmetic can pass using CEL int values at runtime', () => {
    const gate = readStepGate(gateConfig('step.exit_code % 2 == 0'));

    const result = evaluateGate(gate, {status: 'succeeded', exitCode: 2});

    expect(result).toEqual({
      kind: 'passed',
      source: 'step.exit_code % 2 == 0',
      trace: gateTrace('step.exit_code % 2 == 0', true),
    });
  });

  test('exit_code arithmetic can fail using CEL int values at runtime', () => {
    const gate = readStepGate(gateConfig('step.exit_code % 2 == 0'));

    const result = evaluateGate(gate, {status: 'failed', exitCode: 3});

    expect(result).toEqual({
      kind: 'failed',
      source: 'step.exit_code % 2 == 0',
      trace: gateTrace('step.exit_code % 2 == 0', false),
    });
  });

  test('step.status gates on the reported step status', () => {
    const gate = readStepGate(gateConfig('step.status == "succeeded"'));
    expect(evaluateGate(gate, {status: 'succeeded', exitCode: 0})).toMatchObject({kind: 'passed'});
    expect(evaluateGate(gate, {status: 'failed', exitCode: 0})).toMatchObject({kind: 'failed'});
  });

  test('resolves vars from the run-creation snapshot', () => {
    const gate = readStepGate(gateConfig('vars.ENABLED == "true"'));

    expect(evaluateGate(gate, {status: 'succeeded', exitCode: 0}, {ENABLED: 'true'})).toMatchObject(
      {kind: 'passed'},
    );
  });

  test('step.outputs gates on reported output values', () => {
    const gate = readStepGate(gateConfig('step.outputs.pass == true'));

    const passed = evaluateGate(gate, {
      status: 'succeeded',
      exitCode: 0,
      output: {pass: true},
    });
    const failed = evaluateGate(gate, {
      status: 'succeeded',
      exitCode: 0,
      output: {pass: false},
    });

    expect(passed).toEqual({
      kind: 'passed',
      source: 'step.outputs.pass == true',
      trace: gateTrace('step.outputs.pass == true', true),
    });
    expect(failed).toEqual({
      kind: 'failed',
      source: 'step.outputs.pass == true',
      trace: gateTrace('step.outputs.pass == true', false),
    });
  });

  test('tool-step output gates do not require an exit code', () => {
    const source = 'step.outputs.result.number == 1';
    const gate = readStepGate(gateConfig(source));

    expect(
      evaluateGate(
        gate,
        {status: 'succeeded', exitCode: null, output: {result: {number: 1}}},
        undefined,
        {stepType: 'tool'},
      ),
    ).toEqual({
      kind: 'passed',
      source,
      trace: gateTrace(source, true),
    });
  });

  test('unguarded missing step output keys fail closed as uncheckable', () => {
    const gate = readStepGate(gateConfig('step.outputs.pass == true'));

    const result = evaluateGate(gate, {status: 'succeeded', exitCode: 0, output: {}});

    expect(result).toEqual({
      kind: 'uncheckable',
      reason: 'gate expression evaluation failed',
      source: 'step.outputs.pass == true',
      trace: [
        {
          expression: 'step.outputs.pass == true',
          roots: ['step'],
          fillTarget: 'step-report',
          evaluatedAt: 'step-report',
          value: 'false',
          degraded: true,
          field: 'step.success',
        },
      ],
    });
  });

  test('has-guarded missing step output keys evaluate as a checkable failure', () => {
    const source = 'has(step.outputs.pass) && step.outputs.pass == true';
    const gate = readStepGate(gateConfig(source));

    const result = evaluateGate(gate, {status: 'succeeded', exitCode: 0, output: {}});

    expect(result).toEqual({kind: 'failed', source, trace: gateTrace(source, false)});
  });

  test('a missing exit code is uncheckable (never evaluated)', () => {
    const gate = readStepGate(gateConfig('step.exit_code == 0'));
    expect(evaluateGate(gate, {status: 'failed', exitCode: null})).toMatchObject({
      kind: 'uncheckable',
    });
  });

  test('an evaluation error is uncheckable, not a gate failure', () => {
    const gate = readStepGate(gateConfig('missing_var == 0'));
    expect(evaluateGate(gate, {status: 'succeeded', exitCode: 0})).toEqual({
      kind: 'uncheckable',
      reason: 'gate expression evaluation failed',
      source: 'missing_var == 0',
      trace: degradedGateTrace('missing_var == 0', ['missing_var']),
    });
  });
});

describe('evaluateGateFeedback', () => {
  test('returns literal feedback when no template was planned', () => {
    const gate = readStepGate({
      ...gateConfig('step.exit_code == 0'),
      gate: {
        success: {language: 'cel', check: 'syntax', source: 'step.exit_code == 0'},
        on_failure: {restart_from: 'producer', feedback: 'try again'},
      },
    });
    if (!gate) throw new Error('Expected gate');

    const result = evaluateGateFeedback({
      gate,
      result: {status: 'failed', exitCode: 1, output: {summary: 'unit failed'}},
      definitionId: 'definition-1',
    });

    expect(result).toBe('try again');
  });

  test('evaluates feedback templates against the reported step self-root', () => {
    const gate = readStepGate({
      ...gateConfig('step.exit_code == 0'),
      gate: {
        success: {language: 'cel', check: 'syntax', source: 'step.exit_code == 0'},
        on_failure: {
          restart_from: 'producer',
          feedback: 'try again',
          feedback_template: feedbackTemplate(`failed: \${{ step.outputs.summary }}`),
        },
      },
    });
    if (!gate) throw new Error('Expected gate');

    const result = evaluateGateFeedback({
      gate,
      result: {status: 'failed', exitCode: 1, output: {summary: 'unit failed'}},
      definitionId: 'definition-1',
    });

    expect(result).toBe('failed: unit failed');
  });
});

describe('gateResultPayload', () => {
  test('no-gate → null', () => {
    expect(gateResultPayload({kind: 'no-gate'}, 0)).toBeNull();
  });

  test('passed records the source and evaluated exit code', () => {
    expect(gateResultPayload({kind: 'passed', source: 'step.exit_code == 0'}, 0)).toEqual({
      passed: true,
      source: 'step.exit_code == 0',
      exit_code: 0,
    });
  });

  test('failed records the source and evaluated exit code', () => {
    expect(gateResultPayload({kind: 'failed', source: 'step.exit_code == 0'}, 1)).toEqual({
      passed: false,
      source: 'step.exit_code == 0',
      exit_code: 1,
    });
  });

  test('uncheckable records the reason and a null exit code', () => {
    expect(gateResultPayload({kind: 'uncheckable', reason: 'no exit code'}, null)).toEqual({
      passed: false,
      uncheckable: true,
      reason: 'no exit code',
      exit_code: null,
    });
  });

  test('uncheckable preserves an evaluation trace when the predicate ran', () => {
    expect(
      gateResultPayload(
        {
          kind: 'uncheckable',
          reason: 'gate expression evaluation failed',
          source: 'missing_var == 0',
          trace: degradedGateTrace('missing_var == 0', ['missing_var']),
        },
        0,
      ),
    ).toEqual({
      passed: false,
      uncheckable: true,
      reason: 'gate expression evaluation failed',
      source: 'missing_var == 0',
      exit_code: 0,
      trace: degradedGateTrace('missing_var == 0', ['missing_var']),
    });
  });
});
