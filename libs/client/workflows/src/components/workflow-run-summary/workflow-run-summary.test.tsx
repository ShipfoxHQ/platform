import {authStateAtom} from '@shipfox/client-shell/runtime';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {render, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {createStore, Provider as JotaiProvider} from 'jotai';
import type {workflowRunDetailDto} from '#test/fixtures/workflow-run.js';
import {
  workflowJobDto,
  workflowJobExecutionDto,
  workflowRunDetail,
} from '#test/fixtures/workflow-run.js';
import {WorkflowRunSummary} from './workflow-run-summary.js';

const RUN_ID = '66666666-6666-4666-8666-666666666666';
const RELATIVE_TIME_TEXT_PATTERN = /ago$/;
const OLD_ROOT_TIME_TEXT_PATTERN = /(?:1d|24h) ago/;
const COPY_RUN_BUTTON_NAME = /Copy run/;
const DEV_BADGE_TEXT = 'Dev';
const AT_SIGN_TEXT = /@/;
const REPLAY_OF_TEXT = /Replay of/;

const originalScrollWidth = Object.getOwnPropertyDescriptor(
  window.HTMLElement.prototype,
  'scrollWidth',
);
const originalClientWidth = Object.getOwnPropertyDescriptor(
  window.HTMLElement.prototype,
  'clientWidth',
);

beforeEach(() => {
  setElementWidths({scrollWidth: 80, clientWidth: 120});
});

describe('WorkflowRunSummary', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    restoreElementWidthDescriptors();
  });

  test('renders status, run number, trigger metadata, and trigger time', async () => {
    renderSummary({workflow_name: 'CI', number: 5184});

    const summary = await screen.findByRole('region', {name: 'deploy-web'});

    expect(summary).toHaveClass('px-row', 'py-row');
    expect(summary).not.toHaveClass('bg-background-subtle-base');
    expect(summary.firstElementChild).not.toHaveClass('max-w-[1120px]');
    expect(within(summary).getByRole('heading', {name: 'deploy-web'})).toBeInTheDocument();
    expect(within(summary).getAllByText('Running')).not.toHaveLength(0);
    expect(within(summary).getByText('CI #5184')).toBeInTheDocument();
    expect(within(summary).getByText('fire')).toBeInTheDocument();
    expect(within(summary).queryByText('manual')).not.toBeInTheDocument();
    expect(within(summary).getByText(RELATIVE_TIME_TEXT_PATTERN)).toBeInTheDocument();
    expect(within(summary).queryByText('Triggered')).not.toBeInTheDocument();
    expect(within(summary).queryByText('Updated')).not.toBeInTheDocument();
    expect(
      within(summary).queryByRole('button', {name: COPY_RUN_BUTTON_NAME}),
    ).not.toBeInTheDocument();
  });

  test('omits the run number before the server assigns one', async () => {
    const run = {...workflowRunDetail({workflow_name: 'CI'}), number: null};
    render(<WorkflowRunSummary run={run} />);

    const summary = await screen.findByRole('region', {name: 'deploy-web'});

    expect(within(summary).queryByText('CI #1')).not.toBeInTheDocument();
  });

  test('separates a standalone run number from the run timestamp', async () => {
    const run = workflowRunDetail({
      workflow_name: 'CI',
      trigger_source: '',
      trigger_event: '',
    });
    render(<WorkflowRunSummary run={run} />);

    const summary = await screen.findByRole('region', {name: 'deploy-web'});

    expect(within(summary).getByText('CI #1')).toBeInTheDocument();
    const timestamp = within(summary).getByText(RELATIVE_TIME_TEXT_PATTERN);
    expect(timestamp.previousElementSibling).toHaveAttribute('aria-hidden', 'true');
  });

  test('uses the selected run attempt for summary status and trigger time', async () => {
    const rootCreatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const attemptCreatedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    renderSummary({
      created_at: rootCreatedAt,
      run_attempt: {
        id: '22222222-2222-4222-8222-222222222222',
        workflow_run_id: RUN_ID,
        attempt: 2,
        status: 'failed',
        created_at: attemptCreatedAt,
        started_at: null,
        finished_at: null,
        rerun_mode: 'all',
      },
    });

    const summary = await screen.findByRole('region', {name: 'deploy-web'});

    expect(
      within(summary).queryByRole('button', {name: COPY_RUN_BUTTON_NAME}),
    ).not.toBeInTheDocument();
    expect(within(summary).getAllByText('Failed')).not.toHaveLength(0);
    expect(within(summary).getByText('5m ago')).toBeInTheDocument();
    expect(within(summary).queryByText(OLD_ROOT_TIME_TEXT_PATTERN)).not.toBeInTheDocument();
  });

  test('omits empty trigger metadata', async () => {
    renderSummary({trigger_source: '', trigger_event: ''});

    await screen.findByRole('region', {name: 'deploy-web'});

    expect(screen.queryByText('fire')).not.toBeInTheDocument();
  });

  test('does not show a run name tooltip when the heading is not truncated', async () => {
    const user = userEvent.setup();
    renderSummary();

    await user.hover(await screen.findByRole('heading', {name: 'deploy-web'}));

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  test('wires the full run name tooltip when the heading is truncated', async () => {
    const runName = 'release-production-multi-region-with-canary-and-smoke-tests';
    setElementWidths({scrollWidth: 160, clientWidth: 80});
    renderSummary({name: runName});

    const heading = await screen.findByRole('heading', {name: runName});

    expect(heading).toHaveAttribute('data-slot', 'tooltip-trigger');
    // The Radix tooltip is the only name affordance: a native `title` beside it would fire a
    // second, unstyled OS tooltip with the same text.
    await waitFor(() => expect(within(heading).getByText(runName)).not.toHaveAttribute('title'));
  });

  test('shows the selected attempt duration, not the top-level run duration', async () => {
    renderSummary({
      started_at: '2026-05-07T00:00:00.000Z',
      finished_at: '2026-05-07T00:10:00.000Z',
      run_attempt: {
        id: '11111111-1111-4111-8111-000000000001',
        workflow_run_id: RUN_ID,
        attempt: 1,
        status: 'succeeded',
        created_at: '2026-05-07T01:01:00.000Z',
        started_at: '2026-05-07T01:00:00.000Z',
        finished_at: '2026-05-07T01:02:14.000Z',
        rerun_mode: null,
      },
    });

    await screen.findByRole('region', {name: 'deploy-web'});

    expect(screen.getByText('2m 14s')).toBeInTheDocument();
    expect(screen.queryByText('10m 00s')).not.toBeInTheDocument();
  });

  test('shows a live selected attempt duration for running runs', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-05-07T01:02:14.000Z'));
    renderSummary({
      jobs: [
        workflowJobDto({
          status: 'running',
          job_executions: [
            workflowJobExecutionDto({
              status: 'running',
              started_at: '2026-05-07T01:02:00.000Z',
            }),
          ],
        }),
      ],
      run_attempt: {
        id: '11111111-1111-4111-8111-000000000001',
        workflow_run_id: RUN_ID,
        attempt: 1,
        status: 'running',
        created_at: '2026-05-07T01:01:00.000Z',
        started_at: '2026-05-07T01:00:00.000Z',
        finished_at: null,
        rerun_mode: null,
      },
    });

    await screen.findByRole('region', {name: 'deploy-web'});

    const duration = screen.getByText('2m 14s');
    expect(duration).toBeInTheDocument();
    expect(duration).toHaveAttribute('aria-label', 'running 2m 14s');
  });

  // The header reports the attempt the API returned. Whether a job has reached a runner yet is
  // the job surfaces' business, so an attempt whose jobs are all pending still reads as running.
  test('reads a running attempt as running whatever its jobs have reached', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-05-07T01:02:14.000Z'));
    renderSummary({
      jobs: [workflowJobDto({status: 'pending'})],
      run_attempt: runningAttemptDto(),
    });

    const summary = await screen.findByRole('region', {name: 'deploy-web'});

    expect(within(summary).getAllByText('Running')).not.toHaveLength(0);
    expect(within(summary).queryByText('Queued')).not.toBeInTheDocument();
    expect(within(summary).getByText('2m 14s')).toHaveAttribute('aria-label', 'running 2m 14s');
  });

  test('uses a neutral verb when an attempt finished before any job execution started', async () => {
    renderSummary({
      status: 'cancelled',
      jobs: [
        workflowJobDto({
          status: 'pending',
          job_executions: [workflowJobExecutionDto({queued_at: '2026-05-07T01:00:00.000Z'})],
        }),
      ],
      run_attempt: {
        id: '11111111-1111-4111-8111-000000000001',
        workflow_run_id: RUN_ID,
        attempt: 1,
        status: 'cancelled',
        created_at: '2026-05-07T01:00:00.000Z',
        started_at: '2026-05-07T01:00:00.000Z',
        finished_at: '2026-05-07T01:02:14.000Z',
        rerun_mode: null,
      },
    });

    const summary = await screen.findByRole('region', {name: 'deploy-web'});

    expect(within(summary).getAllByText('Cancelled')).not.toHaveLength(0);
    expect(within(summary).getByText('2m 14s')).toHaveAttribute('aria-label', 'lasted 2m 14s');
  });

  test('uses the run verb when a cancelled job execution started', async () => {
    renderSummary({
      status: 'cancelled',
      jobs: [
        workflowJobDto({
          status: 'cancelled',
          job_executions: [
            workflowJobExecutionDto({
              status: 'cancelled',
              started_at: '2026-05-07T01:00:05.000Z',
            }),
          ],
        }),
      ],
      run_attempt: {
        id: '11111111-1111-4111-8111-000000000001',
        workflow_run_id: RUN_ID,
        attempt: 1,
        status: 'cancelled',
        created_at: '2026-05-07T01:00:00.000Z',
        started_at: '2026-05-07T01:00:00.000Z',
        finished_at: '2026-05-07T01:02:14.000Z',
        rerun_mode: null,
      },
    });

    const summary = await screen.findByRole('region', {name: 'deploy-web'});

    expect(within(summary).getByText('2m 14s')).toHaveAttribute('aria-label', 'ran 2m 14s');
  });

  test('uses a neutral verb when every job was skipped', async () => {
    renderSummary({
      status: 'succeeded',
      jobs: [workflowJobDto({status: 'skipped'})],
      run_attempt: {
        id: '11111111-1111-4111-8111-000000000001',
        workflow_run_id: RUN_ID,
        attempt: 1,
        status: 'succeeded',
        created_at: '2026-05-07T01:00:00.000Z',
        started_at: '2026-05-07T01:00:00.000Z',
        finished_at: '2026-05-07T01:02:14.000Z',
        rerun_mode: null,
      },
    });

    const summary = await screen.findByRole('region', {name: 'deploy-web'});

    expect(within(summary).getAllByText('Succeeded')).not.toHaveLength(0);
    expect(within(summary).getByText('2m 14s')).toHaveAttribute('aria-label', 'lasted 2m 14s');
  });

  test('does not render a whole-run source control', async () => {
    renderSummary();

    await screen.findByRole('region', {name: 'deploy-web'});

    expect(screen.queryByRole('button', {name: 'View source'})).not.toBeInTheDocument();
  });

  test('shows the cancel action when the run can be cancelled', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderSummary({}, {onCancel});

    const button = await screen.findByRole('button', {name: 'Cancel workflow'});
    expect(button).toHaveClass(
      'bg-background-button-danger-default',
      'text-foreground-neutral-on-color',
      'shadow-button-danger',
    );
    expect(button).not.toHaveClass('bg-background-neutral-base');

    await user.click(button);

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('omits the cancel action for terminal runs', async () => {
    renderSummary({status: 'succeeded'});

    await screen.findByRole('region', {name: 'deploy-web'});

    expect(screen.queryByRole('button', {name: 'Cancel workflow'})).not.toBeInTheDocument();
  });

  test('disables the cancel action while cancellation is pending', async () => {
    renderSummary({}, {cancelling: true, onCancel: vi.fn()});

    const button = await screen.findByRole('button', {name: 'Cancel workflow'});
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  test('hides the cancel action when no cancel handler is provided', async () => {
    renderSummary({status: 'running'});

    await screen.findByRole('region', {name: 'deploy-web'});

    expect(screen.queryByRole('button', {name: 'Cancel workflow'})).not.toBeInTheDocument();
  });

  test('derives the cancel action for non-terminal runs', async () => {
    const onCancel = vi.fn();
    const onRerun = vi.fn();
    renderSummary({status: 'running'}, {onCancel, onRerun});

    await screen.findByRole('button', {name: 'Cancel workflow'});

    expect(screen.queryByRole('button', {name: 'Re-run workflow'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Re-run jobs'})).not.toBeInTheDocument();
  });

  test('re-runs all jobs from a succeeded run', async () => {
    const user = userEvent.setup();
    const onRerun = vi.fn();
    renderSummary({status: 'succeeded'}, {onRerun});

    await user.click(await screen.findByRole('button', {name: 'Re-run workflow'}));

    expect(onRerun).toHaveBeenCalledWith('all');
  });

  test('hides the re-run action when no re-run handler is provided', async () => {
    renderSummary({status: 'succeeded'});

    await screen.findByRole('region', {name: 'deploy-web'});

    expect(screen.queryByRole('button', {name: 'Re-run workflow'})).not.toBeInTheDocument();
  });

  test('shows re-run choices for a failed run', async () => {
    const user = userEvent.setup();
    const onRerun = vi.fn();
    renderSummary({status: 'failed', jobs: [workflowJobDto({status: 'failed'})]}, {onRerun});

    const rerunButton = await screen.findByRole('button', {name: 'Re-run jobs'});
    expect(rerunButton).toHaveClass('bg-background-neutral-base');
    await user.click(rerunButton);
    expect(await screen.findByRole('menuitem', {name: 'Re-run all jobs'})).toBeInTheDocument();
    await user.click(await screen.findByRole('menuitem', {name: 'Re-run failed jobs'}));

    expect(onRerun).toHaveBeenCalledWith('failed');
  });

  test('shows re-run choices for a cancelled run', async () => {
    const user = userEvent.setup();
    const onRerun = vi.fn();
    renderSummary({status: 'cancelled', jobs: [workflowJobDto({status: 'cancelled'})]}, {onRerun});

    await user.click(await screen.findByRole('button', {name: 'Re-run jobs'}));

    expect(await screen.findByRole('menuitem', {name: 'Re-run all jobs'})).toBeInTheDocument();
    expect(screen.getByRole('menuitem', {name: 'Re-run failed jobs'})).toBeInTheDocument();
  });

  test('re-runs the full workflow when a failed run has no failed jobs', async () => {
    const user = userEvent.setup();
    const onRerun = vi.fn();
    renderSummary({status: 'failed', jobs: [workflowJobDto({status: 'succeeded'})]}, {onRerun});

    await user.click(await screen.findByRole('button', {name: 'Re-run workflow'}));

    expect(screen.queryByRole('button', {name: 'Re-run jobs'})).not.toBeInTheDocument();
    expect(onRerun).toHaveBeenCalledWith('all');
  });

  test('hides run actions when viewing a historical attempt', async () => {
    renderSummary(
      {
        status: 'failed',
        current_attempt: 2,
        run_attempt: {
          id: '11111111-1111-4111-8111-000000000001',
          workflow_run_id: RUN_ID,
          attempt: 1,
          status: 'failed',
          created_at: '2026-05-07T01:01:00.000Z',
          started_at: null,
          finished_at: null,
          rerun_mode: null,
        },
        jobs: [workflowJobDto({status: 'failed'})],
      },
      {onCancel: vi.fn(), onRerun: vi.fn()},
    );

    await screen.findByRole('region', {name: 'deploy-web'});

    expect(screen.queryByRole('button', {name: 'Cancel workflow'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Re-run workflow'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Re-run jobs'})).not.toBeInTheDocument();
  });

  test('keeps a synced run free of dev provenance', async () => {
    renderSummary();

    const summary = await screen.findByRole('region', {name: 'deploy-web'});

    expect(within(summary).queryByText(DEV_BADGE_TEXT)).not.toBeInTheDocument();
    expect(within(summary).queryByText(AT_SIGN_TEXT)).not.toBeInTheDocument();
    expect(within(summary).queryByText('You')).not.toBeInTheDocument();
    expect(within(summary).queryByText(REPLAY_OF_TEXT)).not.toBeInTheDocument();
  });

  test('shows branch and commit on the summary line of a synced run', async () => {
    renderSummary({
      trigger_source: 'github_acme',
      trigger_event: 'push',
      trigger_reference: {
        repository: 'acme/api',
        ref: 'refs/heads/main',
        commit: 'abcdef1234567890abcdef1234567890abcdef12',
        actor: 'octocat',
      },
    });

    const summary = await screen.findByRole('region', {name: 'deploy-web'});

    expect(within(summary).getByText('main')).toBeInTheDocument();
    expect(within(summary).getByText('abcdef1')).toBeInTheDocument();
    expect(within(summary).queryByText(DEV_BADGE_TEXT)).not.toBeInTheDocument();
  });

  test('labels a dev run with the badge, ref @ commit, and its initiator', async () => {
    renderSummary(devRunOverrides());

    const summary = await screen.findByRole('region', {name: 'deploy-web'});

    expect(within(summary).getByText(DEV_BADGE_TEXT)).toHaveClass('bg-tag-purple-bg');
    expect(within(summary).getByText('fix-triage-prompt @ abcdef1')).toBeInTheDocument();
    // Without auth context the initiator reads as the short user id.
    expect(within(summary).getByText('99999999')).toBeInTheDocument();
    expect(within(summary).queryByText('You')).not.toBeInTheDocument();
    expect(within(summary).queryByText(REPLAY_OF_TEXT)).not.toBeInTheDocument();
  });

  test('gives summary provenance chips an accessible kind and truncated initiator value', async () => {
    renderSummary(devRunOverrides());

    const summary = await screen.findByRole('region', {name: 'deploy-web'});

    expect(
      within(summary).getByRole('img', {name: 'Dev source fix-triage-prompt @ abcdef1'}),
    ).toBeInTheDocument();
    expect(within(summary).getByRole('img', {name: 'Initiated by 99999999'})).toBeInTheDocument();
    expect(summary).not.toHaveTextContent('99999999-9999-4999-8999-999999999999');
    expect(summary.querySelector('[title*="99999999-9999-4999-8999-999999999999"]')).toBeNull();
  });

  test('does not start a bare dev provenance line with a separator', async () => {
    const run = workflowRunDetail({
      ...devRunOverrides(),
      trigger_source: '',
      trigger_event: '',
    });
    run.number = null;
    render(<WorkflowRunSummary run={run} />);

    const summary = await screen.findByRole('region', {name: 'deploy-web'});
    const provenance = within(summary).getByRole('img', {
      name: 'Dev source fix-triage-prompt @ abcdef1',
    });

    expect(provenance.previousElementSibling).toBeNull();
  });

  test('reads the dev initiator as You for the current user', async () => {
    const store = createStore();
    store.set(authStateAtom, {
      status: 'authenticated',
      token: 'token',
      user: {id: '99999999-9999-4999-8999-999999999999', email: 'me@example.com'},
    });
    const run = workflowRunDetail({...devRunOverrides()});

    render(
      <JotaiProvider store={store}>
        <WorkflowRunSummary run={run} />
      </JotaiProvider>,
    );

    const summary = await screen.findByRole('region', {name: 'deploy-web'});

    expect(within(summary).getByText('You')).toBeInTheDocument();
    expect(within(summary).queryByText('99999999')).not.toBeInTheDocument();
  });

  test('links a dev replay run to its source event', async () => {
    const EVENT_ID = '88888888-8888-4888-8888-888888888888';
    const run = workflowRunDetail({
      ...devRunOverrides(),
      dev_source: {...devSourceDto(), replay_of_event_id: EVENT_ID},
    });

    renderSummaryWithRouter({run, workspaceSlug: 'acme', projectSlug: 'project'});

    const summary = await screen.findByRole('region', {name: 'deploy-web'});

    const link = within(summary).getByRole('link', {name: 'Replay of fire'});
    expect(link).toHaveAttribute(
      'href',
      '/w/acme/settings/events?eventId=88888888-8888-4888-8888-888888888888',
    );
  });

  test('renders the replay provenance as text without navigation context', async () => {
    const EVENT_ID = '88888888-8888-4888-8888-888888888888';
    renderSummary({
      ...devRunOverrides(),
      dev_source: {...devSourceDto(), replay_of_event_id: EVENT_ID},
    });

    const summary = await screen.findByRole('region', {name: 'deploy-web'});

    expect(within(summary).getByText('Replay of fire')).toBeInTheDocument();
    expect(within(summary).queryByRole('link', {name: REPLAY_OF_TEXT})).not.toBeInTheDocument();
  });

  test('omits the replay provenance when the dev run replays no event', async () => {
    renderSummaryWithRouter({
      run: workflowRunDetail(devRunOverrides()),
      workspaceSlug: 'acme',
      projectSlug: 'project',
    });

    const summary = await screen.findByRole('region', {name: 'deploy-web'});

    expect(within(summary).queryByText(REPLAY_OF_TEXT)).not.toBeInTheDocument();
  });
});

function renderSummary(
  overrides: Parameters<typeof workflowRunDetailDto>[0] = {},
  props: Omit<Parameters<typeof WorkflowRunSummary>[0], 'run'> = {},
) {
  const run = workflowRunDetail({
    id: RUN_ID,
    project_id: '44444444-4444-4444-8444-444444444444',
    definition_id: '55555555-5555-4555-8555-555555555555',
    name: 'deploy-web',
    status: 'running',
    trigger_source: 'manual',
    trigger_event: 'fire',
    created_at: '2026-05-07T01:01:00.000Z',
    updated_at: '2026-05-07T01:02:00.000Z',
    ...overrides,
  });

  // These cases never mount the attempt switcher links, so no router is needed.
  render(<WorkflowRunSummary run={run} {...props} />);
}

function devSourceDto() {
  return {
    ref: 'fix-triage-prompt',
    commit: 'abcdef1234567890abcdef1234567890abcdef12',
    config_path: '.shipfox/workflows/triage-sentry.yml',
    initiated_by_user_id: '99999999-9999-4999-8999-999999999999',
    replay_of_event_id: null,
  };
}

function devRunOverrides(): Parameters<typeof workflowRunDetailDto>[0] {
  return {
    origin: 'dev',
    trigger_reference: null,
    dev_source: devSourceDto(),
  };
}

/** Mounts the summary under a router that also carries the events settings route. */
function renderSummaryWithRouter({
  run,
  workspaceSlug,
  projectSlug,
}: {
  run: ReturnType<typeof workflowRunDetail>;
  workspaceSlug: string;
  projectSlug: string;
}) {
  const rootRoute = createRootRoute({component: Outlet});
  const runRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId',
    component: () => (
      <WorkflowRunSummary run={run} workspaceSlug={workspaceSlug} projectSlug={projectSlug} />
    ),
  });
  const eventsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/settings/events',
    component: () => null,
  });
  const router = createRouter({
    history: createMemoryHistory({
      initialEntries: [`/w/${workspaceSlug}/p/${projectSlug}/runs/${RUN_ID}`],
    }),
    routeTree: rootRoute.addChildren([runRoute, eventsRoute]),
  });

  render(<RouterProvider router={router} />);
}

function runningAttemptDto() {
  return {
    id: '11111111-1111-4111-8111-000000000001',
    workflow_run_id: RUN_ID,
    attempt: 1,
    status: 'running' as const,
    created_at: '2026-05-07T01:01:00.000Z',
    started_at: '2026-05-07T01:00:00.000Z',
    finished_at: null,
    rerun_mode: null,
  };
}

function setElementWidths({scrollWidth, clientWidth}: {scrollWidth: number; clientWidth: number}) {
  Object.defineProperty(window.HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get() {
      return scrollWidth;
    },
  });
  Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return clientWidth;
    },
  });
}

function restoreElementWidthDescriptors() {
  restoreElementWidthDescriptor('scrollWidth', originalScrollWidth);
  restoreElementWidthDescriptor('clientWidth', originalClientWidth);
}

function restoreElementWidthDescriptor(
  property: 'scrollWidth' | 'clientWidth',
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(window.HTMLElement.prototype, property, descriptor);
    return;
  }
  delete window.HTMLElement.prototype[property];
}
