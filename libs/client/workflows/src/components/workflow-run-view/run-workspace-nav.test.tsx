import {act, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useState} from 'react';
import {
  workflowJobDto,
  workflowJobExecutionDto,
  workflowRunDetail,
} from '#test/fixtures/workflow-run.js';
import {renderWithRouter} from '#test/render.js';
import {RunWorkspaceNav} from './run-workspace-nav.js';

const RUN_ID = '66666666-6666-4666-8666-666666666666';
const CURRENT_JOB_ID = '88888888-8888-4888-8888-888888888888';
const BUILD_LINK_PATTERN = /build/;
const DEPLOY_LINK_PATTERN = /deploy/;
const SETUP_LINK_PATTERN = /setup/;
const NOW = Date.parse('2026-06-26T12:00:00.000Z');

describe('RunWorkspaceNav', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('announces the annotation count with its unit and marks a truncated read', async () => {
    const run = workflowRunDetail({
      id: RUN_ID,
      jobs: [workflowJobDto({id: CURRENT_JOB_ID, name: 'build', position: 0})],
    });

    renderWithRouter(
      <RunWorkspaceNav
        workspaceSlug="acme"
        projectSlug="project"
        run={run}
        activeSection="summary"
        annotationSummary={{
          total: 500,
          error: 12,
          warning: 3,
          info: 0,
          success: 0,
          truncated: true,
        }}
      />,
    );

    expect(await screen.findByRole('link', {name: 'Annotations, 500 or more'})).toBeVisible();
  });

  test('omits the annotation count until the read resolves', async () => {
    const run = workflowRunDetail({
      id: RUN_ID,
      jobs: [workflowJobDto({id: CURRENT_JOB_ID, name: 'build', position: 0})],
    });

    renderWithRouter(
      <RunWorkspaceNav
        workspaceSlug="acme"
        projectSlug="project"
        run={run}
        activeSection="summary"
      />,
    );

    expect(await screen.findByRole('link', {name: 'Annotations'})).toBeVisible();
  });

  test('shows the complete run hierarchy and marks the current job', async () => {
    const run = workflowRunDetail({
      id: RUN_ID,
      jobs: [
        workflowJobDto({id: 'job-deploy', name: 'deploy', position: 2, status: 'failed'}),
        workflowJobDto({id: CURRENT_JOB_ID, name: 'build', position: 1, status: 'running'}),
        workflowJobDto({id: 'job-setup', name: 'setup', position: 0, status: 'succeeded'}),
      ],
    });

    renderWithRouter(
      <RunWorkspaceNav
        workspaceSlug="acme"
        projectSlug="project"
        run={run}
        activeSection="summary"
        currentJobId={CURRENT_JOB_ID}
        jobSearch={{runAttempt: 2}}
      />,
    );

    const summary = await screen.findByRole('link', {name: 'Summary'});
    expect(summary).toBeInTheDocument();
    expect(screen.getByRole('heading', {name: 'Jobs'})).toBeInTheDocument();
    expect(screen.getByRole('heading', {name: 'Run details'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Annotations'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Source'})).toBeInTheDocument();

    const jobs = screen.getByRole('heading', {name: 'Jobs'}).closest('section');
    if (!jobs) throw new Error('Missing jobs section');
    expect(
      within(jobs)
        .getAllByRole('link')
        .map((link) => link.textContent?.trim()),
    ).toEqual([
      expect.stringContaining('setup'),
      expect.stringContaining('build'),
      expect.stringContaining('deploy'),
    ]);

    const current = within(jobs).getByRole('link', {name: BUILD_LINK_PATTERN});
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current.querySelector('[data-run-workspace-active-bar]')).not.toBeNull();
    expect(
      within(jobs)
        .getByRole('link', {name: SETUP_LINK_PATTERN})
        .querySelector('[data-run-workspace-active-bar]'),
    ).toBeNull();
    expect(jobs.querySelectorAll('[data-run-workspace-active-bar]')).toHaveLength(1);
    expect(current).toHaveAttribute(
      'href',
      expect.stringContaining(`/runs/${RUN_ID}/jobs/${CURRENT_JOB_ID}`),
    );
    expect(current).not.toHaveAttribute('href', expect.stringContaining('tab='));
    expect(current).toHaveAttribute('href', expect.stringContaining('runAttempt=%222%22'));
  });

  test('keeps the job index visible for a single-job run', async () => {
    const run = workflowRunDetail({
      id: RUN_ID,
      jobs: [workflowJobDto({id: CURRENT_JOB_ID, name: 'build', status: 'succeeded'})],
    });

    renderWithRouter(
      <RunWorkspaceNav
        workspaceSlug="acme"
        projectSlug="project"
        run={run}
        activeSection="summary"
      />,
    );

    expect(await screen.findByRole('heading', {name: 'Jobs'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: BUILD_LINK_PATTERN})).toBeInTheDocument();
    const summary = screen.getByRole('link', {name: 'Summary'});
    expect(summary).toHaveAttribute('aria-current', 'page');
    expect(summary.querySelector('[data-run-workspace-active-bar]')).not.toBeNull();
  });

  test('falls back to the first job when the current job id is stale', async () => {
    const run = workflowRunDetail({
      id: RUN_ID,
      jobs: [
        workflowJobDto({id: 'job-deploy', name: 'deploy', position: 1}),
        workflowJobDto({id: 'job-setup', name: 'setup', position: 0}),
      ],
    });

    renderWithRouter(
      <RunWorkspaceNav
        workspaceSlug="acme"
        projectSlug="project"
        run={run}
        activeSection="summary"
        currentJobId="stale-job-id"
      />,
    );

    const jobs = (await screen.findByRole('heading', {name: 'Jobs'})).closest('section');
    if (!jobs) throw new Error('Missing jobs section');

    const fallback = within(jobs).getByRole('link', {name: SETUP_LINK_PATTERN});
    expect(fallback).toHaveAttribute('aria-current', 'page');
    expect(jobs.querySelectorAll('[data-run-workspace-active-bar]')).toHaveLength(1);
  });

  test('keeps the route job active when it is outside the large-workflow preview', async () => {
    const run = {
      ...workflowRunDetail({
        id: RUN_ID,
        jobs: [workflowJobDto({id: CURRENT_JOB_ID, name: 'build', position: 0})],
      }),
      jobs: {
        kind: 'large' as const,
        total: 101,
        statusCounts: [],
        firstPage: {items: [], nextCursor: 'jobs-page-2', total: 101},
      },
    };

    renderWithRouter(
      <RunWorkspaceNav
        workspaceSlug="acme"
        projectSlug="project"
        run={run}
        activeSection="summary"
        currentJobId={CURRENT_JOB_ID}
      />,
    );

    const summary = await screen.findByRole('link', {name: 'Summary'});
    expect(summary).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('heading', {name: 'Jobs'}).closest('section')).not.toHaveTextContent(
      'build',
    );
  });

  test('scrolls the current job into view when the mobile rail opens', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const run = workflowRunDetail({
      id: RUN_ID,
      jobs: [workflowJobDto({id: CURRENT_JOB_ID, name: 'build', status: 'running'})],
    });

    renderWithRouter(
      <RunWorkspaceNav
        workspaceSlug="acme"
        projectSlug="project"
        run={run}
        activeSection="summary"
        currentJobId={CURRENT_JOB_ID}
      />,
    );

    await screen.findByRole('link', {name: BUILD_LINK_PATTERN});
    await user.click(await screen.findByRole('button', {name: 'Toggle run navigation'}));

    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  test('closes the mobile rail after navigating to a job', async () => {
    const user = userEvent.setup();
    const run = workflowRunDetail({
      id: RUN_ID,
      jobs: [
        workflowJobDto({id: CURRENT_JOB_ID, name: 'build', status: 'running'}),
        workflowJobDto({id: 'job-deploy', name: 'deploy', position: 1, status: 'succeeded'}),
      ],
    });

    renderWithRouter(
      <RunWorkspaceNav
        workspaceSlug="acme"
        projectSlug="project"
        run={run}
        activeSection="summary"
        currentJobId={CURRENT_JOB_ID}
      />,
    );

    const trigger = await screen.findByRole('button', {name: 'Toggle run navigation'});
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByRole('link', {name: DEPLOY_LINK_PATTERN}));

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  test('scrolls once when the active job changes while the rail is open', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const firstJob = workflowJobDto({id: CURRENT_JOB_ID, name: 'build', status: 'running'});
    const secondJob = workflowJobDto({
      id: 'job-deploy',
      name: 'deploy',
      position: 1,
      status: 'running',
    });
    const initialRun = workflowRunDetail({id: RUN_ID, jobs: [firstJob, secondJob]});
    renderWithRouter(<ActiveJobHarness run={initialRun} />);

    await screen.findByRole('link', {name: BUILD_LINK_PATTERN});
    await user.click(await screen.findByRole('button', {name: 'Toggle run navigation'}));
    const callsBeforeJobChange = scrollIntoView.mock.calls.length;

    await user.click(screen.getByRole('button', {name: 'Activate deploy'}));

    expect(scrollIntoView).toHaveBeenCalledTimes(callsBeforeJobChange + 1);
  });

  test('updates live job durations on the ticker cadence', async () => {
    vi.useFakeTimers({shouldAdvanceTime: true});
    vi.setSystemTime(NOW);
    const run = workflowRunDetail({
      id: RUN_ID,
      jobs: [
        workflowJobDto({
          id: CURRENT_JOB_ID,
          name: 'build',
          status: 'running',
          job_executions: [
            workflowJobExecutionDto({
              job_id: CURRENT_JOB_ID,
              status: 'running',
              queued_at: '2026-06-26T11:54:00.000Z',
              started_at: '2026-06-26T11:57:46.000Z',
            }),
          ],
        }),
      ],
    });

    renderWithRouter(
      <RunWorkspaceNav
        workspaceSlug="acme"
        projectSlug="project"
        run={run}
        activeSection="summary"
        currentJobId={CURRENT_JOB_ID}
      />,
    );

    const jobLink = await screen.findByRole('link', {name: BUILD_LINK_PATTERN});
    expect(jobLink).toHaveTextContent('2m 14s');

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(jobLink).toHaveTextContent('2m 15s');
  });
});

function ActiveJobHarness({run}: {run: ReturnType<typeof workflowRunDetail>}) {
  const [currentJobId, setCurrentJobId] = useState(CURRENT_JOB_ID);

  return (
    <>
      <RunWorkspaceNav
        workspaceSlug="acme"
        projectSlug="project"
        run={run}
        activeSection="summary"
        currentJobId={currentJobId}
      />
      <button type="button" onClick={() => setCurrentJobId('job-deploy')}>
        Activate deploy
      </button>
    </>
  );
}
