import type {ExpressionTypeEnvironment} from '@shipfox/expression';
import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {validatePredicateExpression} from './validate-predicate-expression.js';

function validate(params: {
  source: string;
  field: Parameters<typeof validatePredicateExpression>[0]['field'];
  site: Parameters<typeof validatePredicateExpression>[0]['site'];
  allowedJobReferences?: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment;
}): {
  readonly expression: ReturnType<typeof validatePredicateExpression>;
  readonly issues: WorkflowModelValidationIssue[];
} {
  const issues: WorkflowModelValidationIssue[] = [];
  const expression = validatePredicateExpression({
    field: params.field,
    source: params.source,
    site: params.site,
    path: ['predicate'],
    invalidCode: 'invalid-job-success',
    invalidMessage: 'Predicate must be a valid CEL boolean expression.',
    issues,
    ...(params.allowedJobReferences === undefined
      ? {}
      : {allowedJobReferences: params.allowedJobReferences}),
    ...(params.typeOverlay === undefined ? {} : {typeOverlay: params.typeOverlay}),
  });

  return {expression, issues};
}

describe('validatePredicateExpression', () => {
  it.each([
    ['event.ref == "refs/heads/main"', 'syntax'],
    ['trigger.event == "push"', 'typed'],
    ['has(event.ref)', 'syntax'],
  ] as const)('accepts trigger filters at ingest: %s', (source, check) => {
    const result = validate({field: 'trigger.filter', source, site: 'ingest'});

    expect(result.issues).toEqual([]);
    expect(result.expression).toMatchObject({source, check});
  });

  it.each([
    ['event.ref', 'Predicate source must be boolean-shaped.'],
    ['trigger.event', 'must return bool'],
  ])('rejects non-boolean trigger filters: %s', (source, reason) => {
    const result = validate({field: 'trigger.filter', source, site: 'ingest'});

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
    const result = validate({field: 'trigger.filter', source, site: 'ingest'});

    expect(result.expression).toBeUndefined();
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'context-unavailable-at-predicate-site',
        details: expect.objectContaining({field: 'trigger.filter', source, site: 'ingest'}),
      }),
    ]);
  });

  it.each([
    ['runner.os == "linux"', 'runner-context-in-server-predicate'],
  ])('rejects forbidden server predicate roots: %s', (source, code) => {
    const result = validate({field: 'trigger.filter', source, site: 'ingest'});

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
    const result = validate({
      field,
      source: 'vars.ENABLED == "true"',
      site,
    });

    expect(result.issues).toEqual([]);
    expect(result.expression).toMatchObject({source: 'vars.ENABLED == "true"'});
  });

  it.each([
    ['step.success', 'step-report', 'step.status == "succeeded"'],
    ['job.success', 'job-resolution', 'executions.all(e, e.status == "succeeded")'],
    ['trigger.filter', 'ingest', 'event.action == "created"'],
    ['listener.on', 'job-activation', 'trigger.event == "pull_request"'],
    ['listener.until', 'job-activation', 'job.key == "await-review"'],
    ['job.if', 'job-activation', 'needs.exists(n, n.status == "succeeded")'],
    ['step.if', 'step-dispatch', 'execution.status == "running"'],
  ] as const)('accepts the runtime context contract for %s', (field, site, source) => {
    const result = validate({field, source, site});

    expect(result.issues).toEqual([]);
    expect(result.expression).toMatchObject({source});
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
    const result = validate({field, source, site});

    expect(result.expression).toBeUndefined();
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'context-unavailable-at-predicate-site',
        message: expect.stringContaining(`"${root}" is not supplied to ${label}.`),
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
      site: 'job-activation',
      ...(allowedJobs === undefined ? {} : {allowedJobReferences: allowedJobs}),
    });

    expect(result.issues).toEqual([]);
    expect(result.expression).toMatchObject({source});
  });

  it.each([
    'step.status == "succeeded"',
    'steps.build.outputs.sha == "abc"',
  ])('rejects listener roots that are unavailable at job activation: %s', (source) => {
    const result = validate({field: 'listener.on', source, site: 'job-activation'});

    expect(result.expression).toBeUndefined();
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'context-unavailable-at-predicate-site',
        details: expect.objectContaining({field: 'listener.on', source, site: 'job-activation'}),
      }),
    ]);
  });

  it('rejects listener job references without a direct needs edge', () => {
    const result = validate({
      field: 'listener.on',
      source: 'jobs.build.outputs.pr_number == event.issue.number',
      site: 'job-activation',
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
      site: 'job-resolution',
    });

    expect(result.issues).toEqual([]);
    expect(result.expression).toMatchObject({
      source: 'jobs.build.outputs.ready',
      check: 'syntax',
    });
  });
});
