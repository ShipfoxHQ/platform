import type {StepAttemptDto} from '@shipfox/api-workflows-dto';
import {LogView, type LogViewProps} from '@shipfox/client-logs';
import {Text} from '@shipfox/react-ui/typography';
import type {Decorator, Meta, StoryObj} from '@storybook/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {within} from 'storybook/test';
import type {Job} from '#core/workflow-run.js';
import type {WorkflowStepFixtureDto} from '#test/fixtures/workflow-run.js';
import {
  type JobDtoOverrides,
  workflowJob,
  workflowStepAttemptDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {AgentConfigFailureCallout as AgentConfigFailureCalloutView} from '../job-detail/agent-config-failure-callout.js';
import {StepList} from './step-list.js';

const AGENTS_LINK_NAME = 'Configure Agents';

const meta = {
  title: 'Workflows/StepList',
  component: StepList,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div className="h-520 w-720 overflow-auto bg-background-neutral-base p-16">
        <Story />
      </div>
    ),
  ],
  args: {
    job: makeJob({
      steps: [
        makeStep({
          name: 'checkout',
          status: 'succeeded',
          attempts: [makeAttempt({status: 'succeeded'})],
        }),
        makeStep({
          name: 'install',
          position: 1,
          status: 'running',
          attempts: [makeAttempt({status: 'running'})],
        }),
        makeStep({name: 'test', position: 2}),
      ],
    }),
  },
} satisfies Meta<typeof StepList>;

export default meta;
type Story = StoryObj<typeof meta>;
type StepListStoryContext = Parameters<NonNullable<Story['play']>>[0];

const withAgentSettingsRoute: Decorator = (Story) => {
  const rootRoute = createRootRoute({component: Outlet});
  const storyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <Story />,
  });
  const agentSettingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/settings/agents',
    component: () => null,
  });
  const router = createRouter({
    history: createMemoryHistory({initialEntries: ['/']}),
    routeTree: rootRoute.addChildren([storyRoute, agentSettingsRoute]),
  });

  return <RouterProvider router={router} />;
};

async function assertAgentConfigFailureCallout(ctx: StepListStoryContext) {
  const canvas = within(ctx.canvasElement);

  await canvas.findByText('Configure credentials for anthropic');
  await canvas.findByRole('link', {name: AGENTS_LINK_NAME});
}

export const Playground: Story = {};

export const Statuses: Story = {
  args: {
    job: makeJob({
      name: 'release-production',
      status: 'running',
      steps: [
        makeStep({name: 'pending', status: 'pending'}),
        makeStep({
          name: 'running',
          position: 1,
          status: 'running',
          attempts: [makeAttempt({status: 'running'})],
        }),
        makeStep({
          name: 'succeeded',
          position: 2,
          status: 'succeeded',
          attempts: [makeAttempt({status: 'succeeded'})],
        }),
        makeStep({
          name: 'failed',
          position: 3,
          status: 'failed',
          error: {
            message: 'Tests failed',
            category: 'user',
            reason: 'agent_invocation_failed',
          },
          attempts: [makeAttempt({status: 'failed', exit_code: 1})],
        }),
        makeStep({
          name: 'cancelled',
          position: 4,
          status: 'cancelled',
          attempts: [makeAttempt({status: 'cancelled'})],
        }),
        makeStep({
          name: 'timed-out',
          position: 5,
          status: 'timed_out',
          attempts: [makeAttempt({status: 'timed_out'})],
        }),
      ],
    }),
  },
};

const activeLogRecords: LogViewProps['records'] = [
  {
    v: 1,
    ts: Date.parse('2026-06-21T12:00:00.000Z'),
    type: 'output',
    stream: 'stdout',
    data: '$ pnpm test --filter=@shipfox/client-workflows\n',
  },
  {
    v: 1,
    ts: Date.parse('2026-06-21T12:00:01.000Z'),
    type: 'output',
    stream: 'stdout',
    data: 'step-list.test.tsx 18 tests passed\n',
  },
  {
    v: 1,
    ts: Date.parse('2026-06-21T12:00:02.000Z'),
    type: 'output',
    stream: 'stdout',
    data: 'step-attempt-log-panel.test.tsx running smart-tail checks\n',
  },
  {
    v: 1,
    ts: Date.parse('2026-06-21T12:00:03.000Z'),
    type: 'output',
    stream: 'stdout',
    data: 'waiting for live log chunks...\n',
  },
];

export const Attempts: Story = {
  args: {
    job: makeJob({
      name: 'release-production',
      status: 'running',
      steps: [
        makeStep({
          name: 'checkout',
          position: 0,
          status: 'succeeded',
          attempts: [makeAttempt({attempt: 1, execution_order: 1, status: 'succeeded'})],
        }),
        makeStep({
          name: 'compile',
          position: 1,
          status: 'succeeded',
          current_attempt: 2,
          attempts: [
            makeAttempt({attempt: 1, execution_order: 2, status: 'failed', exit_code: 1}),
            makeAttempt({attempt: 2, execution_order: 4, status: 'succeeded'}),
          ],
        }),
        makeStep({
          name: 'test',
          position: 2,
          status: 'succeeded',
          current_attempt: 2,
          attempts: [
            makeAttempt({attempt: 1, execution_order: 3, status: 'failed', exit_code: 1}),
            makeAttempt({attempt: 2, execution_order: 5, status: 'succeeded'}),
          ],
        }),
        makeStep({
          name: 'deploy',
          position: 3,
          status: 'running',
          current_attempt: 2,
          attempts: [
            makeAttempt({attempt: 1, execution_order: 6, status: 'failed', exit_code: 1}),
            makeAttempt({
              attempt: 2,
              execution_order: 7,
              status: 'running',
              restart_feedback: 'manual approval',
            }),
          ],
        }),
      ],
    }),
  },
};

export const ContentVariants: Story = {
  args: {
    job: makeJob({
      name: 'release-production-multi-region-with-canary-validation-and-post-deploy-observability',
      steps: [
        makeStep({
          name: 'Set up job',
          type: 'setup',
          status: 'succeeded',
          attempts: [makeAttempt({status: 'succeeded'})],
        }),
        makeStep({
          key: null,
          name: 'pnpm test --filter=@shipfox/client-workflows',
          position: 1,
          type: 'run',
          config: {run: 'pnpm test --filter=@shipfox/client-workflows'},
          status: 'succeeded',
          attempts: [makeAttempt({status: 'succeeded'})],
        }),
        makeStep({
          key: null,
          name: 'claude-opus-4-8 · Review the failing workflow step tests and propose the smallest fix.',
          position: 2,
          type: 'agent',
          config: {
            model: 'claude-opus-4-8',
            prompt: 'Review the failing workflow step tests and propose the smallest fix.',
          },
          status: 'failed',
          error: {
            message: 'Agent invocation failed',
            category: 'user',
            reason: 'agent_invocation_failed',
          },
          attempts: [makeAttempt({status: 'failed', exit_code: 1})],
        }),
        makeStep({
          name: 'publish-observability-summary-with-alert-links-and-rollout-decision',
          position: 3,
          status: 'pending',
        }),
      ],
    }),
  },
};

export const DataStates: Story = {
  render: () => (
    <div className="grid gap-16">
      <StepList
        job={makeJob({status: 'skipped', status_reason: 'dependency_not_completed', steps: []})}
        emptyState={{
          title: 'This job was skipped',
          description: 'A required job did not complete, so this job was skipped.',
          status: 'skipped',
        }}
      />
      <StepList
        job={makeJob({status: 'running', steps: []})}
        emptyState={{
          title: 'Waiting for the first step',
          description: 'This job is running, but no steps have started yet.',
          status: 'running',
        }}
      />
    </div>
  ),
};

export const CollapsedAndExpanded: Story = {
  render: renderCollapsedAndExpanded,
};

export const ActiveExpandedLogs: Story = {
  render: renderActiveExpandedLogs,
};

export const ExpandedSlot: Story = {
  render: renderExpandedSlot,
};

export const TestAgentConfigFailureCallout: Story = {
  decorators: [withAgentSettingsRoute],
  render: renderAgentConfigFailureCallout,
  play: assertAgentConfigFailureCallout,
};

function renderCollapsedAndExpanded() {
  const build = makeStep({name: 'build', attempts: [makeAttempt()]});
  const deployAttempt = makeAttempt();
  const deploy = makeStep({name: 'deploy', position: 1, attempts: [deployAttempt]});

  return (
    <StepList
      job={makeJob({steps: [build, deploy]})}
      defaultSelectedAttemptId={deployAttempt.id}
      renderExpandedStep={({stepId}) => (
        <Text size="sm" className="text-foreground-neutral-subtle">
          Slot content for {stepId}
        </Text>
      )}
    />
  );
}

function renderActiveExpandedLogs() {
  const attempt = makeAttempt({status: 'running'});
  const step = makeStep({
    name: 'pnpm test --filter=@shipfox/client-workflows',
    status: 'running',
    attempts: [attempt],
  });

  return (
    <StepList
      job={makeJob({steps: [step]})}
      autoSelectActiveAttempt
      renderExpandedStep={() => (
        <LogView records={activeLogRecords} className="max-h-[280px] rounded-8" />
      )}
    />
  );
}

function renderExpandedSlot() {
  const attempt = makeAttempt();
  const step = makeStep({name: 'run integration tests', attempts: [attempt]});

  return (
    <StepList
      job={makeJob({steps: [step]})}
      defaultSelectedAttemptId={attempt.id}
      renderExpandedStep={({stepId}) => (
        <Text size="sm" className="text-foreground-neutral-subtle">
          Injected detail placeholder for {stepId}
        </Text>
      )}
    />
  );
}

function renderAgentConfigFailureCallout() {
  const attempt = makeAttempt({status: 'failed', exit_code: 1});
  const step = makeStep({
    key: 'implement',
    name: 'Fix the failing tests.',
    type: 'agent',
    status: 'failed',
    config: {
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
      prompt: 'Fix the failing tests.',
    },
    error: {
      message: 'Model provider credentials are not configured',
      category: 'user',
      reason: 'agent_config_invalid',
      agent_config_issue: 'provider_not_configured',
    },
    attempts: [attempt],
  });

  return (
    <StepList
      job={makeJob({status: 'failed', steps: [step]})}
      defaultSelectedAttemptId={attempt.id}
      renderExpandedStep={() => (
        <AgentConfigFailureCalloutView
          workspaceSlug="acme"
          config={{provider: 'anthropic', model: 'claude-opus-4-8', thinking: 'high'}}
          error={{
            message: 'Model provider credentials are not configured',
            reason: 'agent_config_invalid',
            agentConfigIssue: 'provider_not_configured',
            category: 'user',
            exitCode: null,
            signal: undefined,
          }}
        />
      )}
    />
  );
}

function makeJob(overrides: JobDtoOverrides = {}): Job {
  return workflowJob(overrides);
}

function makeStep(overrides: Partial<WorkflowStepFixtureDto> = {}): WorkflowStepFixtureDto {
  return workflowStepDto(overrides);
}

function makeAttempt(overrides: Partial<StepAttemptDto> = {}): StepAttemptDto {
  return workflowStepAttemptDto(overrides);
}
