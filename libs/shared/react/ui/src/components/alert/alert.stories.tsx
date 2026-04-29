import type {Meta, StoryObj} from '@storybook/react';
import {Header} from '#components/typography/index.js';
import {
  Alert,
  AlertAction,
  AlertActions,
  AlertClose,
  AlertContent,
  AlertDescription,
  AlertTitle,
} from './alert.js';

const variants = ['default', 'info', 'success', 'warning', 'error'] as const;

const meta = {
  title: 'Components/Alert',
  component: Alert,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: variants,
    },
    animated: {control: 'boolean'},
  },
  args: {
    variant: 'default',
    animated: false,
  },
} satisfies Meta<typeof Alert>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Alert {...args}>
      <AlertContent>
        <AlertTitle>Deployment queued</AlertTitle>
        <AlertDescription>Your build will start as soon as a runner is available.</AlertDescription>
        <AlertActions>
          <AlertAction>View build</AlertAction>
          <AlertAction>Dismiss</AlertAction>
        </AlertActions>
      </AlertContent>
      <AlertClose />
    </Alert>
  ),
};

export const Variants: Story = {
  render: () => (
    <div className="flex min-w-500 flex-col gap-16">
      {variants.map((variant) => (
        <Alert key={variant} variant={variant} animated={false}>
          <AlertContent>
            <AlertTitle>{variant}</AlertTitle>
            <AlertDescription>Short message explaining the current status.</AlertDescription>
          </AlertContent>
          <AlertClose />
        </Alert>
      ))}
    </div>
  ),
};

export const DesignMock: Story = {
  render: () => (
    <div className="flex flex-col gap-32 bg-background-neutral-base px-32 py-32">
      <Header variant="h3" className="text-foreground-neutral-subtle">
        Alerts
      </Header>
      <div className="flex min-w-500 flex-col gap-16">
        {variants.map((variant) => (
          <Alert key={variant} variant={variant} animated={false}>
            <AlertContent>
              <AlertTitle>Title</AlertTitle>
              <AlertDescription>Description</AlertDescription>
              <AlertActions>
                <AlertAction>Download</AlertAction>
                <AlertAction>View</AlertAction>
              </AlertActions>
            </AlertContent>
            <AlertClose />
          </Alert>
        ))}
      </div>
    </div>
  ),
};
