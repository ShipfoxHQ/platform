import {createWorkflowExpression} from '../expression/create-workflow-expression.js';
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

  it('does not add caller-supplied functions to the global evaluator', () => {
    const expression = createWorkflowExpression({
      source: 'range(2, 32, 2)',
      check: {mode: 'syntax'},
    });
    // Creating the opt-in evaluator must not register range in the global evaluator.
    createRangeEnvironment();

    const evaluateGlobally = () => evaluateWorkflowExpression(expression, {});

    expect(evaluateGlobally).toThrow(WorkflowExpressionEvaluationError);
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
