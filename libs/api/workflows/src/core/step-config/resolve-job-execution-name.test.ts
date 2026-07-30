import {workflowModel} from '#test/index.js';
import {resolveJobExecutionName} from './resolve-job-execution-name.js';

function template(source: string): string {
  return `\${{ ${source} }}`;
}

describe('resolveJobExecutionName', () => {
  it('resolves an interpolated execution name at execution creation', () => {
    const [job] = workflowModel({
      jobs: {
        deploy: {
          executionName: `Deploy ${template('inputs.environment')}`,
          steps: [{run: 'echo deploy'}],
        },
      },
    }).jobs;
    if (!job) throw new Error('Missing deploy job');

    const result = resolveJobExecutionName({
      definitionId: 'definition-1',
      job,
      context: {inputs: {environment: 'prod'}},
    });

    expect(result).toMatchObject({
      nameOverride: 'Deploy prod',
      trace: [
        {
          field: 'job.execution_name',
          expression: 'inputs.environment',
          roots: ['inputs'],
          fillTarget: 'execution-creation',
          evaluatedAt: 'execution-creation',
          value: 'prod',
        },
      ],
    });
  });

  it('falls back when the name template resolves to an empty string', () => {
    const [job] = workflowModel({
      jobs: {
        deploy: {
          executionName: template('inputs.environment'),
          steps: [{run: 'echo deploy'}],
        },
      },
    }).jobs;
    if (!job) throw new Error('Missing deploy job');

    const result = resolveJobExecutionName({
      definitionId: 'definition-1',
      job,
      context: {inputs: {environment: ''}},
    });

    expect(result).toMatchObject({
      nameOverride: null,
      trace: [
        {
          field: 'job.execution_name',
          expression: 'inputs.environment',
          roots: ['inputs'],
          fillTarget: 'execution-creation',
          evaluatedAt: 'execution-creation',
          value: '',
        },
      ],
    });
  });

  it('falls back to the static job name when no execution name template exists', () => {
    const [job] = workflowModel({
      jobs: {deploy: {steps: [{run: 'echo deploy'}]}},
    }).jobs;
    if (!job) throw new Error('Missing deploy job');

    const result = resolveJobExecutionName({
      definitionId: 'definition-1',
      job,
      context: {},
    });

    expect(result).toEqual({nameOverride: null, trace: []});
  });

  it('falls back when execution-name evaluation fails', () => {
    const [job] = workflowModel({
      jobs: {
        deploy: {
          executionName: template('inputs.environment.missing'),
          steps: [{run: 'echo deploy'}],
        },
      },
    }).jobs;
    if (!job) throw new Error('Missing deploy job');

    const result = resolveJobExecutionName({
      definitionId: 'definition-1',
      job,
      context: {inputs: null},
    });

    expect(result).toMatchObject({
      nameOverride: null,
      trace: [
        expect.objectContaining({
          field: 'job.execution_name',
          expression: 'inputs.environment.missing',
          degraded: true,
        }),
      ],
    });
  });
});
