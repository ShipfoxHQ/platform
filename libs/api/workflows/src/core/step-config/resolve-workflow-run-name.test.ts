import {workflowModel} from '#test/index.js';
import {resolveWorkflowRunName, sanitizeWorkflowDisplayText} from './resolve-workflow-run-name.js';

function template(source: string): string {
  return `\${{ ${source} }}`;
}

describe('resolveWorkflowRunName', () => {
  it('leaves an omitted run name unset', () => {
    expect(
      resolveWorkflowRunName({
        runName: undefined,
        context: {},
      }),
    ).toEqual({value: null, trace: []});
  });

  it('resolves a run name from trigger-event context', () => {
    const model = workflowModel({runName: `Deploy ${template('event.environment')}`});

    const result = resolveWorkflowRunName({
      runName: model.runName,
      context: {event: {environment: 'production'}},
    });

    expect(result).toMatchObject({
      value: 'Deploy production',
      trace: [
        {
          field: 'workflow.run_name',
          expression: 'event.environment',
          evaluatedAt: 'run-creation',
          value: 'production',
        },
      ],
    });
    expect(result.degradation).toBeUndefined();
  });

  it('loads and resolves input values through the same creation context', () => {
    const model = workflowModel({runName: `Deploy ${template('inputs.environment')}`});

    const result = resolveWorkflowRunName({
      runName: model.runName,
      context: {inputs: {environment: 'staging'}},
    });

    expect(result.value).toBe('Deploy staging');
  });

  it.each([
    [{event: {}}, 'missing_value'],
    [{event: {environment: ''}}, 'empty_value'],
  ] as const)('falls back without throwing for %s', (context, cause) => {
    const model = workflowModel({runName: template('event.environment')});

    const result = resolveWorkflowRunName({
      runName: model.runName,
      context,
    });

    expect(result).toMatchObject({value: null, degradation: {cause}});
  });

  it('sanitizes control and format characters without failing the run', () => {
    const model = workflowModel({runName: template('event.environment')});

    const result = resolveWorkflowRunName({
      runName: model.runName,
      context: {event: {environment: 'prod\u202e\nblue'}},
    });

    expect(result).toMatchObject({
      value: 'prod  blue',
      degradation: {cause: 'sanitization'},
    });
  });

  it('degrades when expression evaluation throws', () => {
    const model = workflowModel({runName: template('1 / 0')});

    const result = resolveWorkflowRunName({
      runName: model.runName,
      context: {},
    });

    expect(result).toMatchObject({
      value: null,
      degradation: {cause: 'evaluation_error', expression: '1 / 0'},
    });
  });

  it('degrades when sanitization removes the complete resolved value', () => {
    const model = workflowModel({runName: template('event.environment')});

    const result = resolveWorkflowRunName({
      runName: model.runName,
      context: {event: {environment: '\u200b'}},
    });

    expect(result).toMatchObject({value: null, degradation: {cause: 'sanitization'}});
  });
});

describe('sanitizeWorkflowDisplayText', () => {
  it('trims and bounds display text', () => {
    expect(sanitizeWorkflowDisplayText(`  ${'a'.repeat(300)}  `)).toBe('a'.repeat(255));
  });
});
