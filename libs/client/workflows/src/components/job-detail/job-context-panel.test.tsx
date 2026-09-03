import type {WorkflowJobExecutionContextResponseDto} from '@shipfox/api-workflows-dto';
import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {ReactElement} from 'react';
import type {WorkflowJobExecutionDetail} from '#core/workflow-run.js';
import {workflowJob, workflowJobExecutionDto} from '#test/fixtures/workflow-run.js';
import {JobContextPanel} from './job-context-panel.js';

describe('JobContextPanel', () => {
  afterEach(() => {
    configureApiClient({baseUrl: '', fetchImpl: undefined});
  });

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
    expect(within(dialog).getByText('Execution name evaluation (1)')).toBeInTheDocument();
    expect(within(dialog).getByText('Condition evaluation (1)')).toBeInTheDocument();
  });

  test('does not fetch selected execution context until the sheet opens', async () => {
    const user = userEvent.setup();
    const job = workflowJob({
      name: 'build',
      job_executions: [workflowJobExecutionDto({status: 'succeeded'})],
    });
    const execution = job.jobExecutions[0];
    if (!execution) throw new Error('Test fixture is missing a job execution.');

    const fetchImpl = vi.fn(async () =>
      jsonResponse(workflowJobExecutionContextResponseDto(job.id, execution.id)),
    );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderWithQueryClient(
      <JobContextPanel
        job={job}
        execution={execution}
        selectedExecution={selectedExecutionDetail(execution.id, job.id)}
      />,
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', {name: 'Inspect job details'}));
    expect(await screen.findAllByText('Job outputs')).not.toHaveLength(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const request = (fetchImpl.mock.calls as unknown[][])[0]?.[0];
    if (!(request instanceof Request)) throw new Error('Expected fetch to receive a Request.');
    expect(request.url).toBe(
      `https://api.example.test/workflows/runs/jobs/${job.id}/executions/${execution.id}/context`,
    );
  });

  test('keeps loaded context visible when a refresh fails', async () => {
    const user = userEvent.setup();
    const job = workflowJob({
      name: 'build',
      job_executions: [workflowJobExecutionDto({status: 'succeeded'})],
    });
    const execution = job.jobExecutions[0];
    if (!execution) throw new Error('Test fixture is missing a job execution.');
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(workflowJobExecutionContextResponseDto(job.id, execution.id)),
      )
      .mockResolvedValueOnce(jsonResponse({code: 'server-error'}, {status: 500}));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {queryClient} = renderWithQueryClient(
      <JobContextPanel
        job={job}
        execution={execution}
        selectedExecution={selectedExecutionDetail(execution.id, job.id)}
      />,
    );

    await user.click(screen.getByRole('button', {name: 'Inspect job details'}));
    expect(await screen.findAllByText('Job outputs')).not.toHaveLength(0);
    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: ['workflow-executions', 'context', execution.id],
      });
    });

    expect(await screen.findByText('Could not refresh job context.')).toBeInTheDocument();
    expect(screen.getAllByText('Job outputs')).not.toHaveLength(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
  };
}

function selectedExecutionDetail(
  jobExecutionId: string,
  jobId: string,
): WorkflowJobExecutionDetail {
  return {
    id: jobExecutionId,
    jobId,
    sequence: 1,
    name: 'build',
    status: 'succeeded',
    displayStatus: 'succeeded',
    statusReason: null,
    statusReasonMessage: null,
    queuedAt: '2026-08-05T12:00:00.000Z',
    startedAt: '2026-08-05T12:00:01.000Z',
    finishedAt: '2026-08-05T12:01:00.000Z',
    timedOutAt: null,
    updatedAt: '2026-08-05T12:01:00.000Z',
    displayDuration: null,
    hasContext: true,
    steps: {items: [], nextCursor: null},
  };
}

function workflowJobExecutionContextResponseDto(
  jobId: string,
  executionId: string,
): WorkflowJobExecutionContextResponseDto {
  return {
    workflow_run_id: '11111111-1111-4111-8111-111111111111',
    workflow_run_attempt: 1,
    job_id: jobId,
    job_execution_id: executionId,
    job_runner: ['shared-runner'],
    execution_runner: null,
    job_outputs: {build: 'complete'},
    execution_outputs: null,
    trigger_events: [],
    job_evaluation_trace: null,
    execution_evaluation_trace: null,
    condition: null,
    oversized_fields: [],
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}
