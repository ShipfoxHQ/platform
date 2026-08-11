import type {JobStatusDto} from '@shipfox/api-workflows-dto';
import {Code} from '@shipfox/react-ui/typography';
import type {Meta, StoryObj} from '@storybook/react';
import type {ReactNode} from 'react';
import {expect, userEvent, within} from 'storybook/test';
import type {WorkflowRunListItem, WorkflowRunStatus} from '#core/workflow-run.js';
import {sequencedWorkflowRunListItem, workflowRunJobsFixture} from '#test/fixtures/workflow-run.js';
import type {WorkflowRunListQuery} from './types.js';
import {WorkflowRunListView} from './workflow-run-list-view.js';

// Stand-in for the react-query result the view reads. `data !== undefined` is the
// "loaded at least once" signal that splits a fresh load error from a stale refresh.
function makeQuery(overrides: Partial<WorkflowRunListQuery> = {}): WorkflowRunListQuery {
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

const JOB_STRIP_NAME = /jobs:/u;
const STATUS_FILTER = /^Status\b.*filter$/u;

let commitSequence = 0;

// Distinct, plausible SHAs: a story that repeats one commit down the list reads as a bug in
// the row rather than as sample data.
function nextCommit(): string {
  commitSequence += 1;
  return (commitSequence * 0x9e3779b1).toString(16).padStart(8, '0').repeat(5).slice(0, 40);
}

function makeRun(
  status: WorkflowRunStatus,
  name: string,
  minutesAgo: number,
  {
    ref = 'refs/heads/main',
    actor = 'octocat',
    jobs = [],
  }: {ref?: string; actor?: string; jobs?: JobStatusDto[]} = {},
): WorkflowRunListItem {
  return sequencedWorkflowRunListItem(status, name, minutesAgo, {
    workflow_name: name,
    trigger_reference: {repository: 'acme/checkout-api', ref, commit: nextCommit(), actor},
    ...workflowRunJobsFixture(jobs),
  });
}

const SAMPLE_RUNS: WorkflowRunListItem[] = [
  makeRun('running', 'deploy-web', 1, {
    ref: 'refs/pull/482/head',
    jobs: ['succeeded', 'succeeded', 'running', 'pending'],
  }),
  makeRun('failed', 'integration-tests', 4, {
    ref: 'refs/heads/release/v2',
    actor: 'hubot',
    jobs: ['succeeded', 'failed', 'skipped', 'skipped'],
  }),
  makeRun('succeeded', 'build-image', 12, {jobs: ['succeeded', 'succeeded']}),
  makeRun('cancelled', 'lint-and-type', 38, {
    actor: 'dependabot',
    jobs: ['succeeded', 'cancelled'],
  }),
  makeRun('pending', 'release-prod', 2),
  makeRun('succeeded', 'release-production-multi-region-with-canary-and-smoke-tests', 95, {
    ref: 'refs/tags/v2.14.0',
    jobs: ['succeeded', 'succeeded', 'succeeded', 'succeeded', 'succeeded'],
  }),
];

// One story on the full-width page. The data states (loading / empty / errors / runs) are
// driven by args; search, the filter menus, "clear filters" and "no matches" are live in the
// rendered toolbar since the view owns that state. The decorator gives the list a full-width
// subtle canvas and a real height, so `flex-1` scrolls the way it does in the app shell.
const meta = {
  title: 'Workflows/WorkflowRunList',
  component: WorkflowRunListView,
  parameters: {layout: 'centered'},
  decorators: [
    (Story) => (
      <div className="flex h-600 w-full bg-background-subtle-base p-24">
        <Story />
      </div>
    ),
  ],
  args: {
    runs: SAMPLE_RUNS,
    query: makeQuery(),
    workspaceSlug: 'acme',
    projectSlug: 'checkout-api',
  },
} satisfies Meta<typeof WorkflowRunListView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const ExecutionStates: Story = {
  args: {
    runs: [makeExecutionStateRun(), makeListeningStateRun()],
  },
};

/**
 * The row under its one-line threshold, at the 720px a 768px viewport leaves the column.
 *
 * The row's breakpoints are container queries, so narrowing the wrapper is enough to reach
 * this state: identity and numerics hold line one, provenance drops beneath, and the actor
 * and job strip give up their columns. The filter row still renders inline because the sheet
 * it collapses into is keyed to the viewport, not the container.
 */
export const NarrowLayout: Story = {
  decorators: [
    (Story) => (
      <div className="flex w-[720px] max-w-full">
        <Story />
      </div>
    ),
  ],
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);

    await expect(await canvas.findByText('deploy-web')).toBeVisible();
    // The branch stays on the provenance line; the actor is the column that gives way. It is
    // still in the DOM, so visibility is what distinguishes "dropped for width" from
    // "never rendered". `dependabot` is the one actor a single run carries.
    await expect(canvas.getByText('release/v2')).toBeVisible();
    await expect(canvas.getByText('dependabot')).not.toBeVisible();
    await expect(canvas.queryByRole('img', {name: JOB_STRIP_NAME})).not.toBeInTheDocument();
  },
};

/**
 * Row density against the three strip sizes the preview bound has to survive: comfortably under
 * it, just over it, and far enough over that the overflow count carries the failure.
 */
export const JobStripDensity: Story = {
  args: {
    runs: [
      makeRun('succeeded', 'two-jobs', 2, {jobs: ['succeeded', 'succeeded']}),
      makeRun('failed', 'seventeen-jobs', 6, {
        jobs: [
          ...(Array.from({length: 12}, () => 'succeeded') as JobStatusDto[]),
          'failed',
          ...(Array.from({length: 4}, () => 'skipped') as JobStatusDto[]),
        ],
      }),
      makeRun('running', 'forty-jobs', 9, {
        jobs: [
          ...(Array.from({length: 8}, () => 'succeeded') as JobStatusDto[]),
          ...(Array.from({length: 4}, () => 'running') as JobStatusDto[]),
          'failed',
          ...(Array.from({length: 27}, () => 'pending') as JobStatusDto[]),
        ],
      }),
    ],
  },
};

export const DataStates: Story = {
  render: (args) => (
    <div className="grid grid-cols-2 gap-24">
      <StateExample label="Loading">
        <WorkflowRunListView {...args} query={makeQuery({isPending: true, data: undefined})} />
      </StateExample>
      <StateExample label="Empty">
        <WorkflowRunListView {...args} runs={[]} />
      </StateExample>
      <StateExample label="Load error">
        <WorkflowRunListView
          {...args}
          runs={[]}
          query={makeQuery({isError: true, data: undefined})}
        />
      </StateExample>
      <StateExample label="Stale error">
        <WorkflowRunListView {...args} query={makeQuery({isError: true})} />
      </StateExample>
    </div>
  ),
};

export const TestNoMatches: Story = {
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('Search runs'), 'no-such-run');
    await expect(await canvas.findByText('No matching runs')).toBeInTheDocument();
    await expect(canvas.getByRole('button', {name: 'Show all runs'})).toBeInTheDocument();
  },
};

export const TestMultiSelectFilter: Story = {
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', {name: STATUS_FILTER}));
    const menu = await within(document.body).findByRole('menu');
    await userEvent.click(within(menu).getByRole('menuitemcheckbox', {name: 'Failed'}));
    await userEvent.click(within(menu).getByRole('menuitemcheckbox', {name: 'Cancelled'}));
    await userEvent.keyboard('{Escape}');

    // Radix keeps the rest of the document `aria-hidden` until the menu finishes closing, so
    // the trigger is queried with a retrying matcher rather than read on the next tick.
    await expect(await canvas.findByRole('button', {name: STATUS_FILTER})).toHaveTextContent(
      'Status · 2',
    );
    await expect(canvas.getByText('integration-tests')).toBeInTheDocument();
    await expect(canvas.queryByText('build-image')).not.toBeInTheDocument();
  },
};

function StateExample({label, children}: {label: string; children: ReactNode}) {
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <Code variant="label" className="text-foreground-neutral-subtle">
        {label}
      </Code>
      <div className="flex h-560 min-w-0 bg-background-subtle-base p-16">{children}</div>
    </div>
  );
}

function makeExecutionStateRun(): WorkflowRunListItem {
  const fixture = workflowRunJobsFixture(['pending']);
  return sequencedWorkflowRunListItem('running', 'one-shot-executing', 1, {
    ...fixture,
    jobs: fixture.jobs.map((job) => ({...job, execution_status: 'running'})),
    job_status_counts: [{status: 'pending', count: 1}],
    job_display_status_counts: [{status: 'running', count: 1}],
  });
}

function makeListeningStateRun(): WorkflowRunListItem {
  const fixture = workflowRunJobsFixture(['pending']);
  return sequencedWorkflowRunListItem('running', 'event-driven-listener', 3, {
    ...fixture,
    jobs: fixture.jobs.map((job) => ({
      ...job,
      mode: 'listening',
      listener_status: 'listening',
      execution_status: null,
    })),
    job_status_counts: [{status: 'pending', count: 1}],
    job_display_status_counts: [{status: 'listening', count: 1}],
  });
}
