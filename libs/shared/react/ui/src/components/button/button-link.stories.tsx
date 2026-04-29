import type {Meta, StoryObj} from '@storybook/react';
import {ButtonLink} from './button-link.js';

const meta = {
  title: 'Components/Button/ButtonLink',
  component: ButtonLink,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['base', 'interactive', 'muted', 'subtle'],
    },
    size: {
      control: 'select',
      options: ['xs', 'sm', 'md', 'xl'],
    },
    underline: {control: 'boolean'},
    asChild: {control: 'boolean'},
  },
  args: {
    children: 'Label',
    variant: 'base',
    size: 'sm',
    underline: false,
    href: '#',
  },
} satisfies Meta<typeof ButtonLink>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Variants: Story = {
  render: (args) => (
    <div className="flex items-center gap-16">
      <ButtonLink {...args} variant="base">
        Base
      </ButtonLink>
      <ButtonLink {...args} variant="interactive">
        Interactive
      </ButtonLink>
      <ButtonLink {...args} variant="muted">
        Muted
      </ButtonLink>
      <ButtonLink {...args} variant="subtle">
        Subtle
      </ButtonLink>
    </div>
  ),
};

export const WithUnderline: Story = {
  render: (args) => (
    <div className="flex items-center gap-16">
      <ButtonLink {...args} variant="base" underline>
        Base
      </ButtonLink>
      <ButtonLink {...args} variant="interactive" underline>
        Interactive
      </ButtonLink>
      <ButtonLink {...args} variant="muted" underline>
        Muted
      </ButtonLink>
      <ButtonLink {...args} variant="subtle" underline>
        Subtle
      </ButtonLink>
    </div>
  ),
};

export const WithIcons: Story = {
  render: (args) => (
    <div className="flex items-center gap-16">
      <ButtonLink {...args} iconLeft="addLine">
        Icon left
      </ButtonLink>
      <ButtonLink {...args} iconRight="chevronRight">
        Icon right
      </ButtonLink>
      <ButtonLink {...args} iconLeft="addLine" iconRight="chevronRight">
        Both icons
      </ButtonLink>
    </div>
  ),
};
