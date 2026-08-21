import {argosScreenshot} from '@argos-ci/storybook/vitest';
import type {Meta, StoryObj} from '@storybook/react';
import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useState} from 'react';
import {expect} from 'storybook/test';
import {Button} from '../button/index.js';
import {Input} from '../input/index.js';
import {Label} from '../label/index.js';
import {Text} from '../typography/index.js';
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
} from './modal.js';

const OPEN_MODAL_REGEX = /open modal/i;
const ACCOUNT_SETTINGS_REGEX = /account settings/i;
const CANCEL_REGEX = /cancel/i;

const meta = {
  title: 'Components/Modal',
  component: Modal,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof Modal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => {
    const [open, setOpen] = useState(false);

    return (
      <div className="flex h-[calc(100vh/2)] w-[calc(100vw/2)] items-center justify-center rounded-16 bg-background-subtle-base shadow-tooltip">
        <Modal open={open} onOpenChange={setOpen}>
          <ModalTrigger asChild>
            <Button>Open Modal</Button>
          </ModalTrigger>
          <ModalContent aria-describedby={undefined}>
            <ModalTitle className="sr-only">Modal Title</ModalTitle>
            <ModalHeader title="Modal Title" />
            <ModalBody>
              <Text size="sm" className="text-foreground-neutral-subtle w-full">
                This modal automatically adapts between dialog and drawer layouts.
              </Text>
            </ModalBody>
            <ModalFooter>
              <Button variant="transparent" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => setOpen(false)}>
                Confirm
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </div>
    );
  },
};

export const Open: Story = {
  play: async (ctx) => {
    const {canvasElement, step} = ctx;
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    await step('Open the modal', async () => {
      const triggerButton = canvas.getByRole('button', {name: OPEN_MODAL_REGEX});
      await user.click(triggerButton);
    });

    await step('Wait for dialog to appear and render', async () => {
      await screen.findByRole('dialog');
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    await argosScreenshot(ctx, 'Modal Open');
  },
  render: () => {
    const [open, setOpen] = useState(false);

    return (
      <div className="flex h-[calc(100vh/2)] w-[calc(100vw/2)] items-center justify-center rounded-16 bg-background-subtle-base shadow-tooltip">
        <Modal open={open} onOpenChange={setOpen}>
          <ModalTrigger asChild>
            <Button>Open Modal</Button>
          </ModalTrigger>
          <ModalContent aria-describedby={undefined}>
            <ModalTitle className="sr-only">Modal Title</ModalTitle>
            <ModalHeader>
              <Text
                size="lg"
                className="flex-1 overflow-ellipsis overflow-hidden whitespace-nowrap"
              >
                Modal Title
              </Text>
            </ModalHeader>
            <ModalBody>
              <Text size="sm" className="text-foreground-neutral-subtle w-full">
                This modal automatically adapts between dialog (desktop) and drawer (mobile) based
                on screen size. Try resizing your browser window!
              </Text>
            </ModalBody>
            <ModalFooter>
              <Button variant="transparent" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => setOpen(false)}>
                Confirm
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </div>
    );
  },
};

export const SettingsForm: Story = {
  play: async (ctx) => {
    const {canvasElement, step} = ctx;
    const canvas = within(canvasElement);
    const user = userEvent.setup();

    await step('Open the modal', async () => {
      const triggerButton = canvas.getByRole('button', {name: ACCOUNT_SETTINGS_REGEX});
      await user.click(triggerButton);
    });

    await step('Wait for dialog to appear and render', async () => {
      await screen.findByRole('dialog');
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    await argosScreenshot(ctx, 'Settings Form Modal Open');
  },
  render: () => {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');

    return (
      <div className="flex h-[calc(100vh/2)] w-[calc(100vw/2)] items-center justify-center rounded-16 bg-background-subtle-base shadow-tooltip">
        <Modal open={open} onOpenChange={setOpen}>
          <ModalTrigger asChild>
            <Button>Account settings</Button>
          </ModalTrigger>
          <ModalContent aria-describedby={undefined}>
            <ModalTitle className="sr-only">Account settings</ModalTitle>
            <ModalHeader title="Account settings" />
            <ModalBody className="gap-20">
              <Text size="sm" className="text-foreground-neutral-subtle w-full">
                Update your account information and preferences here.
              </Text>
              <div className="flex flex-col gap-20 w-full">
                <div className="flex flex-col gap-8 w-full">
                  <Label htmlFor="modal-story-name">Name</Label>
                  <Input
                    id="modal-story-name"
                    placeholder="John Doe"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-8 w-full">
                  <Label htmlFor="modal-story-email">Email</Label>
                  <Input
                    id="modal-story-email"
                    type="email"
                    placeholder="john@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="transparent" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => setOpen(false)}>
                Save changes
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </div>
    );
  },
};

const CLOSING_SURFACE_SELECTOR =
  '[data-state="closed"][role="dialog"], [data-state="closed"].fixed.inset-0';

/**
 * Overlay and content both outlive the modal by the length of the exit
 * animation. While they are on screen they must not catch clicks meant for the
 * page behind them, otherwise a stalled exit leaves the page silently inert.
 * The body pointer-events lock has to come off in the same window.
 */
export const TestClosingSurfaceStopsCatchingClicks: Story = {
  ...Playground,
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', {name: OPEN_MODAL_REGEX}));
    await screen.findByRole('dialog');

    await userEvent.click(await screen.findByRole('button', {name: CANCEL_REGEX}));

    const closing = document.querySelectorAll(CLOSING_SURFACE_SELECTOR);
    expect(closing.length).toBeGreaterThan(0);
    for (const node of closing) {
      expect(window.getComputedStyle(node).pointerEvents).toBe('none');
    }

    await waitFor(() => {
      expect(document.body.style.pointerEvents).not.toBe('none');
    });
  },
};
