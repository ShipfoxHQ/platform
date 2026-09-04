import type {Meta, StoryObj} from '@storybook/react';
import {within} from 'storybook/test';
import type {WorkflowRunOverview, WorkflowRunOverviewJob} from '#core/workflow-run.js';
import {workflowRunOverview, workflowRunOverviewJob} from '#test/fixtures/workflow-run.js';
import {JobGraph} from './job-graph.js';

const meta = {
  title: 'Workflows/JobGraph',
  component: JobGraph,
  parameters: {layout: 'centered'},
  decorators: [
    (Story) => (
      <div className="h-520 w-900 overflow-auto bg-background-subtle-base p-16">
        <Story />
      </div>
    ),
  ],
  args: {
    className: 'h-full',
  },
} satisfies Meta<typeof JobGraph>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: {run: makeRun({jobs: [makeJob({name: 'build'})]})},
};

export const LinearTenJobs: Story = {
  args: {run: makeRun({jobs: linearJobs(10)})},
};

export const ParallelTenJobs: Story = {
  args: {
    run: makeRun({
      jobs: Array.from({length: 10}, (_, index) =>
        makeJob({name: `job-${String(index + 1).padStart(2, '0')}`, position: index}),
      ),
    }),
  },
};

export const BranchAndJoin: Story = {
  args: {
    run: makeRun({
      jobs: [
        makeJob({name: 'build', position: 0, status: 'succeeded'}),
        makeJob({name: 'lint', position: 1, dependencies: ['build'], status: 'succeeded'}),
        makeJob({name: 'test', position: 2, dependencies: ['build'], status: 'running'}),
        makeJob({name: 'deploy', position: 3, dependencies: ['lint', 'test']}),
      ],
    }),
  },
};

export const UnevenJoinFromSharedTrigger: Story = {
  args: {
    run: unevenJoinRun(),
  },
};

export const TwoRunningJobs: Story = {
  args: {
    run: makeRun({
      jobs: [
        makeJob({name: 'linux', position: 0, status: 'running'}),
        makeJob({name: 'macos', position: 1, status: 'running'}),
      ],
    }),
  },
};

export const UpstreamFailureSkipsDownstream: Story = {
  args: {
    run: makeRun({
      jobs: [
        makeJob({name: 'build', status: 'failed'}),
        makeJob({
          name: 'deploy',
          position: 1,
          dependencies: ['build'],
          status: 'skipped',
          status_reason: 'dependency_not_completed',
        }),
      ],
    }),
  },
};

export const Empty: Story = {
  args: {run: makeRun({jobs: []})},
};

export const LargeWideAndTall: Story = {
  args: {
    run: makeRun({
      jobs: [
        ...linearJobs(10),
        ...Array.from({length: 10}, (_, index) =>
          makeJob({
            name: `parallel-${String(index + 1).padStart(2, '0')}`,
            position: 20 + index,
            status: index < 2 ? 'running' : 'pending',
          }),
        ),
      ],
    }),
  },
};

export const Selected: Story = {
  args: {
    run: makeRun({
      jobs: [
        makeJob({name: 'build', status: 'succeeded'}),
        makeJob({name: 'deploy', position: 1, dependencies: ['build'], status: 'running'}),
      ],
    }),
  },
  play: async ({canvasElement}) => {
    await within(canvasElement)
      .getByRole('button', {
        name: 'deploy, Running',
      })
      .click();
  },
};

function linearJobs(count: number): WorkflowRunOverviewJob[] {
  return Array.from({length: count}, (_, index) =>
    makeJob({
      name: `job-${String(index + 1).padStart(2, '0')}`,
      position: index,
      dependencies: index === 0 ? [] : [`job-${String(index).padStart(2, '0')}`],
      status: index < count - 1 ? 'succeeded' : 'running',
    }),
  );
}

function unevenJoinRun(): WorkflowRunOverview {
  const packageJob = makeJob({name: 'package', position: 0, status: 'succeeded'});
  const securityScan = makeJob({name: 'security-scan', position: 1, status: 'succeeded'});
  const smokeTests = makeJob({
    name: 'smoke-tests',
    position: 2,
    dependencies: ['package'],
    status: 'running',
  });
  const deploy = makeJob({
    name: 'deploy',
    position: 3,
    dependencies: ['smoke-tests', 'security-scan'],
  });

  return makeRun({
    jobs: [packageJob, securityScan, smokeTests, deploy],
    triggerSource: 'manual',
    triggerEvent: 'release',
    triggerDisplayLabel: 'release',
    triggerLabel: 'manual · release',
  });
}

function makeRun({jobs = [], ...overrides}: RunOverrides = {}): WorkflowRunOverview {
  return {
    ...workflowRunOverview({
      name: 'Deploy',
      status: 'running',
      trigger_source: 'manual',
      trigger_event: 'fire',
      started_at: '2026-06-21T12:00:10.000Z',
      jobs: [],
    }),
    ...overrides,
    jobs: {kind: 'complete', total: jobs.length, items: jobs},
  };
}

type RunOverrides = Omit<Partial<WorkflowRunOverview>, 'jobs'> & {
  jobs?: WorkflowRunOverviewJob[];
};

function makeJob(
  overrides: Parameters<typeof workflowRunOverviewJob>[0] & {name: string},
): WorkflowRunOverviewJob {
  return workflowRunOverviewJob(overrides);
}
