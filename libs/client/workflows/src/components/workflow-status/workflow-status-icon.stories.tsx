import {Code, Text} from '@shipfox/react-ui/typography';
import type {Meta, StoryObj} from '@storybook/react';
import type {WorkflowDisplayStatus} from '#core/workflow-run.js';
import {getWorkflowStatusVisual} from './status-visuals.js';
import {WorkflowStatusIcon} from './workflow-status-icon.js';

const statuses: WorkflowDisplayStatus[] = [
  'pending',
  'running',
  'listening',
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
];

const meta = {
  title: 'Workflows/StatusIcon',
  component: WorkflowStatusIcon,
  parameters: {layout: 'centered'},
  argTypes: {
    status: {
      control: 'select',
      options: statuses,
    },
    size: {
      control: {type: 'number', min: 8, max: 24, step: 1},
    },
    ripple: {
      control: 'boolean',
    },
  },
  args: {
    status: 'running',
    size: 14,
    ripple: false,
  },
  decorators: [
    (Story) => (
      <div className="bg-background-neutral-base p-24">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WorkflowStatusIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

// Every state at the surface size (14px) plus a compact size, sharing the tuned glyph scale.
export const Playground: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-32">
      <Scale label="DAG node / run row (14px)" size={14} />
      <Scale label="Compact (12px)" size={12} />
    </div>
  ),
};

export const InContext: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-12">
      {statuses.map((status) => (
        <div
          key={status}
          className="flex w-208 items-center gap-8 rounded-8 border border-border-neutral-base bg-background-components-base px-10 py-7"
        >
          <WorkflowStatusIcon status={status} size={14} />
          <Code variant="label" bold className="truncate text-foreground-neutral-base">
            {status}-job
          </Code>
        </div>
      ))}
    </div>
  ),
};

function Scale({label, size, ripple}: {label: string; size: number; ripple?: boolean}) {
  return (
    <div className="flex flex-col gap-12">
      <Code variant="label" className="text-foreground-neutral-subtle">
        {label}
      </Code>
      <div className="flex items-start gap-32">
        {statuses.map((status) => (
          <div key={status} className="flex flex-col items-center gap-6">
            <WorkflowStatusIcon status={status} size={size} ripple={ripple} />
            <Text size="xs" className="text-foreground-neutral-muted">
              {getWorkflowStatusVisual(status).label}
            </Text>
          </div>
        ))}
      </div>
    </div>
  );
}
