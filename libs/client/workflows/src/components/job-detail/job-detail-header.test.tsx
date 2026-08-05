import {render, screen} from '@testing-library/react';
import {workflowJob, workflowJobExecutionDto} from '#test/fixtures/workflow-run.js';
import {JobDetailHeader} from './job-detail-header.js';

describe('JobDetailHeader', () => {
  test('labels a live run duration as running', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-06-26T12:00:00.000Z'));
    const job = workflowJob({
      status: 'running',
      job_executions: [
        workflowJobExecutionDto({
          status: 'running',
          queued_at: '2026-06-26T11:54:00.000Z',
          started_at: '2026-06-26T11:57:46.000Z',
        }),
      ],
    });
    const execution = job.jobExecutions[0];
    if (!execution) throw new Error('Expected a job execution');

    render(
      <JobDetailHeader
        job={job}
        selectedJobExecution={execution}
        onSelectedJobExecutionChange={vi.fn()}
        workspaceSlug="acme"
        projectSlug="project"
        workflowRunId="run-1"
      />,
    );

    expect(screen.getByText('running', {exact: true})).toBeInTheDocument();
  });
});
