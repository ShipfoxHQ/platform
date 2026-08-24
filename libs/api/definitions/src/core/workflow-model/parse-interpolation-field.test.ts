import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {parseInterpolationField} from './parse-interpolation-field.js';

function parse(params: {
  field: Parameters<typeof parseInterpolationField>[0]['field'];
  source: string;
  fillSite?: Parameters<typeof parseInterpolationField>[0]['fillSite'];
}) {
  const issues: WorkflowModelValidationIssue[] = [];
  const template = parseInterpolationField({
    field: params.field,
    source: params.source,
    path: ['test'],
    issues,
    ...(params.fillSite === undefined ? {} : {fillSite: params.fillSite}),
  });

  return {issues, template};
}

describe('parseInterpolationField', () => {
  it('accepts the reserved result root in tool output mappings', () => {
    const result = parse({
      field: 'tool.outputs',
      source: '$' + '{{ result.channel }}',
      fillSite: 'step-report',
    });

    expect(result.issues).toEqual([]);
    expect(result.template).toMatchObject([{kind: 'deferred', roots: ['result']}]);
  });

  it('rejects roots outside the tool output field contract', () => {
    const result = parse({
      field: 'tool.outputs',
      source: '$' + '{{ steps.previous.outputs.value }}',
      fillSite: 'step-report',
    });

    expect(result.template).toMatchObject([{kind: 'deferred', roots: ['steps']}]);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'unknown-interpolation-context',
        details: expect.objectContaining({unknownRoots: ['steps']}),
      }),
    ]);
  });

  it('uses dispatch-time step fields for tool inputs', () => {
    const valid = parse({
      field: 'tool.with',
      source: '$' + '{{ step.attempt }}',
      fillSite: 'step-dispatch',
    });
    const invalid = parse({
      field: 'tool.with',
      source: '$' + '{{ step.status }}',
      fillSite: 'step-dispatch',
    });

    expect(valid.issues).toEqual([]);
    expect(valid.template).toMatchObject([{kind: 'deferred', roots: ['step']}]);
    expect(invalid.template).toMatchObject([{kind: 'deferred', roots: ['step']}]);
    expect(invalid.issues).toEqual([
      expect.objectContaining({code: 'invalid-interpolation-expression'}),
    ]);
  });
});
