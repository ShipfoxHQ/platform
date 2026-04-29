import type {Meta, StoryObj} from '@storybook/react';
import {Button} from '#components/button/index.js';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './card.js';

const meta = {
  title: 'Components/Card',
  component: Card,
  tags: ['autodocs'],
} satisfies Meta<typeof Card>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Card className="w-360">
      <CardHeader>
        <CardTitle>Project usage</CardTitle>
        <CardDescription>Track this workspace usage for the current billing cycle.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-80 rounded-6 bg-background-neutral-subtle" />
      </CardContent>
    </Card>
  ),
};

export const WithAction: Story = {
  render: () => (
    <Card className="w-360">
      <div className="flex items-start gap-16">
        <CardHeader>
          <CardTitle>Runner pool</CardTitle>
          <CardDescription>Autoscaling is enabled for production jobs.</CardDescription>
        </CardHeader>
        <CardAction>
          <Button size="sm" variant="secondary">
            Manage
          </Button>
        </CardAction>
      </div>
      <CardContent>
        <div className="h-80 rounded-6 bg-background-neutral-subtle" />
      </CardContent>
    </Card>
  ),
};

export const WithFooter: Story = {
  render: () => (
    <Card className="w-360">
      <CardHeader>
        <CardTitle>Invite teammate</CardTitle>
        <CardDescription>Add someone to help configure the workspace.</CardDescription>
      </CardHeader>
      <CardFooter>
        <Button size="sm">Invite</Button>
        <Button size="sm" variant="secondary">
          Cancel
        </Button>
      </CardFooter>
    </Card>
  ),
};
