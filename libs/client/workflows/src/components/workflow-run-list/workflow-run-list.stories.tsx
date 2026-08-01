import {Code} from '@shipfox/react-ui/typography';
import type {Meta, StoryObj} from '@storybook/react';
import type {ReactNode} from 'react';
import {expect, userEvent, within} from 'storybook/test';
import type {WorkflowRunListItem, WorkflowRunStatus} from '#core/workflow-run.js';
import {sequencedWorkflowRunListItem} from '#test/fixtures/workflow-run.js';
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

function makeRun(status: WorkflowRunStatus, name: string, minutesAgo: number): WorkflowRunListItem {
  return sequencedWorkflowRunListItem(status, name, minutesAgo);
}

const SAMPLE_RUNS: WorkflowRunListItem[] = [
  makeRun('running', 'deploy-web', 1),
  makeRun('failed', 'integration-tests', 4),
  makeRun('succeeded', 'build-image', 12),
  makeRun('cancelled', 'lint-and-type', 38),
  makeRun('pending', 'release-prod', 0),
  makeRun('succeeded', 'release-production-multi-region-with-canary-and-smoke-tests', 95),
];

// One story on the full rail. The data states (loading / empty / errors / runs) are
// driven by args; search, status filter, "clear filters" and "no matches" are live in
// the rendered toolbar since the view owns that state. The decorator gives the rail a
// real height so `flex-1` content scrolls the way it does in the app shell.
const meta = {
  title: 'Workflows/WorkflowRunList',
  component: WorkflowRunListView,
  parameters: {layout: 'centered'},
  decorators: [
    (Story) => (
      <div className="flex h-600">
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

export const Selected: Story = {
  args: {selectedWorkflowRunId: SAMPLE_RUNS[1].id},
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
  },
};

function StateExample({label, children}: {label: string; children: ReactNode}) {
  return (
    <div className="flex w-304 flex-col gap-8">
      <Code variant="label" className="text-foreground-neutral-subtle">
        {label}
      </Code>
      <div className="flex h-560 rounded-8 border border-border-neutral-base bg-background-neutral-base">
        {children}
      </div>
    </div>
  );
}
