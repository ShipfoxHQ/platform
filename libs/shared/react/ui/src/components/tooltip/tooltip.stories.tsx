import type {Meta, StoryObj} from '@storybook/react';
import {Button} from '#components/button/index.js';
import {Code} from '#components/typography/index.js';
import {Tooltip, TooltipContent, type TooltipContentProps, TooltipTrigger} from './tooltip.js';

type TooltipStoryArgs = {
  defaultOpen?: boolean;
  delayDuration?: number;
  variant?: TooltipContentProps['variant'];
  size?: TooltipContentProps['size'];
  side?: TooltipContentProps['side'];
  align?: TooltipContentProps['align'];
  sideOffset?: TooltipContentProps['sideOffset'];
  animated?: TooltipContentProps['animated'];
};

const meta = {
  title: 'Components/Tooltip',
  tags: ['autodocs'],
  argTypes: {
    defaultOpen: {control: 'boolean'},
    delayDuration: {control: 'number'},
    variant: {
      control: 'select',
      options: ['default', 'inverted', 'muted'],
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
    },
    side: {
      control: 'select',
      options: ['top', 'bottom', 'left', 'right'],
    },
    align: {
      control: 'select',
      options: ['start', 'center', 'end'],
    },
    sideOffset: {control: 'number'},
    animated: {control: 'boolean'},
  },
  args: {
    defaultOpen: false,
    delayDuration: 0,
    variant: 'default',
    size: 'md',
    side: 'top',
    align: 'center',
    sideOffset: 8,
    animated: true,
  },
} satisfies Meta<TooltipStoryArgs>;

export default meta;

type Story = StoryObj<TooltipStoryArgs>;

export const Default: Story = {
  render: (args: TooltipStoryArgs) => {
    const defaultOpen = args.defaultOpen ?? false;
    const delayDuration = args.delayDuration ?? 0;
    const variant = args.variant ?? 'default';
    const size = args.size ?? 'md';
    const side = args.side ?? 'top';
    const align = args.align ?? 'center';
    const sideOffset = args.sideOffset ?? 8;
    const animated = args.animated ?? true;

    return (
      <div className="flex items-center justify-center p-64">
        <Tooltip defaultOpen={defaultOpen} delayDuration={delayDuration}>
          <TooltipTrigger asChild>
            <Button>Hover me</Button>
          </TooltipTrigger>
          <TooltipContent
            variant={variant}
            size={size}
            side={side}
            align={align}
            sideOffset={sideOffset}
            animated={animated}
          >
            Tooltip text
          </TooltipContent>
        </Tooltip>
      </div>
    );
  },
};

export const Variants: Story = {
  render: () => (
    <div className="flex flex-col gap-32 p-64">
      {(['default', 'inverted', 'muted'] as const).map((variant) => (
        <div key={variant} className="flex items-center gap-16">
          <Code variant="label" className="w-80 text-foreground-neutral-subtle">
            {variant}
          </Code>
          <Tooltip defaultOpen>
            <TooltipTrigger asChild>
              <Button variant={variant === 'inverted' ? 'primary' : 'secondary'}>{variant}</Button>
            </TooltipTrigger>
            <TooltipContent variant={variant}>Tooltip text</TooltipContent>
          </Tooltip>
        </div>
      ))}
    </div>
  ),
};
