import {Code} from '@shipfox/react-ui/typography';
import type {Meta, StoryObj} from '@storybook/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {within} from 'storybook/test';
import type {AgentStepConfig, StepError} from '#core/workflow-run.js';
import {AgentConfigFailureCallout} from './agent-config-failure-callout.js';

const AGENTS_LINK_NAME = 'Configure Agents';

const config: AgentStepConfig = {
  provider: 'anthropic',
  model: 'claude-opus-4-8',
  thinking: 'high',
};

const meta = {
  title: 'Workflows/JobDetail/AgentConfigFailureCallout',
  component: AgentConfigFailureCallout,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div className="w-560 bg-background-neutral-base p-16">
        <Story />
      </div>
    ),
    (Story) => {
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
    },
  ],
  args: {
    workspaceSlug: 'acme',
    config,
    error: makeError('provider_not_configured'),
  },
} satisfies Meta<typeof AgentConfigFailureCallout>;

export default meta;
type Story = StoryObj<typeof meta>;
type AgentConfigIssueValue = NonNullable<StepError['agentConfigIssue']>;

const errorCases: Array<{
  label: string;
  error: WorkflowStepError;
}> = [
  {label: 'Provider not configured', error: makeError('provider_not_configured')},
  {label: 'Credentials invalid', error: makeError('credentials_invalid')},
  {label: 'Provider unsupported', error: makeError('provider_unsupported')},
  {label: 'Model unavailable', error: makeError('model_unavailable')},
  {label: 'Step config invalid', error: makeError('step_config_invalid')},
  {
    label: 'Unknown config failure',
    error: {
      message: 'Agent configuration is invalid',
      exitCode: null,
      signal: undefined,
      reason: 'agent_config_invalid',
      agentConfigIssue: undefined,
      category: 'user',
    },
  },
  {
    label: 'Managed-only policy',
    error: {
      message: 'This instance only supports provider `shipfox`.',
      code: 'workspace-providers-disabled',
      managedProviderId: 'shipfox',
      exitCode: null,
      signal: undefined,
      reason: 'agent_config_invalid',
      agentConfigIssue: 'provider_unsupported',
      category: 'user',
    },
  },
];

export const Playground: Story = {};

export const ErrorVariants: Story = {
  render: (args) => (
    <div className="flex flex-col gap-20">
      {errorCases.map((item) => (
        <div key={item.label} className="flex flex-col gap-8">
          <Code variant="label" className="text-foreground-neutral-subtle">
            {item.label}
          </Code>
          <AgentConfigFailureCallout {...args} error={item.error} />
        </div>
      ))}
    </div>
  ),
};

export const TestProviderNotConfigured: Story = {
  play: assertCallout('Configure credentials for anthropic', true),
};

export const TestProviderUnsupported: Story = {
  args: {
    error: makeError('provider_unsupported'),
  },
  play: assertCallout('Choose a supported model provider', false),
};

export const TestManagedOnlyPolicy: Story = {
  args: {
    error: {
      message: 'This instance only supports provider `shipfox`.',
      code: 'workspace-providers-disabled',
      managedProviderId: 'shipfox',
      exitCode: null,
      signal: undefined,
      reason: 'agent_config_invalid',
      agentConfigIssue: 'provider_unsupported',
      category: 'user',
    },
  },
  play: assertCallout('Use shipfox for this instance', false),
};

function makeError(agentConfigIssue: AgentConfigIssueValue): StepError {
  return {
    message: 'Agent configuration is invalid',
    exitCode: null,
    signal: undefined,
    reason: 'agent_config_invalid',
    agentConfigIssue,
    category: 'user',
  };
}

function assertCallout(title: string, showsCta: boolean): Story['play'] {
  return async ({canvasElement}) => {
    const canvas = within(canvasElement);

    await canvas.findByText(title);
    const cta = canvas.queryByRole('link', {name: AGENTS_LINK_NAME});
    if (showsCta) {
      await canvas.findByRole('link', {name: AGENTS_LINK_NAME});
    } else if (cta !== null) {
      throw new Error(`Unexpected ${AGENTS_LINK_NAME} CTA`);
    }
  };
}
