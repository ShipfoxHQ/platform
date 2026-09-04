import type {WorkflowStepKind} from '@shipfox/expression';
import {
  type ExpressionTypeEnvironment,
  getWorkflowPredicateFieldMinimumFillTarget,
} from '@shipfox/expression';
import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {validatePredicateExpression} from './validate-predicate-expression.js';

function validate(params: {
  source: string;
  field: Parameters<typeof validatePredicateExpression>[0]['field'];
  allowedJobReferences?: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment;
  stepKind?: WorkflowStepKind;
}): {
  readonly expression: ReturnType<typeof validatePredicateExpression>;
  readonly issues: WorkflowModelValidationIssue[];
} {
  const issues: WorkflowModelValidationIssue[] = [];
  const expression = validatePredicateExpression({
    field: params.field,
    source: params.source,
    path: ['predicate'],
    invalidCode: 'invalid-job-success',
    invalidMessage: 'Predicate must be a valid CEL boolean expression.',
    issues,
    ...(params.allowedJobReferences === undefined
      ? {}
      : {allowedJobReferences: params.allowedJobReferences}),
    ...(params.typeOverlay === undefined ? {} : {typeOverlay: params.typeOverlay}),
    ...(params.stepKind === undefined ? {} : {stepKind: params.stepKind}),
  });

  return {expression, issues};
}

describe('validatePredicateExpression', () => {
  it('uses the tool step gate environment when the step kind is tool', () => {
    const valid = validate({
      field: 'step.success',
      source: 'step.status == "succeeded"',
      stepKind: 'tool',
    });
    const invalid = validate({
      field: 'step.success',
      source: 'step.exit_code == 0',
      stepKind: 'tool',
    });

    expect(valid.issues).toEqual([]);
    expect(valid.expression).toMatchObject({source: 'step.status == "succeeded"'});
    expect(invalid.expression).toBeUndefined();
    expect(invalid.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-job-success',
        details: expect.objectContaining({source: 'step.exit_code == 0'}),
      }),
    ]);
  });

  it.each([
    ['event.ref == "refs/heads/main"', 'syntax'],
    ['trigger.event == "push"', 'typed'],
    ['has(event.ref)', 'syntax'],
  ] as const)('accepts trigger filters at ingest: %s', (source, check) => {
    const result = validate({field: 'trigger.filter', source});

    expect(result.issues).toEqual([]);
    expect(result.expression).toMatchObject({source, check});
  });

  it.each([
    ['event.ref', 'Predicate source must be boolean-shaped.'],
    ['trigger.event', 'must return bool'],
  ])('rejects non-boolean trigger filters: %s', (source, reason) => {
    const result = validate({field: 'trigger.filter', source});

    expect(result.expression).toBeUndefined();
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-job-success',
        details: expect.objectContaining({
          source,
          reason: expect.stringContaining(reason),
        }),
      }),
    ]);
  });

  it.each([
    'run.id == "run-1"',
    'inputs.env == "prod"',
    'jobs.build.status == "succeeded"',
    'vars.ENV == "prod"',
  ])('rejects trigger filter roots that are unavailable at ingest: %s', (source) => {
    const result = validate({field: 'trigger.filter', source});

    expect(result.expression).toBeUndefined();
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'context-unavailable-at-predicate-site',
        details: expect.objectContaining({field: 'trigger.filter', source, site: 'ingest'}),
      }),
    ]);
  });

  it('rejects trigger reference fields that are not present while a trigger filter runs', () => {
    const source = 'trigger.repository.lowerAscii().contains("poc")';

    const result = validate({field: 'trigger.filter', source});

    expect(result.expression).toBeUndefined();
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-job-success',
        details: expect.objectContaining({source, reason: expect.stringContaining('repository')}),
      }),
    ]);
  });

  it.each([
    ['runner.os == "linux"', 'runner-context-in-server-predicate'],
  ])('rejects forbidden server predicate roots: %s', (source, code) => {
    const result = validate({field: 'trigger.filter', source});

    expect(result.expression).toBeUndefined();
    expect(result.issues).toEqual([
      expect.objectContaining({
        code,
        details: expect.objectContaining({field: 'trigger.filter', source}),
      }),
    ]);
  });

  it.each([
    ['job.if', 'job-activation'],
    ['step.if', 'step-dispatch'],
    ['step.success', 'step-report'],
    ['job.success', 'job-resolution'],
    ['listener.on', 'job-activation'],
    ['listener.until', 'job-activation'],
  ] as const)('accepts vars in %s at its evaluation site', (field, site) => {
    expect(getWorkflowPredicateFieldMinimumFillTarget(field)).toBe(site);
    const result = validate({
      field,
      source: 'vars.ENABLED == "true"',
    });

    expect(result.issues).toEqual([]);
    expect(result.expression).toMatchObject({source: 'vars.ENABLED == "true"'});
  });

  it.each([
    ['step.success', 'step.status == "succeeded"'],
    ['job.success', 'executions.all(e, e.status == "succeeded")'],
    ['trigger.filter', 'event.action == "created"'],
    ['listener.on', 'trigger.event == "pull_request"'],
    ['listener.until', 'job.key == "await-review"'],
    ['job.if', 'needs.exists(n, n.status == "succeeded")'],
    ['step.if', 'execution.status == "running"'],
  ] as const)('accepts the runtime context contract for %s', (field, source) => {
    const result = validate({field, source});

    expect(result.issues).toEqual([]);
    expect(result.expression).toMatchObject({source});
  });

  it('accepts run.attempt in the typed predicate context', () => {
    const result = validate({field: 'job.if', source: 'run.attempt >= 1'});

    expect(result.issues).toEqual([]);
    expect(result.expression).toMatchObject({source: 'run.attempt >= 1', check: 'typed'});
  });

  it.each([
    [
      'step.success',
      'step-report',
      'jobs.build.status == "succeeded"',
      'jobs',
      'Step gate success',
    ],
    ['job.success', 'job-resolution', 'step.status == "succeeded"', 'step', 'Job success'],
    ['trigger.filter', 'ingest', 'run.id == "run-1"', 'run', 'Trigger filter'],
    [
      'listener.on',
      'job-activation',
      'execution.status == "waiting"',
      'execution',
      'Listener on filter',
    ],
    [
      'listener.until',
      'job-activation',
      'execution.status == "waiting"',
      'execution',
      'Listener until filter',
    ],
    ['job.if', 'job-activation', 'execution.status == "running"', 'execution', 'Job if'],
    ['step.if', 'step-dispatch', 'run.id == "run-1"', 'run', 'Step if'],
  ] as const)('rejects roots omitted from the %s runtime context', (field, site, source, root, label) => {
    const result = validate({field, source});

    expect(result.expression).toBeUndefined();
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'context-unavailable-at-predicate-site',
        message: expect.stringContaining(
          `"${root}" that is not supplied when ${label} is evaluated at`,
        ),
        details: expect.objectContaining({
          field,
          source,
          unavailableRoots: [root],
          site,
        }),
      }),
    ]);
  });

  it.each([
    ['listener.on', 'event.action == "created"', undefined],
    ['listener.on', 'run.id == "run-1"', undefined],
    ['listener.on', 'trigger.event == "pull_request"', undefined],
    ['listener.until', 'inputs.target == event.issue.number', undefined],
    ['listener.until', 'vars.ENABLED == "true"', undefined],
    ['listener.until', 'job.key == "await-review"', undefined],
    ['listener.until', 'jobs.build.outputs.pr_number == event.issue.number', new Set(['build'])],
    ['listener.until', 'has(jobs.build.outputs.pr_number)', new Set(['build'])],
  ] as const)('accepts listener filters at job activation: %s %s', (field, source, allowedJobs) => {
    const result = validate({
      field,
      source,
      ...(allowedJobs === undefined ? {} : {allowedJobReferences: allowedJobs}),
    });

    expect(result.issues).toEqual([]);
    expect(result.expression).toMatchObject({source});
  });

  it.each([
    'step.status == "succeeded"',
    'steps.build.outputs.sha == "abc"',
  ])('rejects listener roots that are unavailable at job activation: %s', (source) => {
    const result = validate({field: 'listener.on', source});

    expect(result.expression).toBeUndefined();
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'context-unavailable-at-predicate-site',
        details: expect.objectContaining({field: 'listener.on', source, site: 'job-activation'}),
      }),
    ]);
  });

  it.each([
    ['listener.on', 'executions.size() > 0', 'executions'],
    ['listener.until', 'execution.status == "waiting"', 'execution'],
    ['listener.on', 'needs.size() > 0', 'needs'],
    ['listener.until', 'matrix.os == "linux"', 'matrix'],
    ['job.if', 'job.key == "build"', 'job'],
    ['job.if', 'executions.size() > 0', 'executions'],
    ['step.if', 'run.id == "run-1"', 'run'],
    ['step.success', 'execution.status == "failed"', 'execution'],
    ['job.success', 'run.id == "run-1"', 'run'],
  ] as const)('rejects %s context that its runtime evaluator does not supply: %s', (field, source, unavailableRoot) => {
    const result = validate({field, source});

    expect(result.expression).toBeUndefined();
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'context-unavailable-at-predicate-site',
        details: expect.objectContaining({
          field,
          source,
          unavailableRoots: [unavailableRoot],
        }),
      }),
    ]);
  });

  it.each([
    ['step.if', 'step.exit_code == 0'],
    ['step.success', 'step.attempt > 1'],
    ['job.success', 'executions.exists(e, e.failed)'],
  ] as const)('rejects %s properties absent from its runtime shape: %s', (field, source) => {
    const result = validate({field, source, typeOverlay: {}});

    expect(result.expression).toBeUndefined();
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-job-success',
        details: expect.objectContaining({
          field,
          source,
          reason: expect.stringContaining('No such key'),
        }),
      }),
    ]);
  });

  it('still checks typed properties when a predicate also uses open context', () => {
    const result = validate({
      field: 'step.success',
      source: 'step.attempt > 1 && vars.RETRY == "true"',
    });

    expect(result.expression).toBeUndefined();
    expect(result.issues).toEqual([
      expect.objectContaining({
        details: expect.objectContaining({
          reason: expect.stringContaining('No such key: attempt'),
        }),
      }),
    ]);
  });

  it('rejects listener job references without a direct needs edge', () => {
    const result = validate({
      field: 'listener.on',
      source: 'jobs.build.outputs.pr_number == event.issue.number',
      allowedJobReferences: new Set(['test']),
    });

    expect(result.expression).toBeUndefined();
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'missing-job-needs-edge',
        details: expect.objectContaining({field: 'listener.on', job: 'build'}),
      }),
    ]);
  });

  it('keeps existing job success syntax-only behavior unchanged', () => {
    const result = validate({
      field: 'job.success',
      source: 'jobs.build.outputs.ready',
    });

    expect(result.issues).toEqual([]);
    expect(result.expression).toMatchObject({
      source: 'jobs.build.outputs.ready',
      check: 'syntax',
    });
  });
});
