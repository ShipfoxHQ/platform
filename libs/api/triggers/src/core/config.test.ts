import * as expression from '@shipfox/expression';
import {evaluateStoredFilter, evaluateTriggerFilter, readConfigInputs} from './config.js';
import type {TriggerSubscription} from './entities/subscription.js';

function subscriptionWithConfig(config: Record<string, unknown>): TriggerSubscription {
  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workflowDefinitionId: crypto.randomUUID(),
    name: 'test',
    source: 'github',
    event: 'push',
    config,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('readConfigInputs', () => {
  test('returns the with object when it is a plain object', () => {
    const inputs = readConfigInputs(subscriptionWithConfig({with: {env: 'staging'}}));

    expect(inputs).toEqual({env: 'staging'});
  });

  test('returns undefined when with is missing', () => {
    const inputs = readConfigInputs(subscriptionWithConfig({on: 'main'}));

    expect(inputs).toBeUndefined();
  });

  test('returns undefined when with is null', () => {
    const inputs = readConfigInputs(subscriptionWithConfig({with: null}));

    expect(inputs).toBeUndefined();
  });

  test('returns undefined when with is an array', () => {
    const inputs = readConfigInputs(subscriptionWithConfig({with: ['env']}));

    expect(inputs).toBeUndefined();
  });

  test('returns undefined when with is a primitive', () => {
    const inputs = readConfigInputs(subscriptionWithConfig({with: 'staging'}));

    expect(inputs).toBeUndefined();
  });
});

describe('evaluateTriggerFilter', () => {
  test('returns matched when filter is missing', () => {
    const result = evaluateTriggerFilter({
      subscription: subscriptionWithConfig({}),
      source: 'github',
      event: 'push',
      payload: {ref: 'refs/heads/main'},
    });

    expect(result).toEqual({kind: 'matched'});
  });

  test('evaluates filter expressions against the event payload and trigger identity', () => {
    const subscription = subscriptionWithConfig({
      filter:
        'event.ref == "refs/heads/main" && event.repository.full_name == "shipfox/platform" && trigger.source == "github" && trigger.event == "push"',
    });

    const matches = evaluateTriggerFilter({
      subscription,
      source: 'github',
      event: 'push',
      payload: {
        ref: 'refs/heads/main',
        repository: {full_name: 'shipfox/platform'},
      },
    });
    const misses = evaluateTriggerFilter({
      subscription,
      source: 'github',
      event: 'push',
      payload: {
        ref: 'refs/heads/main',
        repository: {full_name: 'shipfox/docs'},
      },
    });

    expect(matches).toEqual({kind: 'matched'});
    expect(misses).toEqual({kind: 'filtered'});
  });

  test('passes trigger filters through the field-specific context projection', () => {
    const projectContext = vi.spyOn(expression, 'projectWorkflowPredicateContext');
    const payload = {ref: 'refs/heads/main'};

    try {
      const result = evaluateTriggerFilter({
        subscription: subscriptionWithConfig({filter: 'event.ref == "refs/heads/main"'}),
        source: 'github',
        event: 'push',
        payload,
      });

      expect(result).toEqual({kind: 'matched'});
      expect(projectContext).toHaveBeenCalledWith('trigger.filter', {
        event: payload,
        trigger: {source: 'github', event: 'push'},
      });
    } finally {
      projectContext.mockRestore();
    }
  });

  test('returns filter-error when the stored filter cannot be parsed', () => {
    const subscription = subscriptionWithConfig({filter: 'event.ref == "private-literal" &&'});

    const result = evaluateTriggerFilter({
      subscription,
      source: 'github',
      event: 'push',
      payload: {ref: 'refs/heads/main'},
    });

    expect(result.kind).toBe('filter-error');
    if (result.kind !== 'filter-error') throw new Error('expected filter-error');
    expect(result.diagnostic).toMatchObject({
      version: 1,
      code: 'expression-syntax-invalid',
      summary: 'CEL parse failed',
    });
    expect(JSON.stringify(result.diagnostic)).not.toContain('private-literal');
  });

  test('returns filter-error when filter evaluation throws', () => {
    const subscription = subscriptionWithConfig({filter: 'event.ref.size() > 1'});

    const result = evaluateTriggerFilter({
      subscription,
      source: 'github',
      event: 'push',
      payload: {},
    });

    expect(result).toEqual({
      kind: 'filter-error',
      reason: 'Trigger filter evaluation failed',
      diagnostic: {version: 1, code: 'expression-missing-path', path: 'event.ref'},
    });
  });

  test('preserves the exact unavailable path from the customer trigger expression', () => {
    const subscription = subscriptionWithConfig({
      filter: '!event.pull_request.draft && !trigger.repository.lowerAscii().contains("poc")',
    });

    const result = evaluateTriggerFilter({
      subscription,
      source: 'github',
      event: 'on_pr_opened',
      payload: {pull_request: {draft: false}},
    });

    expect(result).toEqual({
      kind: 'filter-error',
      reason: 'Trigger filter evaluation failed',
      diagnostic: {
        version: 1,
        code: 'expression-missing-path',
        path: 'trigger.repository',
      },
    });
  });

  test('returns filter-error when the stored filter evaluates to a non-boolean value', () => {
    const subscription = subscriptionWithConfig({filter: 'event.ref'});

    const result = evaluateTriggerFilter({
      subscription,
      source: 'github',
      event: 'push',
      payload: {ref: 'refs/heads/main'},
    });

    expect(result).toEqual({
      kind: 'filter-error',
      reason: 'Trigger filter evaluation failed',
      diagnostic: {
        version: 1,
        code: 'expression-result-not-boolean',
        actualType: 'string',
      },
    });
  });

  test.each([
    {name: 'blank', filter: '   '},
    {name: 'non-string', filter: ['event.ref == "refs/heads/main"']},
  ])('returns filter-error when the stored filter is $name', ({filter}) => {
    const subscription = subscriptionWithConfig({filter});

    const result = evaluateTriggerFilter({
      subscription,
      source: 'github',
      event: 'push',
      payload: {ref: 'refs/heads/main'},
    });

    expect(result).toEqual({
      kind: 'filter-error',
      reason: 'Trigger subscription filter must be a non-empty string when set',
      diagnostic: {version: 1, code: 'filter-config-invalid'},
    });
  });
});

describe('evaluateStoredFilter', () => {
  const invalidReason = 'Stored filter must be a non-empty string when set';
  const evaluationFailedReason = 'Stored filter evaluation failed';

  function evaluate(value: unknown, context: Record<string, unknown>) {
    return evaluateStoredFilter({
      value,
      context,
      invalidReason,
      evaluationFailedReason,
      invalidDiagnosticCode: 'filter-config-invalid',
    });
  }

  test('returns matched when filter is missing', () => {
    const result = evaluate(undefined, {event: {ref: 'refs/heads/main'}});

    expect(result).toEqual({kind: 'matched'});
  });

  test('evaluates against the provided context', () => {
    const value = 'event.issue.number == jobs.build.outputs.pr_number';

    const matches = evaluate(value, {
      event: {issue: {number: 42}},
      jobs: {build: {outputs: {pr_number: 42}}},
    });
    const misses = evaluate(value, {
      event: {issue: {number: 7}},
      jobs: {build: {outputs: {pr_number: 42}}},
    });

    expect(matches).toEqual({kind: 'matched'});
    expect(misses).toEqual({kind: 'filtered'});
  });

  test('returns filter-error when the filter cannot be parsed', () => {
    const result = evaluate('event.ref ==', {event: {ref: 'refs/heads/main'}});

    expect(result.kind).toBe('filter-error');
    if (result.kind !== 'filter-error') throw new Error('expected filter-error');
    expect(result.reason).not.toBe('Invalid workflow expression');
  });

  test('returns filter-error when evaluation throws', () => {
    const result = evaluate('jobs.build.outputs.pr_number == 42', {
      event: {issue: {number: 42}},
    });

    expect(result).toEqual({
      kind: 'filter-error',
      reason: evaluationFailedReason,
      diagnostic: {version: 1, code: 'expression-missing-path', path: 'jobs'},
    });
  });

  test('returns bounded index details when a filter reads outside a list', () => {
    const result = evaluateStoredFilter({
      value: 'event.labels[2] == "urgent"',
      context: {event: {labels: ['bug']}},
      invalidReason: 'invalid',
      evaluationFailedReason: 'failed',
      invalidDiagnosticCode: 'filter-config-invalid',
    });

    expect(result).toEqual({
      kind: 'filter-error',
      reason: 'failed',
      diagnostic: {
        version: 1,
        code: 'expression-index-out-of-bounds',
        index: 2,
        size: 1,
      },
    });
  });

  test('returns filter-error when the stored filter evaluates to a non-boolean value', () => {
    const result = evaluate('event.ref', {event: {ref: 'refs/heads/main'}});

    expect(result).toEqual({
      kind: 'filter-error',
      reason: evaluationFailedReason,
      diagnostic: {
        version: 1,
        code: 'expression-result-not-boolean',
        actualType: 'string',
      },
    });
  });

  test.each([
    {name: 'blank', filter: '   '},
    {name: 'non-string', filter: ['event.ref == "refs/heads/main"']},
  ])('returns filter-error when the stored filter is $name', ({filter}) => {
    const result = evaluate(filter, {event: {ref: 'refs/heads/main'}});

    expect(result).toEqual({
      kind: 'filter-error',
      reason: invalidReason,
      diagnostic: {version: 1, code: 'filter-config-invalid'},
    });
  });
});
