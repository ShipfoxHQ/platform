import {argosScreenshot} from '@argos-ci/storybook/vitest';
import type {Meta, StoryObj} from '@storybook/react';
import {screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {ComponentProps} from 'react';
import {useState} from 'react';
import {Icon} from '#components/icon/index.js';
import {Label} from '#components/label/index.js';
import {type DateRange, DateRangePicker} from './date-range-picker.js';

const seededRange: DateRange = {
  start: new Date(2024, 0, 8),
  end: new Date(2024, 0, 15),
};

const OPEN_CALENDAR_REGEX = /open calendar/i;

const meta = {
  title: 'Components/DateRangePicker',
  component: DateRangePicker,
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
    state: {
      control: 'select',
      options: ['default', 'error', 'disabled'],
    },
  },
  args: {
    variant: 'base',
    size: 'base',
    state: 'default',
  },
} satisfies Meta<typeof DateRangePicker>;

export default meta;

type Story = StoryObj<typeof meta>;

function ControlledPicker({
  initialRange,
  ...props
}: {initialRange?: DateRange} & Omit<
  ComponentProps<typeof DateRangePicker>,
  'dateRange' | 'onDateRangeSelect' | 'onClear'
>) {
  const [range, setRange] = useState<DateRange | undefined>(initialRange);
  return (
    <DateRangePicker
      {...props}
      dateRange={range}
      onDateRangeSelect={setRange}
      onClear={() => setRange(undefined)}
    />
  );
}

export const Playground: Story = {
  render: (args) => <ControlledPicker {...args} />,
};

export const WithSelectedRange: Story = {
  render: (args) => <ControlledPicker {...args} initialRange={seededRange} />,
};

export const PartialRanges: Story = {
  render: (args) => (
    <div className="flex flex-col gap-16">
      <div className="grid gap-8">
        <Label htmlFor="start-only-picker">Start only</Label>
        <ControlledPicker
          {...args}
          id="start-only-picker"
          initialRange={{start: seededRange.start}}
        />
      </div>
      <div className="grid gap-8">
        <Label htmlFor="end-only-picker">End only</Label>
        <ControlledPicker {...args} id="end-only-picker" initialRange={{end: seededRange.end}} />
      </div>
    </div>
  ),
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-col gap-12">
      <ControlledPicker {...args} size="base" initialRange={seededRange} />
      <ControlledPicker {...args} size="small" initialRange={seededRange} />
    </div>
  ),
};

export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-col gap-12">
      <ControlledPicker {...args} variant="base" initialRange={seededRange} />
      <ControlledPicker {...args} variant="component" initialRange={seededRange} />
    </div>
  ),
};

export const States: Story = {
  render: (args) => (
    <div className="flex flex-col gap-16">
      <div className="grid gap-8">
        <Label htmlFor="default-picker">Default</Label>
        <ControlledPicker {...args} id="default-picker" />
      </div>
      <div className="grid gap-8">
        <Label htmlFor="error-picker">Error</Label>
        <ControlledPicker {...args} id="error-picker" state="error" initialRange={seededRange} />
      </div>
      <div className="grid gap-8">
        <Label htmlFor="disabled-picker">Disabled</Label>
        <ControlledPicker
          {...args}
          id="disabled-picker"
          state="disabled"
          initialRange={seededRange}
        />
      </div>
    </div>
  ),
};

export const WithRightIcon: Story = {
  render: (args) => (
    <ControlledPicker
      {...args}
      rightIcon={<Icon name="arrowDownSLine" className="size-16 text-foreground-neutral-muted" />}
    />
  ),
};

export const LimitedRange: Story = {
  render: (args) => <ControlledPicker {...args} maxRangeDays={7} />,
};

export const Open: Story = {
  play: async (ctx) => {
    const {canvasElement, step} = ctx;
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    await step('Open the calendar', async () => {
      await user.click(canvas.getByRole('button', {name: OPEN_CALENDAR_REGEX}));
    });

    await step('Wait for the calendar to render', async () => {
      await screen.findByRole('dialog');
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    await argosScreenshot(ctx, 'DateRangePicker Open');
  },
  render: (args) => <ControlledPicker {...args} initialRange={seededRange} />,
};
