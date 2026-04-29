import type {Meta, StoryObj} from '@storybook/react';
import {Button} from '#components/button/index.js';
import {Toaster, toast} from './toast.js';
import {ToastCustom} from './toast-custom.js';

const meta = {
  title: 'Components/Toast',
  component: Toaster,
  tags: ['autodocs'],
} satisfies Meta<typeof Toaster>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="flex gap-12">
      <Toaster />
      <Button onClick={() => toast.success('Project created')}>Success</Button>
      <Button onClick={() => toast.info('Runner is warming up')} variant="secondary">
        Info
      </Button>
      <Button onClick={() => toast.warning('Usage is near the limit')} variant="secondary">
        Warning
      </Button>
      <Button onClick={() => toast.error('Deployment failed')} variant="danger">
        Error
      </Button>
    </div>
  ),
};

export const Custom: Story = {
  render: () => (
    <div className="flex gap-12">
      <Toaster />
      <Button
        onClick={() =>
          toast.custom((id) => (
            <ToastCustom
              variant="info"
              title="Build ready"
              description="The preview deployment is available."
              actions={[
                {
                  label: 'Open',
                  onClick: () => toast.dismiss(id),
                },
              ]}
              onClose={() => toast.dismiss(id)}
            />
          ))
        }
      >
        Custom toast
      </Button>
    </div>
  ),
};
