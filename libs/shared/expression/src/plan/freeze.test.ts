import {createWorkflowExpression} from '../expression/create-workflow-expression.js';
import {WorkflowTemplateResolutionError} from '../resolver/errors.js';
import {parseWorkflowTemplate} from '../template/parse-workflow-template.js';
import {freezeResolvedFieldAtSite, resolveFieldAtSite} from './freeze.js';
import {planInterpolationField} from './plan-field.js';
import type {ResolvedField} from './resolved-field.js';

const templateOpen = '$' + '{{';
const templateClose = '}' + '}';

function expression(source: string) {
  return createWorkflowExpression({source, check: {mode: 'syntax'}});
}

function plannedField(source: string): ResolvedField {
  const result = planInterpolationField({
    field: 'env.value',
    segments: parseWorkflowTemplate(source),
  });
  if (!result.ok) throw new Error('Expected the test field to be plannable.');
  return result.plan.field;
}

describe('freezeResolvedFieldAtSite', () => {
  it('concatenates literals and filled deferred values in segment order', () => {
    const field: ResolvedField = {
      segments: [
        {kind: 'literal', value: 'run='},
        {
          kind: 'deferred',
          expression: expression('run.id'),
          roots: ['run'],
          fillTarget: 'run-creation',
        },
        {kind: 'literal', value: ',ok='},
        {kind: 'deferred', expression: expression('true'), roots: [], fillTarget: 'run-creation'},
      ],
    };

    const result = freezeResolvedFieldAtSite({
      field,
      failurePolicy: 'fail',
      site: 'run-creation',
      context: {run: {id: 42}},
    });

    expect(result).toEqual({
      value: 'run=42,ok=true',
      diagnostics: [],
      trace: [
        {
          expression: 'run.id',
          roots: ['run'],
          fillTarget: 'run-creation',
          evaluatedAt: 'run-creation',
          value: '42',
        },
        {
          expression: 'true',
          roots: [],
          fillTarget: 'run-creation',
          evaluatedAt: 'run-creation',
          value: 'true',
        },
      ],
    });
  });

  it('preserves the raw value for an opted-in exact single expression', () => {
    const field: ResolvedField = {
      segments: [
        {
          kind: 'deferred',
          expression: expression('cpu'),
          roots: ['cpu'],
          fillTarget: 'run-creation',
        },
      ],
    };

    const result = freezeResolvedFieldAtSite({
      field,
      failurePolicy: 'fail',
      site: 'run-creation',
      context: {cpu: 4},
      preserveSingleExpressionType: true,
    });

    expect(result.value).toBe(4);
  });

  it('keeps mixed literal and expression fields as strings in typed mode', () => {
    const field: ResolvedField = {
      segments: [
        {
          kind: 'deferred',
          expression: expression('cpu'),
          roots: ['cpu'],
          fillTarget: 'run-creation',
        },
        {kind: 'literal', value: 'vcpu'},
      ],
    };

    const result = freezeResolvedFieldAtSite({
      field,
      failurePolicy: 'fail',
      site: 'run-creation',
      context: {cpu: 4},
      preserveSingleExpressionType: true,
    });

    expect(result.value).toBe('4vcpu');
  });

  it('keeps mixed fields on their configured missing-path policy in typed mode', () => {
    const result = freezeResolvedFieldAtSite({
      field: plannedField(`${templateOpen} typo_root.value ${templateClose}-suffix`),
      failurePolicy: 'fail',
      site: 'run-creation',
      context: {},
      preserveSingleExpressionType: true,
    });

    expect(result.value).toBe('-suffix');
    expect(result.diagnostics).toEqual([
      {reason: 'missing-path', expression: 'typo_root.value', contextRoots: ['typo_root']},
    ]);
  });

  it('degrades exact typed fields under the explicit degrade policy', () => {
    const result = freezeResolvedFieldAtSite({
      field: plannedField(`${templateOpen} typo_root.value ${templateClose}`),
      failurePolicy: 'degrade',
      site: 'run-creation',
      context: {},
      preserveSingleExpressionType: true,
    });

    expect(result.value).toBe('');
    expect(result.diagnostics).toEqual([
      {reason: 'missing-path', expression: 'typo_root.value', contextRoots: ['typo_root']},
    ]);
  });

  it('fails exact typed fields that are not fillable at the requested site', () => {
    const act = () =>
      freezeResolvedFieldAtSite({
        field: {
          segments: [
            {
              kind: 'deferred',
              expression: expression('execution.index'),
              roots: ['execution'],
              fillTarget: 'execution-creation',
            },
          ],
        },
        failurePolicy: 'fail',
        site: 'run-creation',
        context: {},
        preserveSingleExpressionType: true,
      });

    expect(act).toThrow(WorkflowTemplateResolutionError);
  });

  it('records exact typed runner-fill fields as server-side diagnostics', () => {
    const field: ResolvedField = {
      segments: [
        {
          kind: 'deferred',
          expression: expression('runner.os'),
          roots: ['runner'],
          fillTarget: 'runner-fill',
        },
      ],
    };

    const frozen = freezeResolvedFieldAtSite({
      field,
      failurePolicy: 'fail',
      site: 'job-resolution',
      context: {runner: {os: 'linux'}},
      preserveSingleExpressionType: true,
    });

    expect(frozen).toEqual({
      value: '',
      diagnostics: [{reason: 'missing-path', expression: 'runner.os', contextRoots: ['runner']}],
      trace: [],
    });
  });

  it('widens the result when the typed-field option is not a literal boolean', () => {
    const preserveTypes: boolean = true;

    const result = freezeResolvedFieldAtSite({
      field: plannedField(`${templateOpen} cpu ${templateClose}`),
      failurePolicy: 'fail',
      site: 'run-creation',
      context: {cpu: 4},
      preserveSingleExpressionType: preserveTypes,
    });

    // @ts-expect-error A runtime boolean flag may produce a non-string raw value.
    const stringValue: string = result.value;
    expect(stringValue).toBe(4);
  });

  it('throws for fail-policy missing paths on known roots available at the site', () => {
    const field: ResolvedField = {
      segments: [
        {
          kind: 'deferred',
          expression: expression('run.missing'),
          roots: ['run'],
          fillTarget: 'run-creation',
        },
      ],
    };

    const act = () =>
      freezeResolvedFieldAtSite({
        field,
        failurePolicy: 'fail',
        site: 'run-creation',
        context: {run: {}},
      });

    expect(act).toThrow(WorkflowTemplateResolutionError);
  });

  it('degrades missing paths under degrade policy', () => {
    const field: ResolvedField = {
      segments: [
        {kind: 'literal', value: 'event='},
        {
          kind: 'deferred',
          expression: expression('event.title'),
          roots: ['event'],
          fillTarget: 'run-creation',
        },
      ],
    };

    const result = freezeResolvedFieldAtSite({
      field,
      failurePolicy: 'degrade',
      site: 'run-creation',
      context: {event: {}},
    });

    expect(result).toEqual({
      value: 'event=',
      diagnostics: [{reason: 'missing-path', expression: 'event.title', contextRoots: ['event']}],
      trace: [
        {
          expression: 'event.title',
          roots: ['event'],
          fillTarget: 'run-creation',
          evaluatedAt: 'run-creation',
          value: '',
          degraded: true,
        },
      ],
    });
  });

  it('still throws non-missing-path evaluation errors under degrade policy', () => {
    const field: ResolvedField = {
      segments: [
        {kind: 'deferred', expression: expression('1 / 0'), roots: [], fillTarget: 'run-creation'},
      ],
    };

    const act = () =>
      freezeResolvedFieldAtSite({
        field,
        failurePolicy: 'degrade',
        site: 'run-creation',
        context: {},
      });

    expect(act).toThrow(WorkflowTemplateResolutionError);
  });

  it('degrades fail-policy missing paths when the segment has only unknown roots', () => {
    const field: ResolvedField = {
      segments: [
        {
          kind: 'deferred',
          expression: expression('typo_root.value'),
          roots: ['typo_root'],
          fillTarget: 'run-creation',
        },
      ],
    };

    const result = freezeResolvedFieldAtSite({
      field,
      failurePolicy: 'fail',
      site: 'run-creation',
      context: {},
    });

    expect(result).toEqual({
      value: '',
      diagnostics: [
        {reason: 'missing-path', expression: 'typo_root.value', contextRoots: ['typo_root']},
      ],
      trace: [
        {
          expression: 'typo_root.value',
          roots: ['typo_root'],
          fillTarget: 'run-creation',
          evaluatedAt: 'run-creation',
          value: '',
          degraded: true,
        },
      ],
    });
  });

  it('throws for fail-policy missing paths when over-included roots include a non-workflow root', () => {
    const field: ResolvedField = {
      segments: [
        {
          kind: 'deferred',
          expression: expression('{foo: event.ref}.foo'),
          roots: ['event', 'foo'],
          fillTarget: 'run-creation',
        },
      ],
    };

    const act = () =>
      freezeResolvedFieldAtSite({
        field,
        failurePolicy: 'fail',
        site: 'run-creation',
        context: {event: {}},
      });

    expect(act).toThrow(WorkflowTemplateResolutionError);
  });

  it('throws for fail-policy missing paths on reserved server roots available at the site', () => {
    const field: ResolvedField = {
      segments: [
        {
          kind: 'deferred',
          expression: expression('steps.build.output'),
          roots: ['steps'],
          fillTarget: 'step-report',
        },
      ],
    };

    const act = () =>
      freezeResolvedFieldAtSite({
        field,
        failurePolicy: 'fail',
        site: 'step-report',
        context: {steps: {}},
      });

    expect(act).toThrow(WorkflowTemplateResolutionError);
  });

  it('skips deferred-past-site segments without evaluating their expression', () => {
    const field: ResolvedField = {
      segments: [
        {
          kind: 'deferred',
          expression: expression('1 / 0 + execution.index'),
          roots: ['execution'],
          fillTarget: 'execution-creation',
        },
      ],
    };

    const result = freezeResolvedFieldAtSite({
      field,
      failurePolicy: 'fail',
      site: 'run-creation',
      context: {},
    });

    expect(result).toEqual({
      value: '',
      diagnostics: [
        {
          reason: 'missing-path',
          expression: '1 / 0 + execution.index',
          contextRoots: ['execution'],
        },
      ],
      trace: [],
    });
  });

  it('skips runner-fill segments server-side', () => {
    const field: ResolvedField = {
      segments: [
        {
          kind: 'deferred',
          expression: expression('runner.os'),
          roots: ['runner'],
          fillTarget: 'runner-fill',
        },
      ],
    };

    const result = freezeResolvedFieldAtSite({
      field,
      failurePolicy: 'fail',
      site: 'job-resolution',
      context: {runner: {os: 'linux'}},
    });

    expect(result).toEqual({
      value: '',
      diagnostics: [{reason: 'missing-path', expression: 'runner.os', contextRoots: ['runner']}],
      trace: [],
    });
  });
});

describe('resolveFieldAtSite', () => {
  it('preserves boolean values when resolving an exact single expression', () => {
    const field: ResolvedField = {
      segments: [
        {
          kind: 'deferred',
          expression: expression('public'),
          roots: ['public'],
          fillTarget: 'run-creation',
        },
      ],
    };

    const result = resolveFieldAtSite({
      field,
      failurePolicy: 'fail',
      site: 'run-creation',
      context: {public: false},
      preserveSingleExpressionType: true,
    });

    expect(result).toMatchObject({kind: 'frozen', value: false});
  });

  it('applies typed rendering to parsed template fields', () => {
    const exactField = plannedField(`${templateOpen} cpu ${templateClose}`);
    const mixedField = plannedField(`${templateOpen} cpu ${templateClose}vcpu`);

    const exact = resolveFieldAtSite({
      field: exactField,
      failurePolicy: 'fail',
      site: 'run-creation',
      context: {cpu: 4},
      preserveSingleExpressionType: true,
    });
    const mixed = resolveFieldAtSite({
      field: mixedField,
      failurePolicy: 'fail',
      site: 'run-creation',
      context: {cpu: 4},
      preserveSingleExpressionType: true,
    });

    expect(exact).toMatchObject({kind: 'frozen', value: 4});
    expect(mixed).toMatchObject({kind: 'frozen', value: '4vcpu'});
  });

  it('fails typed fields instead of degrading an unknown missing path to an empty string', () => {
    const field = plannedField(`${templateOpen} cpu ${templateClose}`);
    const resolve = () =>
      resolveFieldAtSite({
        field,
        failurePolicy: 'fail',
        site: 'run-creation',
        context: {},
        preserveSingleExpressionType: true,
      });

    expect(resolve).toThrow(WorkflowTemplateResolutionError);
  });

  it('leaves exact typed runner-fill fields for the runner', () => {
    const field: ResolvedField = {
      segments: [
        {
          kind: 'deferred',
          expression: expression('runner.os'),
          roots: ['runner'],
          fillTarget: 'runner-fill',
        },
      ],
    };

    const result = resolveFieldAtSite({
      field,
      failurePolicy: 'fail',
      site: 'job-resolution',
      context: {runner: {os: 'linux'}},
      preserveSingleExpressionType: true,
    });

    expect(result).toEqual({kind: 'residual', field, diagnostics: [], trace: []});
  });
});
