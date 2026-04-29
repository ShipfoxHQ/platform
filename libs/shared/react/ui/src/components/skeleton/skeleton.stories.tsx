import type {Meta, StoryObj} from '@storybook/react';
import {Skeleton} from './skeleton.js';

const meta = {
  title: 'Components/Skeleton',
  component: Skeleton,
  tags: ['autodocs'],
} satisfies Meta<typeof Skeleton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <Skeleton className="h-24 w-240" />,
};

export const CardLoading: Story = {
  render: () => (
    <div className="flex w-360 flex-col gap-16 rounded-8 border border-border-neutral-base p-16">
      <div className="flex items-center gap-12">
        <Skeleton className="size-40 rounded-full" />
        <div className="flex flex-1 flex-col gap-8">
          <Skeleton className="h-16 w-160" />
          <Skeleton className="h-12 w-120" />
        </div>
      </div>
      <Skeleton className="h-120 w-full" />
    </div>
  ),
};
