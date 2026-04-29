import type {Meta, StoryObj} from '@storybook/react';
import {Code} from '#components/typography/index.js';
import {Badge} from './badge.js';
import {StatusBadge} from './status-badge.js';

const variants = ['neutral', 'info', 'feature', 'success', 'warning', 'error'] as const;
const sizes = ['2xs', 'xs'] as const;

const meta = {
  title: 'Components/Badge',
  component: Badge,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: variants,
    },
    size: {
      control: 'select',
      options: sizes,
    },
    radius: {
      control: 'select',
      options: ['default', 'rounded'],
    },
  },
  args: {
    children: 'Badge',
    variant: 'neutral',
    size: '2xs',
    radius: 'default',
  },
} satisfies Meta<typeof Badge>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-32">
      <div>
        <Code variant="label" className="mb-16 text-foreground-neutral-subtle">
          Status badge
        </Code>
        <div className="flex gap-16">
          {variants.map((variant) => (
            <StatusBadge key={variant} variant={variant}>
              {variant}
            </StatusBadge>
          ))}
        </div>
      </div>

      {sizes.map((size) => (
        <div key={size}>
          <Code variant="label" className="mb-16 text-foreground-neutral-subtle">
            Badge {size}
          </Code>
          <div className="flex flex-col gap-16">
            <div className="flex gap-16">
              {variants.map((variant) => (
                <Badge key={variant} variant={variant} size={size}>
                  {variant}
                </Badge>
              ))}
            </div>
            <div className="flex gap-16">
              {variants.map((variant) => (
                <Badge key={variant} variant={variant} size={size} iconLeft="check">
                  {variant}
                </Badge>
              ))}
            </div>
            <div className="flex gap-16">
              {variants.map((variant) => (
                <Badge key={variant} variant={variant} size={size} iconRight="close">
                  {variant}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  ),
};

export const InteractiveBadges: Story = {
  render: () => (
    <div className="flex gap-16">
      <Badge
        variant="info"
        iconRight="close"
        onIconRightClick={() => undefined}
        iconRightAriaLabel="Remove info badge"
      >
        Removable
      </Badge>
      <Badge
        variant="success"
        iconLeft="check"
        iconRight="close"
        onIconLeftClick={() => undefined}
        iconLeftAriaLabel="Confirm"
        onIconRightClick={() => undefined}
        iconRightAriaLabel="Dismiss"
      >
        Actions
      </Badge>
    </div>
  ),
};
