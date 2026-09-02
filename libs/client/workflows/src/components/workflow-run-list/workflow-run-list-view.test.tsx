import type {JobStatusDto} from '@shipfox/api-workflows-dto';
import {WORKFLOW_RUN_JOB_PREVIEW_LIMIT} from '@shipfox/api-workflows-dto';
import {screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {WorkflowRunListItem, WorkflowRunStatus} from '#core/workflow-run.js';
import {
  workflowRunJobsFixture,
  workflowRunJobsOfStatus,
  workflowRunListItem,
} from '#test/fixtures/workflow-run.js';
import {renderWithRouter} from '#test/render.js';
import {JOB_STATUS_STRIP_WIDTH, jobStatusStripWidthForPreview} from './job-status-strip.js';
import type {WorkflowRunListQuery, WorkflowRunListViewProps} from './types.js';
import {WorkflowRunListView} from './workflow-run-list-view.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const JOB_STRIP_LABEL_RE = /jobs:/u;
const JOB_SUMMARY_NAME_RE = /queued-build/u;
const OVERFLOW_COUNT_RE = /^\+/u;
const DEPLOY_WEB_RE = /deploy-web/u;
const WORKSPACE_SLUG = 'acme';
const PROJECT_SLUG = 'checkout-api';

function loadedQuery(overrides: Partial<WorkflowRunListQuery> = {}): WorkflowRunListQuery {
  return {
    isPending: false,
    isError: false,
    isFetching: false,
    data: {pages: [], pageParams: []},
    error: null,
    refetch: () => undefined,
    ...overrides,
  };
}

describe('WorkflowRunListView', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('panel composition', () => {
    test('keeps the controls in the panel header and states in its body', async () => {
      renderListView([run('succeeded', 'build-image')]);
      await screen.findByText('build-image');

      const panel = document.querySelector<HTMLElement>('[data-slot="panel"]');
      const header = panel?.querySelector<HTMLElement>('[data-slot="panel-header"]');
      const body = panel?.querySelector<HTMLElement>('[data-slot="panel-body"]');

      expect(panel).not.toBeNull();
      expect(document.querySelectorAll('[data-slot="panel"]')).toHaveLength(1);
      expect(header).not.toBeNull();
      expect(body).not.toBeNull();
      expect(within(header as HTMLElement).getByLabelText('Search runs')).toBeInTheDocument();
      expect(
        within(header as HTMLElement).getByRole('button', {name: filterTrigger('Workflow')}),
      ).toBeInTheDocument();
      expect(
        within(header as HTMLElement).getByRole('button', {name: filterTrigger('Status')}),
      ).toBeInTheDocument();
      expect(
        within(header as HTMLElement).getByRole('button', {name: filterTrigger('Branch')}),
      ).toBeInTheDocument();
      expect(
        within(header as HTMLElement).getByRole('button', {name: filterTrigger('Actor')}),
      ).toBeInTheDocument();
      expect(
        within(header as HTMLElement).getByRole('button', {name: filterTrigger('Event')}),
      ).toBeInTheDocument();
      expect(
        within(header as HTMLElement).queryByRole('button', {name: filterTrigger('Origin')}),
      ).not.toBeInTheDocument();
      expect(
        within(header as HTMLElement).getByLabelText('Filter runs by creation date'),
      ).toBeInTheDocument();
      expect(within(body as HTMLElement).getByText('build-image')).toBeInTheDocument();
    });
  });

  describe('filtering', () => {
    test('narrows the list to the selected workflow', async () => {
      const user = userEvent.setup();
      renderListView([
        run('succeeded', 'deploy-run', 'run-1', {
          definition_id: '55555555-5555-4555-8555-000000000001',
          workflow_name: 'Deploy production',
        }),
        run('failed', 'ci-run', 'run-2', {
          definition_id: '55555555-5555-4555-8555-000000000002',
          workflow_name: 'CI',
        }),
      ]);

      await selectWorkflowFilter(user, 'Deploy production');

      expect(screen.getByText('deploy-run')).toBeInTheDocument();
      expect(screen.queryByText('ci-run')).not.toBeInTheDocument();
      expect(screen.getByRole('button', {name: filterTrigger('Workflow')})).toHaveTextContent(
        'Workflow: Deploy production',
      );
      expect(screen.getByRole('button', {name: 'Filters (1)'})).toBeInTheDocument();
    });

    test('clears the workflow filter when its selected option is chosen again', async () => {
      const user = userEvent.setup();
      renderListView([
        run('succeeded', 'deploy-run', 'run-1', {
          definition_id: '55555555-5555-4555-8555-000000000001',
          workflow_name: 'Deploy production',
        }),
        run('failed', 'ci-run', 'run-2', {
          definition_id: '55555555-5555-4555-8555-000000000002',
          workflow_name: 'CI',
        }),
      ]);

      await selectWorkflowFilter(user, 'Deploy production');
      await selectWorkflowFilter(user, 'Deploy production');

      expect(screen.getByText('deploy-run')).toBeInTheDocument();
      expect(screen.getByText('ci-run')).toBeInTheDocument();
      expect(screen.getByRole('button', {name: filterTrigger('Workflow')})).toHaveTextContent(
        'Workflow',
      );
    });

    test('offers project workflows outside the loaded run history', async () => {
      const user = userEvent.setup();
      const onOpenWorkflowOptions = vi.fn();
      renderListView([run('succeeded', 'deploy-run')], {
        workflowOptions: [
          {value: '55555555-5555-4555-8555-000000000001', label: 'Deploy production'},
          {value: '55555555-5555-4555-8555-000000000002', label: 'Nightly'},
        ],
        onOpenWorkflowOptions,
      });

      await user.click(await screen.findByRole('button', {name: filterTrigger('Workflow')}));

      expect(onOpenWorkflowOptions).toHaveBeenCalledOnce();
      expect(await screen.findByLabelText('Search workflows')).toBeInTheDocument();
      expect(await screen.findByRole('option', {name: 'Nightly'})).toBeInTheDocument();
    });

    test('uses a human fallback for a selected workflow that has not loaded', async () => {
      renderListView([], {
        search: {workflow: '55555555-5555-4555-8555-000000000009'},
      });

      expect(
        await screen.findByRole('button', {name: filterTrigger('Workflow')}),
      ).toHaveTextContent('Workflow: Unknown workflow');
    });

    test('reports workflow option loading in the chooser', async () => {
      const user = userEvent.setup();
      renderListView([], {workflowOptionsStatus: 'loading'});

      await user.click(await screen.findByRole('button', {name: filterTrigger('Workflow')}));

      expect(await screen.findByRole('status')).toHaveTextContent('Loading workflows...');
      expect(screen.queryByText('No workflows found.')).not.toBeInTheDocument();
    });

    test('reports workflow option failures and retries them', async () => {
      const user = userEvent.setup();
      const onRetryWorkflowOptions = vi.fn();
      renderListView([], {workflowOptionsStatus: 'error', onRetryWorkflowOptions});

      await user.click(await screen.findByRole('button', {name: filterTrigger('Workflow')}));
      expect(await screen.findByRole('alert')).toHaveTextContent('Could not load all workflows.');
      expect(screen.queryByText('No workflows found.')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', {name: 'Retry'}));

      expect(onRetryWorkflowOptions).toHaveBeenCalledOnce();
    });

    test('narrows the list to the selected status', async () => {
      const user = userEvent.setup();
      renderListView([
        run('running', 'deploy-web'),
        run('failed', 'integration-tests'),
        run('succeeded', 'build-image'),
      ]);

      await selectFilterOption(user, 'Status', 'Failed');

      expect(screen.getByText('integration-tests')).toBeInTheDocument();
      expect(screen.queryByText('deploy-web')).not.toBeInTheDocument();
      expect(screen.queryByText('build-image')).not.toBeInTheDocument();
    });

    test('keeps both statuses when two are selected', async () => {
      const user = userEvent.setup();
      renderListView([
        run('running', 'deploy-web'),
        run('failed', 'integration-tests'),
        run('succeeded', 'build-image'),
      ]);

      await selectFilterOption(user, 'Status', 'Failed');
      await selectFilterOption(user, 'Status', 'Succeeded');

      expect(screen.getByText('integration-tests')).toBeInTheDocument();
      expect(screen.getByText('build-image')).toBeInTheDocument();
      expect(screen.queryByText('deploy-web')).not.toBeInTheDocument();
    });

    test('the running status keeps in-progress pending runs alongside running ones', async () => {
      const user = userEvent.setup();
      renderListView([
        run('running', 'deploy-web'),
        run('pending', 'queued-build'),
        run('succeeded', 'build-image'),
      ]);

      await selectFilterOption(user, 'Status', 'Running');

      expect(screen.getByText('deploy-web')).toBeInTheDocument();
      expect(screen.getByText('queued-build')).toBeInTheDocument();
      expect(screen.queryByText('build-image')).not.toBeInTheDocument();
    });

    test('narrows the list by branch, using options read off the loaded runs', async () => {
      const user = userEvent.setup();
      renderListView([
        run('succeeded', 'deploy-web', 'run-1', {
          trigger_reference: reference({ref: 'refs/heads/main'}),
        }),
        run('succeeded', 'deploy-api', 'run-2', {
          trigger_reference: reference({ref: 'refs/heads/release/v2'}),
        }),
      ]);

      await selectFilterOption(user, 'Branch', 'release/v2');

      expect(screen.getByText('deploy-api')).toBeInTheDocument();
      expect(screen.queryByText('deploy-web')).not.toBeInTheDocument();
    });

    test('narrows the list by actor', async () => {
      const user = userEvent.setup();
      renderListView([
        run('succeeded', 'deploy-web', 'run-1', {trigger_reference: reference({actor: 'octocat'})}),
        run('succeeded', 'deploy-api', 'run-2', {trigger_reference: reference({actor: 'hubot'})}),
      ]);

      await selectFilterOption(user, 'Actor', 'hubot');

      expect(screen.getByText('deploy-api')).toBeInTheDocument();
      expect(screen.queryByText('deploy-web')).not.toBeInTheDocument();
    });

    test('narrows the list by trigger event', async () => {
      const user = userEvent.setup();
      renderListView([
        run('succeeded', 'deploy-web', 'run-1', {trigger_event: 'push'}),
        run('succeeded', 'deploy-api', 'run-2', {trigger_event: 'pull_request'}),
      ]);

      await selectFilterOption(user, 'Event', 'pull_request');

      expect(screen.getByText('deploy-api')).toBeInTheDocument();
      expect(screen.queryByText('deploy-web')).not.toBeInTheDocument();
    });

    test('names the selected value on the trigger instead of only a count', async () => {
      const user = userEvent.setup();
      renderListView([run('failed', 'integration-tests')]);

      await selectFilterOption(user, 'Status', 'Failed');

      const trigger = screen.getByRole('button', {name: filterTrigger('Status')});
      expect(trigger).toHaveTextContent('Status: Failed');
      // The value is in the accessible name too, not just the visible label.
      expect(trigger).toHaveAccessibleName('Status: Failed filter');
    });

    test('includes workflow and origin when a controlled consumer uses the default clear path', async () => {
      const user = userEvent.setup();
      const onFiltersChange = vi.fn();
      renderWithRouter(
        <WorkflowRunListView
          runs={[run('succeeded', 'triage-sentry', 'run-2', devRunOverrides())]}
          query={loadedQuery()}
          search={{
            workflow: '55555555-5555-4555-8555-555555555555',
            origin: 'dev',
          }}
          onFiltersChange={onFiltersChange}
        />,
      );

      await user.click(await screen.findByRole('button', {name: 'Clear filters'}));

      expect(onFiltersChange).toHaveBeenCalledWith(
        expect.objectContaining({workflow: undefined, origin: undefined}),
      );
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

      await user.click(screen.getByRole('button', {name: 'Clear filters'}));

      expect(screen.getByText('deploy-web')).toBeInTheDocument();
      expect(screen.getByText('integration-tests')).toBeInTheDocument();
      expect(screen.getByText('build-image')).toBeInTheDocument();
      expect(screen.getByLabelText('Search runs')).toHaveValue('');
    });

    test('offers no way to clear filters while none are active', async () => {
      renderListView([run('succeeded', 'build-image')]);

      expect(await screen.findByText('build-image')).toBeInTheDocument();
      expect(screen.queryByRole('button', {name: 'Clear filters'})).not.toBeInTheDocument();
    });

    test('does not count text search in the compact filter badge', async () => {
      const user = userEvent.setup();
      renderListView([run('succeeded', 'build-image')]);

      await user.type(await screen.findByLabelText('Search runs'), 'build');

      expect(screen.getByRole('button', {name: 'Filters'})).toBeInTheDocument();
      expect(screen.queryByRole('button', {name: 'Filters (1)'})).not.toBeInTheDocument();
    });
  });

  describe('interaction states', () => {
    test('renders skeleton rows while the first page loads', async () => {
      renderListView([], {query: loadedQuery({isPending: true, data: undefined})});

      expect(await screen.findByLabelText('Loading runs')).toBeInTheDocument();
      expect(document.querySelectorAll('[data-slot="panel"]')).toHaveLength(1);
      expect(screen.queryByText('No runs yet')).not.toBeInTheDocument();
    });

    test('keeps the filter row usable while loading', async () => {
      renderListView([], {query: loadedQuery({isPending: true, data: undefined})});

      expect(await screen.findByLabelText('Search runs')).toBeInTheDocument();
    });

    test('offers the onboarding call to action when a project has no runs at all', async () => {
      renderListView([]);

      expect(await screen.findByText('No runs yet')).toBeInTheDocument();
      expect(document.querySelectorAll('[data-slot="panel"]')).toHaveLength(1);
      expect(screen.getByRole('link', {name: 'View workflows'})).toBeInTheDocument();
      expect(screen.queryByRole('button', {name: 'Show all runs'})).not.toBeInTheDocument();
    });

    test('offers a way out rather than onboarding when filters emptied the list', async () => {
      const user = userEvent.setup();
      renderListView([run('succeeded', 'build-image')]);

      await user.type(await screen.findByLabelText('Search runs'), 'no-such-run');

      expect(screen.getByText('No matching runs')).toBeInTheDocument();
      expect(document.querySelectorAll('[data-slot="panel"]')).toHaveLength(1);
      expect(screen.queryByText('No runs yet')).not.toBeInTheDocument();
      expect(screen.getByRole('button', {name: 'Show all runs'})).toBeInTheDocument();
    });

    test('reports a filtered empty list as no matches even when nothing loaded', async () => {
      const user = userEvent.setup();
      renderListView([run('succeeded', 'build-image')]);

      await selectFilterOption(user, 'Status', 'Cancelled');

      expect(screen.getByText('No matching runs')).toBeInTheDocument();
      expect(screen.queryByText('No runs yet')).not.toBeInTheDocument();
    });

    test('renders a failed first fetch as an error, never as an empty list', async () => {
      renderListView([], {
        query: loadedQuery({isError: true, data: undefined, error: new Error('boom')}),
      });

      expect(await screen.findByLabelText('Search runs')).toBeInTheDocument();
      expect(document.querySelectorAll('[data-slot="panel"]')).toHaveLength(1);
      expect(screen.queryByText('No runs yet')).not.toBeInTheDocument();
      expect(screen.queryByText('No matching runs')).not.toBeInTheDocument();
    });

    test('still reports no matches under a stale-refresh banner', async () => {
      const user = userEvent.setup();
      renderListView([run('succeeded', 'build-image')], {
        query: loadedQuery({isError: true, error: new Error('boom')}),
      });

      await user.type(await screen.findByLabelText('Search runs'), 'no-such-run');

      expect(screen.getByText('Could not refresh workflow runs.')).toBeInTheDocument();
      expect(screen.getByText('No matching runs')).toBeInTheDocument();
    });

    test('keeps loaded rows and the filters behind a retry when a refetch fails', async () => {
      const user = userEvent.setup();
      const refetch = vi.fn();
      renderListView([run('succeeded', 'build-image')], {
        query: loadedQuery({isError: true, error: new Error('boom'), refetch}),
      });

      expect(await screen.findByText('build-image')).toBeInTheDocument();
      expect(screen.getByText('Could not refresh workflow runs.')).toBeInTheDocument();

      await user.click(screen.getByRole('button', {name: 'Retry'}));

      expect(refetch).toHaveBeenCalledOnce();
    });

    test('offers an explicit load more when more pages exist', async () => {
      const user = userEvent.setup();
      const onLoadMore = vi.fn();
      renderListView([run('succeeded', 'recent-run')], {hasNextPage: true, onLoadMore});

      await user.click(await screen.findByRole('button', {name: 'Load more runs'}));

      expect(onLoadMore).toHaveBeenCalledOnce();
    });

    test('offers older pages before reporting that a filter has no matches', async () => {
      const user = userEvent.setup();
      const onLoadMore = vi.fn();
      renderListView([run('succeeded', 'recent-run')], {hasNextPage: true, onLoadMore});

      await user.type(await screen.findByLabelText('Search runs'), 'older-run');

      expect(screen.getByText('No matches in loaded history')).toBeInTheDocument();
      await user.click(screen.getByRole('button', {name: 'Load more runs'}));
      expect(onLoadMore).toHaveBeenCalledOnce();
    });
  });

  describe('row anatomy', () => {
    test('renders the branch, commit, and actor a source-control trigger carries', async () => {
      renderListView([
        run('succeeded', 'deploy-web', 'run-1', {
          trigger_reference: {
            repository: 'acme/api',
            ref: 'refs/heads/release/v2',
            commit: 'abcdef1234567890',
            actor: 'octocat',
          },
        }),
      ]);

      expect(await screen.findByText('release/v2')).toBeInTheDocument();
      expect(screen.getByText('abcdef1')).toBeInTheDocument();
      expect(screen.getByText('octocat')).toBeInTheDocument();
    });

    test('labels a dev run with a Dev badge and its ref and commit from the dev source', async () => {
      renderListView([run('succeeded', 'triage-sentry', 'run-1', devRunOverrides())]);

      expect(await screen.findByText('triage-sentry')).toBeInTheDocument();
      expect(screen.getByText('Dev')).toHaveClass('bg-tag-purple-bg');
      // No trigger reference: the row's branch and commit come from the dev source.
      expect(screen.getByText('fix-triage-prompt')).toBeInTheDocument();
      expect(screen.getByText('abcdef1')).toBeInTheDocument();
      expect(
        screen.getByRole('link', {name: (name) => name.includes('dev run')}),
      ).toBeInTheDocument();
    });

    test('shows no Dev badge on a synced run', async () => {
      renderListView([run('succeeded', 'deploy-web', 'run-1')]);

      expect(await screen.findByText('deploy-web')).toBeInTheDocument();
      expect(screen.queryByText('Dev')).not.toBeInTheDocument();
    });

    test('shows a pull request ref by number rather than as a raw ref', async () => {
      renderListView([
        run('succeeded', 'deploy-web', 'run-1', {
          trigger_reference: reference({ref: 'refs/pull/42/head'}),
        }),
      ]);

      expect(await screen.findByText('#42')).toBeInTheDocument();
    });

    test('summarizes the job strip as one accessible name rather than one per glyph', async () => {
      renderListView([
        run('failed', 'deploy-web', 'run-1', {
          ...workflowRunJobsFixture(['succeeded', 'failed', 'pending']),
        }),
      ]);

      expect(
        await screen.findByRole('img', {name: '3 jobs: 1 failed, 1 pending, 1 succeeded'}),
      ).toBeInTheDocument();
    });

    test('shows an executing one-shot job instead of its pending verdict', async () => {
      const {jobs} = workflowRunJobsFixture(['pending']);
      renderListView([
        run('running', 'deploy-web', 'run-1', {
          jobs: jobs.map((job) => ({...job, execution_status: 'running'})),
          job_status_counts: [{status: 'pending', count: 1}],
          job_display_status_counts: [{status: 'running', count: 1}],
        }),
      ]);

      const strip = await screen.findByRole('img', {name: '1 job: 1 running'});
      expect(within(strip).getByLabelText('Running')).toBeInTheDocument();
    });

    test('shows an active listener as listening in the job strip', async () => {
      const {jobs} = workflowRunJobsFixture(['running']);
      renderListView([
        run('running', 'event-driven', 'run-1', {
          jobs: jobs.map((job) => ({
            ...job,
            mode: 'listening',
            listener_status: 'listening',
            execution_status: null,
          })),
          job_status_counts: [{status: 'running', count: 1}],
          job_display_status_counts: [{status: 'listening', count: 1}],
        }),
      ]);

      const strip = await screen.findByRole('img', {name: '1 job: 1 listening'});
      expect(within(strip).getByLabelText('Listening')).toBeInTheDocument();
    });

    test('shows a failed execution when the job verdict is still pending', async () => {
      const {jobs} = workflowRunJobsFixture(['pending']);
      renderListView([
        run('running', 'deploy-web', 'run-1', {
          jobs: jobs.map((job) => ({...job, execution_status: 'failed'})),
          job_status_counts: [{status: 'pending', count: 1}],
          job_display_status_counts: [{status: 'failed', count: 1}],
        }),
      ]);

      const strip = await screen.findByRole('img', {name: '1 job: 1 failed'});
      expect(within(strip).getByLabelText('Failed')).toBeInTheDocument();
    });

    // The link's aria-label replaces its contents, so the strip's own label is not spoken
    // when the row is announced as a link. Where a run failed has to survive that.
    test('carries the job breakdown into the row link name', async () => {
      renderListView([
        run('failed', 'deploy-web', 'run-1', {
          ...workflowRunJobsFixture(['succeeded', 'failed', 'pending']),
        }),
      ]);

      expect(
        await screen.findByRole('link', {
          name: (name) => name.includes('3 jobs: 1 failed, 1 pending, 1 succeeded'),
        }),
      ).toBeInTheDocument();
    });

    test('leaves the job breakdown out of the link name when no jobs are planned', async () => {
      renderListView([run('pending', 'queued-build', 'run-1', {...workflowRunJobsFixture([])})]);

      const link = await screen.findByRole('link', {name: JOB_SUMMARY_NAME_RE});
      expect(link.getAttribute('aria-label')).not.toContain('jobs:');
    });

    test('counts the jobs it had to hide beyond the strip threshold', async () => {
      renderListView([run('running', 'deploy-web', 'run-1', {...workflowRunJobsOfStatus(40)})]);

      expect(await screen.findByText('+24')).toBeInTheDocument();
      expect(screen.getByRole('img', {name: '40 jobs: 40 succeeded'})).toBeInTheDocument();
    });

    test('renders every job in the API preview without a client-side cap', async () => {
      renderListView([run('running', 'deploy-web', 'run-1', {...workflowRunJobsOfStatus(16)})]);

      const strip = await screen.findByRole('img', {name: '16 jobs: 16 succeeded'});

      expect(within(strip).getAllByLabelText('Succeeded')).toHaveLength(16);
      expect(within(strip).queryByText(OVERFLOW_COUNT_RE)).not.toBeInTheDocument();
    });

    test('reserves the full API preview and overflow marker width', () => {
      expect(jobStatusStripWidthForPreview(WORKFLOW_RUN_JOB_PREVIEW_LIMIT)).toBe(294);
      expect(JOB_STATUS_STRIP_WIDTH).toBe(294);
    });

    // The API sends a bounded preview, so a run whose only failure sits past it has no failed
    // job in the payload at all. The counts still carry it, and the overflow glyph has to say
    // so rather than showing an unbroken row of green.
    test('reports a failure that sits beyond the fetched preview', async () => {
      const statuses = [
        ...(Array.from({length: 20}, () => 'succeeded') as JobStatusDto[]),
        'failed' as const,
      ];
      renderListView([run('failed', 'deploy-web', 'run-1', {...workflowRunJobsFixture(statuses)})]);

      const strip = await screen.findByRole('img', {
        name: '21 jobs: 1 failed, 20 succeeded',
      });
      expect(strip).toBeInTheDocument();
      expect(screen.getByText('+5')).toBeInTheDocument();
      expect(within(strip).getByLabelText('Failed')).toBeInTheDocument();
    });

    test('reports listening jobs in the overflow glyph and tooltip', async () => {
      const {jobs} = workflowRunJobsFixture(
        Array.from({length: 16}, () => 'pending') as JobStatusDto[],
      );
      renderListView([
        run('running', 'event-driven', 'run-listener', {
          jobs: jobs.map((job) => ({
            ...job,
            mode: 'listening',
            listener_status: 'listening',
            execution_status: null,
          })),
          job_status_counts: [{status: 'pending', count: 20}],
          job_display_status_counts: [{status: 'listening', count: 20}],
        }),
      ]);

      const strip = await screen.findByRole('img', {name: '20 jobs: 20 listening'});
      expect(screen.getByText('+4')).toBeInTheDocument();
      expect(within(strip).getAllByLabelText('Listening')).toHaveLength(17);

      const user = userEvent.setup();
      await user.hover(strip);
      expect(await screen.findByRole('tooltip')).toHaveTextContent('and 14 more');
    });

    // Nothing caps a workflow's job count, so an exact overflow count is unbounded in width
    // and would eventually paint over the duration column beside it.
    test('abbreviates an overflow count too wide to print exactly', async () => {
      renderListView([
        run('running', 'huge', 'run-1', {
          ...workflowRunJobsOfStatus(12_000, 'pending'),
        }),
      ]);

      expect(await screen.findByText('+12K')).toBeInTheDocument();
      // The exact figure survives where a precise number is actually read.
      expect(screen.getByRole('img', {name: '12000 jobs: 12000 pending'})).toBeInTheDocument();
    });

    test('renders no strip for a run whose jobs are not planned yet', async () => {
      renderListView([run('pending', 'queued-build', 'run-1', {...workflowRunJobsFixture([])})]);

      expect(await screen.findByText('queued-build')).toBeInTheDocument();
      expect(screen.queryByRole('img', {name: JOB_STRIP_LABEL_RE})).not.toBeInTheDocument();
    });

    test('renders optimistic temp runs without a navigable link', async () => {
      const optimisticRun = {
        ...run('pending', 'queued-build', 'temp-1234', {
          definition_id: '',
          workflow_name: 'CI',
        }),
        number: null,
      };
      renderListView([optimisticRun, run('running', 'deploy-web')]);

      // The canonical run is a link to its detail page; the optimistic temp run is shown but
      // not yet navigable (its detail page does not exist until the canonical row replaces it).
      const links = await screen.findAllByRole('link');
      expect(links.some((link) => link.textContent?.includes('deploy-web'))).toBe(true);
      expect(links.some((link) => link.textContent?.includes('queued-build'))).toBe(false);
      expect(screen.getByText('queued-build')).toBeInTheDocument();
      expect(screen.queryByText('CI #1')).not.toBeInTheDocument();
    });

    test('pins the list row to its current attempt and clears legacy selection search', async () => {
      renderListView([
        run('running', 'deploy-web', 'run-deploy-web', {
          current_attempt: 3,
          latest_attempt: 3,
        }),
      ]);

      const link = await screen.findByRole('link', {name: DEPLOY_WEB_RE});

      expect(link).toHaveAttribute(
        'href',
        '/w/acme/p/checkout-api/runs/run-deploy-web?runAttempt=3',
      );
    });

    test('shows a finished run duration in the row metadata', async () => {
      renderListView([
        run('succeeded', 'build-image', 'run-build-image', {
          started_at: '2026-05-07T01:00:00.000Z',
          finished_at: '2026-05-07T01:02:14.000Z',
          has_started_job_execution: true,
        }),
      ]);

      const duration = await screen.findByText('2m 14s');
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
      expect(duration).toHaveAttribute('aria-label', 'running 2m 14s');
    });

    test('uses the attempt status when all listed jobs are pending', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-05-07T01:02:14.000Z'));

      renderListView([
        run('running', 'waiting-for-runner', 'run-waiting-for-runner', {
          ...workflowRunJobsFixture(['pending', 'pending']),
          started_at: '2026-05-07T01:00:00.000Z',
          finished_at: null,
        }),
      ]);

      const duration = await screen.findByText('2m 14s');
      expect(duration).toHaveAttribute('aria-label', 'running 2m 14s');
      expect(
        screen.getByRole('link', {
          name: (name) => name.includes('Running') && name.includes('running 2m 14s'),
        }),
      ).toBeInTheDocument();
    });

    test('uses a neutral verb when no listed job execution started', async () => {
      renderListView([
        run('cancelled', 'cancelled-before-runner', 'run-cancelled-before-runner', {
          ...workflowRunJobsFixture(['pending']),
          started_at: '2026-05-07T01:00:00.000Z',
          finished_at: '2026-05-07T01:02:14.000Z',
        }),
      ]);

      const duration = await screen.findByText('2m 14s');
      expect(duration).toHaveAttribute('aria-label', 'lasted 2m 14s');
    });

    test('uses the started-execution flag when a cancelled job reached a runner', async () => {
      renderListView([
        run('cancelled', 'cancelled-after-start', 'run-cancelled-after-start', {
          ...workflowRunJobsFixture(['cancelled']),
          has_started_job_execution: true,
          started_at: '2026-05-07T01:00:00.000Z',
          finished_at: '2026-05-07T01:02:14.000Z',
        }),
      ]);

      const duration = await screen.findByText('2m 14s');
      expect(duration).toHaveAttribute('aria-label', 'ran 2m 14s');
    });

    test('renders the workflow name beside the run number', async () => {
      renderListView([
        run('succeeded', 'Deploy production', 'run-deploy-production', {
          number: 5184,
          workflow_name: 'CI',
        }),
      ]);

      expect(await screen.findByText('CI #5184')).toBeInTheDocument();
      expect(
        screen.getByRole('link', {name: (name) => name.includes('CI #5184')}),
      ).toBeInTheDocument();
    });

    test('scopes the trigger tooltip to the trigger label', async () => {
      const user = userEvent.setup();
      renderListView([run('failed', 'integration-tests')]);

      await user.hover(await screen.findByText('push'));

      expect(await screen.findByRole('tooltip')).toHaveTextContent('github_acme · push');
    });
  });
});

function renderListView(
  runs: WorkflowRunListItem[],
  {
    query = loadedQuery(),
    ...options
  }: Partial<
    Pick<
      WorkflowRunListViewProps,
      | 'hasNextPage'
      | 'onLoadMore'
      | 'query'
      | 'search'
      | 'workflowOptions'
      | 'workflowOptionsStatus'
      | 'onOpenWorkflowOptions'
      | 'onRetryWorkflowOptions'
    >
  > = {},
) {
  // Row links need router context; the query and data stay injected by props.
  renderWithRouter(
    <WorkflowRunListView
      runs={runs}
      query={query}
      workspaceSlug={WORKSPACE_SLUG}
      projectSlug={PROJECT_SLUG}
      {...options}
    />,
  );
}

async function selectWorkflowFilter(user: ReturnType<typeof userEvent.setup>, workflow: string) {
  await user.click(await screen.findByRole('button', {name: filterTrigger('Workflow')}));
  await user.click(await screen.findByRole('option', {name: workflow}));
}

/** Matches a filter trigger by its label, whatever value it currently reports. */
function filterTrigger(label: string): RegExp {
  return new RegExp(`^${label}\\b.*filter$`, 'u');
}

async function selectFilterOption(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string,
) {
  await user.click(await screen.findByRole('button', {name: filterTrigger(label)}));
  const menu = await screen.findByRole('menu');
  const item = within(menu).getByRole('menuitemcheckbox', {name: option});
  await user.click(item);
  await user.keyboard('{Escape}');
}

function reference(overrides: Partial<NonNullable<WorkflowRunListItem['triggerReference']>> = {}) {
  return {
    repository: 'acme/api',
    ref: 'refs/heads/main',
    commit: 'abcdef1234567890',
    actor: 'octocat',
    ...overrides,
  };
}

function devRunOverrides(): NonNullable<Parameters<typeof workflowRunListItem>[0]> {
  return {
    origin: 'dev',
    trigger_reference: null,
    dev_source: {
      ref: 'fix-triage-prompt',
      commit: 'abcdef1234567890abcdef1234567890abcdef12',
      config_path: '.shipfox/workflows/triage-sentry.yml',
      initiated_by_user_id: '99999999-9999-4999-8999-999999999999',
      replay_of_event_id: null,
    },
  };
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
