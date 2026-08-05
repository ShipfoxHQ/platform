import {screen, within} from '@testing-library/react';
import {workflowJobDto, workflowRunDetail} from '#test/fixtures/workflow-run.js';
import {renderWithRouter} from '#test/render.js';
import {RunWorkspaceNav} from './run-workspace-nav.js';

const RUN_ID = '66666666-6666-4666-8666-666666666666';
const CURRENT_JOB_ID = '88888888-8888-4888-8888-888888888888';
const BUILD_LINK_PATTERN = /build/;

describe('RunWorkspaceNav', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
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

    expect(await screen.findByRole('link', {name: 'Summary'})).toBeInTheDocument();
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
    expect(screen.getByRole('link', {name: 'Summary'})).toHaveAttribute('aria-current', 'page');
  });
});
