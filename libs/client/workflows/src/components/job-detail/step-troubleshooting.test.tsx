import {configureApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {type ReactNode, useState} from 'react';
import {
  workflowJob,
  workflowJobExecutionDto,
  workflowStepAttemptDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {buildStepListModel, type StepListEntryModel} from '../step-list/step-list-model.js';
import {StepInspectorSheet} from './step-troubleshooting.js';

const STEP_ID = '55555555-5555-4555-8555-555555555555';
const ATTEMPT_ID = '66666666-6666-4666-8666-666666666666';
const EXECUTION_ID = '77777777-7777-4777-8777-777777777777';
const INSPECTOR_TRIGGER_NAME = 'Open inspector';

describe('StepInspectorSheet', () => {
  afterEach(() => {
    configureApiClient({baseUrl: '', fetchImpl: undefined});
  });

  it('shows a loading state only after the inspector is opened', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(() => new Promise<Response>(() => undefined)),
    });

    renderPanel();

    expect(screen.queryByRole('status', {name: 'Loading troubleshooting details'})).toBeNull();
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));
    expect(
      await screen.findByRole('status', {name: 'Loading troubleshooting details'}),
    ).toBeInTheDocument();
  });

  it('keeps failure detail out of the default log path', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(() => new Promise<Response>(() => undefined)),
    });

    renderPanel();

    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('shows the evaluation count only after the lazy detail response arrives', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(async () =>
        jsonResponse({
          step_id: STEP_ID,
          attempt: 1,
          authored_config: {run: 'pnpm test'},
          config: {run: 'pnpm test --filter=client'},
          evaluation_trace: [
            {
              expression: 'inputs.message',
              roots: ['inputs.message'],
              fill_target: 'run',
              evaluated_at: '2026-08-05T12:00:00.000Z',
              field: 'run',
              value: 'hello',
            },
          ],
        }),
      ),
    });

    renderPanel();

    expect(screen.queryByText('Evaluation')).toBeNull();
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));
    expect((await screen.findAllByText('Evaluation')).length).toBeGreaterThan(0);
  });

  it('shows an actionable error and retries the detail request', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({code: 'server-error'}, {status: 500}))
      .mockResolvedValueOnce(
        jsonResponse({
          step_id: STEP_ID,
          attempt: 1,
          authored_config: {run: 'pnpm test'},
          config: {run: 'pnpm test --filter=client'},
          evaluation_trace: null,
        }),
      );
    configureApiClient({fetchImpl});

    renderPanel();
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText('Details unavailable')).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'Retry'}));
    expect(await screen.findByRole('region', {name: 'Inputs'})).toBeInTheDocument();
    expect(screen.getAllByText('Resolved configuration')).not.toHaveLength(0);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not show current step configuration or evaluation for a historical attempt', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(async () =>
        jsonResponse({
          step_id: STEP_ID,
          attempt: 1,
          authored_config: null,
          config: null,
          evaluation_trace: null,
        }),
      ),
    });

    renderPanel();
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));
    expect(await screen.findByRole('region', {name: 'Outputs'})).toBeInTheDocument();

    expect(screen.queryByText('Authored configuration')).toBeNull();
    expect(screen.queryByText('Resolved configuration')).toBeNull();
    expect(screen.queryByText('Evaluation')).toBeNull();
  });
});

function renderPanel() {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<PanelHarness />, {wrapper});
}

function PanelHarness() {
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const entry = stepEntry();
  return (
    <>
      <button type="button" onClick={() => setInspectorOpen(true)}>
        Open inspector
      </button>
      <StepInspectorSheet
        entry={entry}
        open={inspectorOpen}
        onOpenChange={setInspectorOpen}
        workspaceSlug="acme"
        projectSlug="platform"
        workflowRunId="11111111-1111-4111-8111-111111111111"
        runAttempt={1}
        jobId="44444444-4444-4444-8444-444444444444"
      />
    </>
  );
}

function stepEntry(): StepListEntryModel {
  const jobId = '44444444-4444-4444-8444-444444444444';
  const job = workflowJob({
    id: jobId,
    name: 'verification',
    key: 'verification',
    status: 'failed',
    job_executions: [
      workflowJobExecutionDto({
        id: EXECUTION_ID,
        job_id: jobId,
        status: 'failed',
        steps: [
          workflowStepDto({
            id: STEP_ID,
            job_execution_id: EXECUTION_ID,
            name: 'Run verification',
            status: 'failed',
            config: {run: 'pnpm test'},
            evaluation_trace: [
              {
                expression: 'inputs.message',
                roots: ['inputs.message'],
                fill_target: 'run',
                evaluated_at: '2026-08-05T12:00:00.000Z',
                field: 'run',
                value: 'current attempt value',
              },
            ],
            attempts: [
              workflowStepAttemptDto({
                id: ATTEMPT_ID,
                step_id: STEP_ID,
                status: 'failed',
                output: {result: 'failed'},
                finished_at: '2026-08-05T12:01:00.000Z',
              }),
            ],
          }),
        ],
      }),
    ],
  });
  const execution = job.jobExecutions[0];
  if (!execution) throw new Error('Test fixture is missing an execution.');
  const entry = buildStepListModel({job, jobExecution: execution}).entries[0];
  if (!entry) throw new Error('Test fixture is missing a step attempt.');

  return entry;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}
