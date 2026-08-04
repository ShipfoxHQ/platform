import {Tabs} from '@shipfox/react-ui/tabs';
import type {Meta, StoryObj} from '@storybook/react';
import type {RunAnnotationSummary} from '#core/workflow-run-tabs.js';
import {RunTabStrip} from './run-tab-strip.js';

const ANNOTATION_SUMMARY: RunAnnotationSummary = {
  total: 8,
  error: 2,
  warning: 3,
  info: 2,
  success: 1,
};

const meta = {
  title: 'Workflows/RunTabStrip',
  component: RunTabStrip,
  parameters: {layout: 'fullscreen'},
  render: (args) => (
    <div className="bg-background-neutral-background">
      <Tabs defaultValue="summary">
        <RunTabStrip {...args} />
      </Tabs>
    </div>
  ),
  args: {
    jobCount: 6,
    jobsFailed: 1,
    annotationSummary: ANNOTATION_SUMMARY,
  },
} satisfies Meta<typeof RunTabStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const NoCounts: Story = {
  args: {
    jobCount: undefined,
    annotationSummary: undefined,
  },
};

export const NarrowLayout: Story = {
  decorators: [
    (Story) => (
      <div className="w-[360px] max-w-full overflow-hidden border">
        <Story />
      </div>
    ),
  ],
};
