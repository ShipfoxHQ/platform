import type {Meta, StoryObj} from '@storybook/react';
import {Icon} from '#components/icon/index.js';
import {Label} from '#components/label/index.js';
import {Input} from './input.js';

const meta = {
  title: 'Components/Input',
  component: Input,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['base', 'component'],
    },
    size: {
      control: 'select',
      options: ['base', 'small'],
    },
  },
  args: {
    placeholder: 'Placeholder',
    variant: 'base',
    size: 'base',
  },
} satisfies Meta<typeof Input>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const States: Story = {
  render: (args) => (
    <div className="grid w-360 gap-16">
      <div className="grid gap-8">
        <Label htmlFor="default-input">Default</Label>
        <Input {...args} id="default-input" placeholder="default@example.com" />
      </div>
      <div className="grid gap-8">
        <Label htmlFor="icon-input">With icons</Label>
        <Input
          {...args}
          id="icon-input"
          iconLeft={<Icon name="github" className="size-16 text-foreground-neutral-muted" />}
          iconRight={<Icon name="check" className="size-16 text-tag-success-icon" />}
          defaultValue="shipfox"
        />
      </div>
      <div className="grid gap-8">
        <Label htmlFor="invalid-input">Invalid</Label>
        <Input {...args} id="invalid-input" aria-invalid defaultValue="not an email" />
      </div>
      <div className="grid gap-8">
        <Label htmlFor="disabled-input">Disabled</Label>
        <Input {...args} id="disabled-input" disabled defaultValue="Disabled value" />
      </div>
    </div>
  ),
};
