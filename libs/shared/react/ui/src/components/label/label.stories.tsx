import type {Meta, StoryObj} from '@storybook/react';
import {Input} from '#components/input/index.js';
import {Label} from './label.js';

const meta = {
  title: 'Components/Label',
  component: Label,
  tags: ['autodocs'],
  args: {
    children: 'Email address',
  },
} satisfies Meta<typeof Label>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithInput: Story = {
  render: (args) => (
    <div className="grid w-320 gap-8">
      <Label {...args} htmlFor="email" />
      <Input id="email" type="email" placeholder="you@example.com" />
    </div>
  ),
};
