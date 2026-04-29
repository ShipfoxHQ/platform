import type {Meta, StoryObj} from '@storybook/react';
import {Icon, iconNames} from './icon.js';

const meta = {
  title: 'Components/Icon',
  component: Icon,
  tags: ['autodocs'],
  argTypes: {
    name: {
      control: 'select',
      options: iconNames,
    },
    size: {control: 'number'},
  },
  args: {
    name: 'shipfox',
    size: 24,
  },
} satisfies Meta<typeof Icon>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CommonIcons: Story = {
  render: () => (
    <div className="grid grid-cols-6 gap-16">
      {[
        'shipfox',
        'spinner',
        'addLine',
        'close',
        'check',
        'copy',
        'info',
        'github',
        'google',
        'microsoft',
        'slack',
        'stripe',
      ].map((name) => (
        <div key={name} className="flex flex-col items-center gap-8 text-foreground-neutral-base">
          <Icon name={name} size={24} />
          <span className="text-xs text-foreground-neutral-muted">{name}</span>
        </div>
      ))}
    </div>
  ),
};
