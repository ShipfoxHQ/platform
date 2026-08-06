import {render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {workflowJob, workflowJobExecutionDto} from '#test/fixtures/workflow-run.js';
import {JobContextPanel} from './job-context-panel.js';

describe('JobContextPanel', () => {
  test('opens job details in a labelled sheet from the info action', async () => {
    const user = userEvent.setup();
    const job = workflowJob({
      name: 'build',
      runner: ['runner-linux-x64'],
      job_executions: [
        workflowJobExecutionDto({
          status: 'succeeded',
          outputs: {failed_tests: 4},
        }),
      ],
    });
    const execution = job.jobExecutions[0];
    if (!execution) throw new Error('Test fixture is missing a job execution.');

    render(<JobContextPanel job={job} execution={execution} />);

    expect(screen.queryByRole('dialog', {name: 'build'})).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'Inspect job details'}));

    const dialog = await screen.findByRole('dialog', {name: 'build'});
    expect(within(dialog).getByText('Runner')).toBeInTheDocument();
    expect(within(dialog).getAllByText('Outputs')).not.toHaveLength(0);
  });

  test('separates execution-name traces from job condition traces', async () => {
    const user = userEvent.setup();
    const job = workflowJob({
      name: 'build',
      evaluation_trace: [
        {
          expression: 'inputs.environment == "production"',
          roots: ['inputs.environment'],
          fill_target: 'job-activation',
          evaluated_at: '2026-08-05T12:00:00.000Z',
          field: 'job.if',
          value: 'true',
        },
      ],
      job_executions: [
        workflowJobExecutionDto({
          status: 'succeeded',
          evaluation_trace: [
            {
              expression: 'inputs.environment',
              roots: ['inputs.environment'],
              fill_target: 'execution-creation',
              evaluated_at: '2026-08-05T12:00:00.000Z',
              field: 'job.execution_name',
              value: 'production',
            },
          ],
        }),
      ],
    });
    const execution = job.jobExecutions[0];
    if (!execution) throw new Error('Test fixture is missing a job execution.');

    render(<JobContextPanel job={job} execution={execution} />);
    await user.click(screen.getByRole('button', {name: 'Inspect job details'}));

    const dialog = await screen.findByRole('dialog', {name: 'build'});
    expect(
      within(dialog).getByText('Execution name evaluation (1)'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Condition evaluation (1)')).toBeInTheDocument();
  });
});
