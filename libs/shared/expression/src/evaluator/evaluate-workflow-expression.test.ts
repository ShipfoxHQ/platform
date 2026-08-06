import {evaluate as evaluateCel} from '@marcbachmann/cel-js';
import {createWorkflowExpression} from '../expression/create-workflow-expression.js';
import {MAX_JSON_OUTPUT_BYTES, MAX_RANGE_FANOUT_BYTES} from '../workflow-function-registry.js';
import {WorkflowExpressionEvaluationError} from './errors.js';
import {
  evaluateWorkflowExpression,
  evaluateWorkflowExpressionWithEnvironment,
  evaluateWorkflowPredicate,
  evaluateWorkflowPredicateFailClosed,
} from './evaluate-workflow-expression.js';
import {createRangeEnvironment} from './range.js';

describe('evaluateWorkflowExpression', () => {
  it('evaluates a validated CEL expression against caller-provided values', () => {
    const expression = createWorkflowExpression({
      source: 'event.conclusion == "success"',
      check: {
        mode: 'typed',
        typeEnvironment: {
          event: {kind: 'object', fields: {conclusion: 'string'}},
        },
      },
    });

    const result = evaluateWorkflowExpression(expression, {
      event: {conclusion: 'success'},
    });

    expect(result).toBe(true);
  });

  it.each([
    [1, true],
    [1.5, false],
  ])('evaluates number equality with an integer literal for %s', (value, expected) => {
    const expression = createWorkflowExpression({
      source: 'event.value == 1',
      check: {
        mode: 'typed',
        typeEnvironment: {
          event: {kind: 'object', fields: {value: 'double'}},
        },
        expectedResultType: 'bool',
      },
    });

    const result = evaluateWorkflowPredicate(expression, {
      event: {value},
    });

    expect(result).toBe(expected);
  });

  it('does not add workflow functions to the vendor-global evaluator', () => {
    const expression = createWorkflowExpression({
      source: 'range(2, 32, 2)',
      check: {mode: 'syntax'},
    });
    // Creating the workflow evaluator must not register functions in the vendor-global evaluator.
    createRangeEnvironment();

    const evaluateGlobally = () => evaluateCel(expression.source, {});

    expect(evaluateGlobally).toThrow('found no matching overload');
  });

  it('evaluates the shared JSON functions through the default workflow environment', () => {
    const expression = createWorkflowExpression({
      source: 'toJson(fromJson(event.payload))',
      check: {mode: 'syntax'},
    });

    const result = evaluateWorkflowExpression(expression, {
      event: {payload: '{"ready":true,"count":2}'},
    });

    expect(result).toBe('{"ready":true,"count":2}');
  });

  it('serializes CEL integers as JSON numbers', () => {
    const expression = createWorkflowExpression({
      source: 'toJson([1, 2])',
      check: {mode: 'syntax'},
    });

    const result = evaluateWorkflowExpression(expression, {});

    expect(result).toBe('[1,2]');
  });

  it('evaluates range through the default workflow environment', () => {
    const expression = createWorkflowExpression({
      source: 'range(2, 6, 2)',
      check: {mode: 'syntax'},
    });

    const result = evaluateWorkflowExpression(expression, {});

    expect(result).toEqual([2n, 4n, 6n]);
  });

  it('gives each default-environment evaluation a full range budget', () => {
    const expression = createWorkflowExpression({
      source: 'range(1, 1000, 1).size()',
      check: {mode: 'syntax'},
    });

    const first = evaluateWorkflowExpression(expression, {});
    const second = evaluateWorkflowExpression(expression, {});

    expect(first).toBe(1000n);
    expect(second).toBe(1000n);
  });

  it('enforces the range budget through the default workflow environment', () => {
    const expression = createWorkflowExpression({
      source: 'range(1, 1001, 1)',
      check: {mode: 'syntax'},
    });

    const evaluateTooLarge = () => evaluateWorkflowExpression(expression, {});

    expect(evaluateTooLarge).toThrow(WorkflowExpressionEvaluationError);
  });

  it('reports invalid JSON passed to fromJson as an evaluation failure', () => {
    const expression = createWorkflowExpression({
      source: 'fromJson(event.payload)',
      check: {mode: 'syntax'},
    });

    const evaluateInvalid = () =>
      evaluateWorkflowExpression(expression, {event: {payload: 'not json'}});

    expect(evaluateInvalid).toThrow(WorkflowExpressionEvaluationError);
  });

  it('serializes integers beyond the safe range as JSON strings', () => {
    const expression = createWorkflowExpression({
      source: 'toJson(9223372036854775807)',
      check: {mode: 'syntax'},
    });

    const result = evaluateWorkflowExpression(expression, {});

    expect(result).toBe('"9223372036854775807"');
  });

  it('parses safe JSON numbers as CEL integers', () => {
    const expression = createWorkflowExpression({
      source: 'fromJson(event.payload).count + 1',
      check: {
        mode: 'typed',
        typeEnvironment: {
          event: {kind: 'object', fields: {payload: 'string'}},
        },
      },
    });

    const result = evaluateWorkflowExpression(expression, {
      event: {payload: '{"count":2}'},
    });

    expect(result).toBe(3n);
  });

  it('enforces a shared JSON output budget across range-generated values', () => {
    const expression = createWorkflowExpression({
      source: 'range(1, 2, 1).map(index, toJson(event)).size() == 2',
      check: {
        mode: 'typed',
        typeEnvironment: {event: {kind: 'map'}},
        expectedResultType: 'bool',
      },
    });
    const payload = 'x'.repeat(MAX_JSON_OUTPUT_BYTES / 2);

    const result = evaluateWorkflowPredicateFailClosed(expression, {event: {payload}});

    expect(result).toEqual({value: false, evaluationFailed: true});
  });

  it('enforces a context-sized range fan-out budget', () => {
    const expression = createWorkflowExpression({
      source: 'range(1, 1000, 1).map(index, event.payload.upperAscii()).size() == 1000',
      check: {
        mode: 'typed',
        typeEnvironment: {
          event: {kind: 'object', fields: {payload: 'string'}},
        },
        expectedResultType: 'bool',
      },
    });
    const payload = 'x'.repeat(MAX_RANGE_FANOUT_BYTES / 2);

    const result = evaluateWorkflowPredicateFailClosed(expression, {
      event: {payload},
    });

    expect(result).toEqual({value: false, evaluationFailed: true});
  });

  it('evaluates against a caller-supplied environment', () => {
    const expression = createWorkflowExpression({
      source: 'range(2, 32, 2)',
      check: {mode: 'syntax'},
    });
    const environment = createRangeEnvironment();

    const result = evaluateWorkflowExpressionWithEnvironment(expression, {}, environment);

    expect(result).toEqual([
      2n,
      4n,
      6n,
      8n,
      10n,
      12n,
      14n,
      16n,
      18n,
      20n,
      22n,
      24n,
      26n,
      28n,
      30n,
      32n,
    ]);
  });

  it('treats only the boolean true value as a passing predicate', () => {
    const expression = createWorkflowExpression({
      source: 'event.conclusion',
      check: {
        mode: 'typed',
        typeEnvironment: {
          event: {kind: 'object', fields: {conclusion: 'string'}},
        },
      },
    });

    const result = evaluateWorkflowPredicate(expression, {
      event: {conclusion: 'success'},
    });

    expect(result).toBe(false);
  });

  it('returns true for predicates that evaluate to the boolean true value', () => {
    const expression = createWorkflowExpression({
      source: 'event.conclusion == "success"',
      check: {
        mode: 'typed',
        typeEnvironment: {
          event: {kind: 'object', fields: {conclusion: 'string'}},
        },
      },
    });

    const result = evaluateWorkflowPredicate(expression, {
      event: {conclusion: 'success'},
    });

    expect(result).toBe(true);
  });

  it('returns fail-closed predicate outcomes for clean evaluations', () => {
    const expression = createWorkflowExpression({
      source: 'event.conclusion == "success"',
      check: {
        mode: 'typed',
        typeEnvironment: {
          event: {kind: 'object', fields: {conclusion: 'string'}},
        },
      },
    });

    const result = evaluateWorkflowPredicateFailClosed(expression, {
      event: {conclusion: 'success'},
    });

    expect(result).toEqual({value: true, evaluationFailed: false});
  });

  it('returns condition-false when fail-closed predicate evaluation fails', () => {
    const expression = createWorkflowExpression({
      source: 'event.conclusion == "success"',
      check: {
        mode: 'typed',
        typeEnvironment: {
          event: {kind: 'object', fields: {conclusion: 'string'}},
        },
      },
    });

    const result = evaluateWorkflowPredicateFailClosed(expression, {
      event: {},
    });

    expect(result).toEqual({value: false, evaluationFailed: true});
  });

  it('wraps evaluation errors when supplied values do not match the checked context', () => {
    const expression = createWorkflowExpression({
      source: 'event.conclusion == "success"',
      check: {
        mode: 'typed',
        typeEnvironment: {
          event: {kind: 'object', fields: {conclusion: 'string'}},
        },
      },
    });

    const act = () =>
      evaluateWorkflowPredicate(expression, {
        event: {},
      });

    expect(act).toThrow(WorkflowExpressionEvaluationError);
  });

  it('reads dotted properties from syntax-checked plain objects', () => {
    const expression = createWorkflowExpression({
      source: 'event.pull_request.title',
      check: {mode: 'syntax'},
    });

    const result = evaluateWorkflowExpression(expression, {
      event: {
        pull_request: {
          title: 'Fix auth',
        },
      },
    });

    expect(result).toBe('Fix auth');
  });

  it('returns heterogeneous nested values from syntax-checked plain objects', () => {
    const expression = createWorkflowExpression({
      source: 'event.pull_request',
      check: {mode: 'syntax'},
    });
    const pullRequest = {
      title: 'Fix auth',
      labels: [{name: 'bug'}],
      number: 42,
      draft: false,
      review: {score: 0.95},
    };

    const result = evaluateWorkflowExpression(expression, {
      event: {
        pull_request: pullRequest,
      },
    });

    expect(result).toEqual(pullRequest);
  });

  it('wraps missing paths from syntax-checked plain objects as evaluation errors', () => {
    const expression = createWorkflowExpression({
      source: 'event.nope.deep',
      check: {mode: 'syntax'},
    });

    let error: unknown;
    try {
      evaluateWorkflowExpression(expression, {
        event: {
          pull_request: {
            title: 'Fix auth',
          },
        },
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(WorkflowExpressionEvaluationError);
    expect((error as WorkflowExpressionEvaluationError).reason).toBe('missing-path');
  });

  it('classifies absent context roots as missing paths', () => {
    const expression = createWorkflowExpression({
      source: 'inputs.environment',
      check: {mode: 'syntax'},
    });

    let error: unknown;
    try {
      evaluateWorkflowExpression(expression, {event: {}});
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(WorkflowExpressionEvaluationError);
    expect((error as WorkflowExpressionEvaluationError).reason).toBe('missing-path');
  });

  it('classifies genuine evaluation failures as evaluation errors', () => {
    const expression = createWorkflowExpression({
      source: '1 / 0',
      check: {mode: 'syntax'},
    });

    let error: unknown;
    try {
      evaluateWorkflowExpression(expression, {});
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(WorkflowExpressionEvaluationError);
    expect((error as WorkflowExpressionEvaluationError).reason).toBe('evaluation-error');
  });
});
