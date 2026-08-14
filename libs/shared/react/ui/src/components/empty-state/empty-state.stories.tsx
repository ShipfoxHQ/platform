import type {Meta, StoryObj} from '@storybook/react';
import {Button} from '../button/index.js';
import {EmptyState} from './empty-state.js';

const meta = {
  title: 'Components/EmptyState',
  component: EmptyState,
  tags: ['autodocs'],
  parameters: {layout: 'centered'},
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: (args) => (
    <div className="w-400">
      <EmptyState {...args} />
    </div>
  ),
  args: {
    icon: 'inboxLine',
    title: 'No integrations connected yet',
    description: 'Connect a provider below to get started.',
  },
};

export const WithAction: Story = {
  render: (args) => (
    <div className="w-400">
      <EmptyState {...args} />
    </div>
  ),
  args: {
    icon: 'inboxLine',
    title: 'No projects yet',
    description: 'Connect a repository-backed project to start building workflows.',
    action: (
      <Button size="sm" variant="secondary">
        Create project
      </Button>
    ),
  },
};

export const ErrorTone: Story = {
  render: (args) => (
    <div className="w-400">
      <EmptyState {...args} />
    </div>
  ),
  args: {
    tone: 'error',
    icon: 'errorWarningLine',
    title: "Couldn't load integrations",
    description: 'Something went wrong. Check your connection and try again.',
    action: (
      <Button size="sm" variant="secondary">
        Retry
      </Button>
    ),
  },
};

export const Compact: Story = {
  render: (args) => (
    <div className="relative h-200 w-400">
      <EmptyState {...args} />
    </div>
  ),
  args: {
    icon: 'inboxLine',
    title: 'Nothing here yet.',
    variant: 'compact',
  },
};

export const Panel: Story = {
  render: (args) => (
    <div className="w-640 rounded-8 border border-border-neutral-base bg-background-neutral-base">
      <EmptyState {...args} />
    </div>
  ),
  args: {
    icon: 'inboxLine',
    title: 'No runs yet',
    description: 'Runs from this project will appear here once one is launched.',
    variant: 'panel',
  },
};
