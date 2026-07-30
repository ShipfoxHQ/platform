import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {workflowJob, workflowJobExecutionDto} from '#test/fixtures/workflow-run.js';
import {JobCard} from './job-card.js';
import {JobExecutionSwitcher} from './job-execution-switcher.js';

const WORKSPACE_ID = '44444444-4444-4444-8444-444444444444';
const FIRST_EXECUTION_ACCESSIBLE_NAME =
  /Execution #1: Review PR #476, Failed, validation failed, duration 1m 55s/;
const SECOND_EXECUTION_MENU_ITEM = /Execution #2: Review PR #479/;

describe('JobCard execution names', () => {
  test('shows the resolved execution name and sequence', () => {
    const job = workflowJob({
      key: 'deploy',
      name: 'Deploy application',
      job_executions: [
        workflowJobExecutionDto({
          name: 'Deploy production',
          sequence: 1,
        }),
      ],
    });
    const execution = job.jobExecutions[0];
    if (!execution) throw new Error('Expected a job execution');

    render(
      <JobCard
        workspaceId={WORKSPACE_ID}
        job={job}
        selectedJobExecution={execution}
        selectedAttemptId={null}
        onSelectedJobExecutionChange={undefined}
        onSelectedAttemptChange={undefined}
      />,
    );

    expect(screen.getByRole('heading', {name: 'Deploy production'})).toBeInTheDocument();
    expect(screen.getByText('Execution #1')).toBeInTheDocument();
    expect(screen.queryByText('Deploy application')).not.toBeInTheDocument();
  });

  test('does not use the static job name when no execution exists', () => {
    const job = workflowJob({
      key: 'deploy',
      name: 'Deploy application',
      job_executions: [],
    });

    render(
      <JobCard
        workspaceId={WORKSPACE_ID}
        job={job}
        selectedJobExecution={undefined}
        selectedAttemptId={null}
        onSelectedJobExecutionChange={undefined}
        onSelectedAttemptChange={undefined}
      />,
    );

    expect(screen.queryByRole('heading', {name: 'Deploy application'})).not.toBeInTheDocument();
    expect(screen.getByText('Waiting for this job to start')).toBeInTheDocument();
  });
});

describe('JobExecutionSwitcher execution names', () => {
  test('uses each listening execution name while keeping its sequence and status', async () => {
    const user = userEvent.setup();
    const job = workflowJob({
      key: 'reviews',
      name: 'Process review',
      mode: 'listening',
      status: 'running',
      listener_status: 'listening',
      job_executions: [
        workflowJobExecutionDto({
          sequence: 1,
          name: 'Review PR #476',
          status: 'failed',
          status_reason: 'validation failed',
          queued_at: '2026-06-21T12:00:00.000Z',
          started_at: '2026-06-21T12:00:05.000Z',
          finished_at: '2026-06-21T12:02:00.000Z',
        }),
        workflowJobExecutionDto({
          sequence: 2,
          name: 'Review PR #479',
          status: 'running',
        }),
      ],
    });
    const selected = job.jobExecutions[1];
    if (!selected) throw new Error('Expected a selected job execution');

    render(
      <JobExecutionSwitcher
        job={job}
        selectedJobExecution={selected.id}
        onSelectedJobExecutionChange={() => undefined}
        variant="title"
      />,
    );

    const trigger = screen.getByRole('button', {
      name: 'Switch job execution, currently execution 2: Review PR #479',
    });
    expect(trigger).toBeInTheDocument();

    await user.click(trigger);

    expect(
      await screen.findByRole('menuitem', {
        name: FIRST_EXECUTION_ACCESSIBLE_NAME,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('menuitem', {name: SECOND_EXECUTION_MENU_ITEM})).toBeInTheDocument();
  });
});
