import {workflowModel} from '#test/index.js';
import {listenerPriorExecutionEventsRequired} from './listener-prior-execution-context.js';

function template(source: string): string {
  return `\${{ ${source} }}`;
}

describe('listenerPriorExecutionEventsRequired', () => {
  test('omits prior event arrays when no authored expression needs executions', () => {
    const model = workflowModel({
      jobs: {
        review: {
          success: 'vars.should_succeed == "true"',
          steps: [{run: 'echo review'}],
        },
      },
    });

    expect(listenerPriorExecutionEventsRequired({model, jobKey: 'review'})).toBe(false);
  });

  test('keeps prior event arrays for job success expressions over executions', () => {
    const model = workflowModel({
      jobs: {
        review: {
          success: 'executions.all(e, e.status == "succeeded")',
          steps: [{run: 'echo review'}],
        },
      },
    });

    expect(listenerPriorExecutionEventsRequired({model, jobKey: 'review'})).toBe(true);
  });

  test('keeps prior event arrays for a persisted success expression absent from the model', () => {
    const model = workflowModel({
      jobs: {
        review: {
          steps: [{run: 'echo review'}],
        },
      },
    });

    expect(
      listenerPriorExecutionEventsRequired({
        model,
        jobKey: 'review',
        success: 'executions[0].events[0].data.action == "opened"',
      }),
    ).toBe(true);
  });

  test('keeps prior event arrays for deferred execution names and runner selectors', () => {
    const model = workflowModel({
      jobs: {
        review: {
          executionName: template('executions[0].events[0].data.name'),
          runnerTemplates: [template('executions[0].events[0].data.runner')],
          steps: [{run: 'echo review'}],
        },
      },
    });

    expect(listenerPriorExecutionEventsRequired({model, jobKey: 'review'})).toBe(true);
  });

  test('keeps prior event arrays for deferred workflow environment config', () => {
    const model = workflowModel({
      env: {REGION: template('executions[0].events[0].data.region')},
      jobs: {
        review: {
          steps: [{run: 'echo review'}],
        },
      },
    });

    expect(listenerPriorExecutionEventsRequired({model, jobKey: 'review'})).toBe(true);
  });

  test('keeps the full shape when the persisted model has no matching job', () => {
    expect(listenerPriorExecutionEventsRequired({model: workflowModel(), jobKey: 'missing'})).toBe(
      true,
    );
  });
});
