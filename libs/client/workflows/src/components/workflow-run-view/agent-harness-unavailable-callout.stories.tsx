import type {Meta, StoryObj} from '@storybook/react';
import {expect, within} from 'storybook/test';
import type {StepError} from '#core/workflow-run.js';
import {AgentHarnessUnavailableCallout} from './agent-harness-unavailable-callout.js';

const meta = {
  title: 'Workflows/RunView/AgentHarnessUnavailableCallout',
  component: AgentHarnessUnavailableCallout,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div className="w-560 bg-background-neutral-base p-16">
        <Story />
      </div>
    ),
  ],
  args: {
    error: makeError(),
  },
} satisfies Meta<typeof AgentHarnessUnavailableCallout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const TestRunnerGuidance: Story = {
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);

    await canvas.findByRole('alert');
    expect(
      canvas.getByText('The runner could not start the agent for this step'),
    ).toBeInTheDocument();
    expect(
      canvas.getByText('Runner reported: Pi extension setup failed: Unknown option: --mcp-config'),
    ).toBeInTheDocument();
  },
};

function makeError(): StepError {
  return {
    message: 'Pi extension setup failed: Unknown option: --mcp-config',
    exitCode: null,
    signal: undefined,
    reason: 'agent_harness_unavailable',
    agentConfigIssue: undefined,
    category: 'user',
  };
}
