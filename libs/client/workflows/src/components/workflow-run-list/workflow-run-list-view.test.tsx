import {screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {WorkflowRunListItem, WorkflowRunStatus} from '#core/workflow-run.js';
import {workflowRunListItem} from '#test/fixtures/workflow-run.js';
import {renderWithRouter} from '#test/render.js';
import type {WorkflowRunListQuery} from './types.js';
import {WorkflowRunListView} from './workflow-run-list-view.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';

function loadedQuery(): WorkflowRunListQuery {
  return {
    isPending: false,
    isError: false,
    isFetching: false,
    data: {pages: [], pageParams: []},
    error: null,
    refetch: () => undefined,
  };
}

describe('WorkflowRunListView', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('narrows the list to the selected status filter', async () => {
    const user = userEvent.setup();
    renderListView([
      run('running', 'deploy-web'),
      run('failed', 'integration-tests'),
      run('succeeded', 'build-image'),
    ]);

    await user.click(await screen.findByRole('button', {name: 'Failed'}));

    expect(screen.getByText('integration-tests')).toBeInTheDocument();
    expect(screen.queryByText('deploy-web')).not.toBeInTheDocument();
    expect(screen.queryByText('build-image')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Failed'})).toHaveAttribute('aria-pressed', 'true');
  });

  test('the Running filter keeps in-progress pending runs alongside running ones', async () => {
    const user = userEvent.setup();
    renderListView([
      run('running', 'deploy-web'),
      run('pending', 'queued-build'),
      run('succeeded', 'build-image'),
    ]);

    await user.click(await screen.findByRole('button', {name: 'Running'}));

    expect(screen.getByText('deploy-web')).toBeInTheDocument();
    expect(screen.getByText('queued-build')).toBeInTheDocument();
    expect(screen.queryByText('build-image')).not.toBeInTheDocument();
  });

  test('renders optimistic temp runs without a navigable link', async () => {
    renderListView([run('pending', 'queued-build', 'temp-1234'), run('running', 'deploy-web')]);

    // The canonical run is a link to its detail page; the optimistic temp run is shown but
    // not yet navigable (its detail page does not exist until the canonical row replaces it).
    const links = await screen.findAllByRole('link');
    expect(links.some((link) => link.textContent?.includes('deploy-web'))).toBe(true);
    expect(links.some((link) => link.textContent?.includes('queued-build'))).toBe(false);
    expect(screen.getByText('queued-build')).toBeInTheDocument();
  });

  test('shows a finished run duration in the row metadata', async () => {
    renderListView([
      run('succeeded', 'build-image', 'run-build-image', {
        started_at: '2026-05-07T01:00:00.000Z',
        finished_at: '2026-05-07T01:02:14.000Z',
      }),
    ]);

    const duration = await screen.findByText('2m 14s');
    expect(duration).toBeInTheDocument();
    expect(duration).toHaveAttribute('aria-label', 'ran 2m 14s');
    expect(
      screen.getByRole('link', {
        name: (name) => name.includes('build-image') && name.includes('ran 2m 14s'),
      }),
    ).toBeInTheDocument();
  });

  test('shows a live running run duration in the row metadata', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-05-07T01:02:14.000Z'));

    renderListView([
      run('running', 'deploy-web', 'run-deploy-web', {
        started_at: '2026-05-07T01:00:00.000Z',
        finished_at: null,
      }),
    ]);

    const duration = await screen.findByText('2m 14s');
    expect(duration).toBeInTheDocument();
    expect(duration).toHaveAttribute('aria-label', 'running 2m 14s');
    expect(
      screen.getByRole('link', {
        name: (name) => name.includes('deploy-web') && name.includes('running 2m 14s'),
      }),
    ).toBeInTheDocument();
  });

  test('scopes the trigger tooltip to the trigger label', async () => {
    const user = userEvent.setup();
    renderListView([run('failed', 'integration-tests')]);

    await user.hover(
      await screen.findByRole('link', {
        name: (name) =>
          name.includes('integration-tests') && name.includes('github') && name.includes('push'),
      }),
    );

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    await user.hover(screen.getByText('push'));

    expect(await screen.findByRole('tooltip')).toHaveTextContent('github_acme · push');
  });

  test('restores every row after the filters are cleared', async () => {
    const user = userEvent.setup();
    renderListView([
      run('running', 'deploy-web'),
      run('failed', 'integration-tests'),
      run('succeeded', 'build-image'),
    ]);
    await user.type(await screen.findByLabelText('Search runs'), 'no-such-run');

    expect(screen.getByText('No matching runs')).toBeInTheDocument();

    await user.click(await screen.findByRole('button', {name: 'Clear filters'}));

    expect(screen.getByText('deploy-web')).toBeInTheDocument();
    expect(screen.getByText('integration-tests')).toBeInTheDocument();
    expect(screen.getByText('build-image')).toBeInTheDocument();
    expect(screen.getByLabelText('Search runs')).toHaveValue('');
  });
});

function renderListView(runs: WorkflowRunListItem[]) {
  // Row links need router context; the query and data stay injected by props.
  renderWithRouter(
    <WorkflowRunListView
      runs={runs}
      query={loadedQuery()}
      workspaceId={WORKSPACE_ID}
      projectId={PROJECT_ID}
    />,
  );
}

function run(
  status: WorkflowRunStatus,
  name: string,
  id = `run-${name}`,
  overrides: NonNullable<Parameters<typeof workflowRunListItem>[0]> = {},
): WorkflowRunListItem {
  return workflowRunListItem({
    id,
    project_id: PROJECT_ID,
    definition_id: '55555555-5555-4555-8555-555555555555',
    name,
    status,
    trigger_provider: 'github',
    trigger_source: 'github_acme',
    trigger_event: 'push',
    created_at: '2026-05-07T01:01:00.000Z',
    updated_at: '2026-05-07T01:02:00.000Z',
    ...overrides,
  });
}
