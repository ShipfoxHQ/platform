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
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './sheet.js';

const isTestEnvironment = () => typeof navigator !== 'undefined' && navigator.webdriver === true;

async function screenshotOpenSheet(
  ctx: Parameters<NonNullable<StoryObj<typeof meta>['play']>>[0],
  screenshotName: string,
): Promise<void> {
  const {step} = ctx;

  await step('Wait for sheet to appear and render', async () => {
    await screen.findByRole('dialog');
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  await argosScreenshot(ctx, screenshotName);
}

const meta = {
  title: 'Components/Sheet',
  component: Sheet,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof Sheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => {
    const [open, setOpen] = useState(false);

    return (
      <div className="flex h-[calc(100vh/2)] w-[calc(100vw/2)] items-center justify-center rounded-16 bg-background-subtle-base shadow-tooltip">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button>Open Sheet</Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Sheet Title</SheetTitle>
            </SheetHeader>
            <SheetBody>
              <SheetDescription>
                This sheet displays supplementary information or actions.
              </SheetDescription>
              <Text size="sm" className="text-foreground-neutral-subtle w-full">
                Add forms, lists, or related details in the sheet body.
              </Text>
            </SheetBody>
            <SheetFooter>
              <Button variant="transparent" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => setOpen(false)}>
                Save
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>
    );
  },
};

export const Open: Story = {
  play: (ctx) => screenshotOpenSheet(ctx, 'Sheet Open'),
  render: () => {
    const [open, setOpen] = useState(isTestEnvironment());

    return (
      <div className="flex h-[calc(100vh/2)] w-[calc(100vw/2)] items-center justify-center rounded-16 bg-background-subtle-base shadow-tooltip">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button>Open Sheet</Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Sheet Title</SheetTitle>
            </SheetHeader>
            <SheetBody>
              <SheetDescription>
                This is a description of the sheet content. Sheets are useful for displaying
                supplementary information or actions.
              </SheetDescription>
              <Text size="sm" className="text-foreground-neutral-subtle w-full">
                This is the body content of the sheet. You can add any content here, including
                forms, lists, or other components.
              </Text>
            </SheetBody>
            <SheetFooter>
              <Button variant="transparent" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => setOpen(false)}>
                Save
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>
    );
  },
};

export const LeftSide: Story = {
  play: (ctx) => screenshotOpenSheet(ctx, 'Left Side Sheet'),
  render: () => {
    const [open, setOpen] = useState(isTestEnvironment());

    return (
      <div className="flex h-[calc(100vh/2)] w-[calc(100vw/2)] items-center justify-center rounded-16 bg-background-subtle-base shadow-tooltip">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button>Open Sheet</Button>
          </SheetTrigger>
          <SheetContent side="left">
            <SheetHeader>
              <SheetTitle>Left Side Sheet</SheetTitle>
            </SheetHeader>
            <SheetBody>
              <SheetDescription>
                This sheet slides in from the left side of the screen.
              </SheetDescription>
              <Text size="sm" className="text-foreground-neutral-subtle w-full">
                Left side sheets are often used for navigation menus or sidebar content.
              </Text>
            </SheetBody>
            <SheetFooter>
              <Button variant="transparent" onClick={() => setOpen(false)}>
                Close
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>
    );
  },
};

export const SettingsForm: Story = {
  play: (ctx) => screenshotOpenSheet(ctx, 'Settings Form Sheet'),
  render: () => {
    const [open, setOpen] = useState(isTestEnvironment());
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');

    return (
      <div className="flex h-[calc(100vh/2)] w-[calc(100vw/2)] items-center justify-center rounded-16 bg-background-subtle-base shadow-tooltip">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button>Settings</Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Account Settings</SheetTitle>
            </SheetHeader>
            <SheetBody className="gap-20">
              <SheetDescription>
                Update your account information and preferences here.
              </SheetDescription>
              <div className="flex flex-col gap-20 w-full">
                <div className="flex flex-col gap-8 w-full">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    placeholder="John Doe"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-8 w-full">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="john@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>
            </SheetBody>
            <SheetFooter>
              <Button variant="transparent" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => setOpen(false)}>
                Save Changes
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>
    );
  },
};

export const WithoutCloseButton: Story = {
  play: (ctx) => screenshotOpenSheet(ctx, 'Sheet Without Close Button'),
  render: () => {
    const [open, setOpen] = useState(isTestEnvironment());

    return (
      <div className="flex h-[calc(100vh/2)] w-[calc(100vw/2)] items-center justify-center rounded-16 bg-background-subtle-base shadow-tooltip">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button>Open Sheet</Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader showClose={false}>
              <SheetTitle>Sheet Without Close Button</SheetTitle>
            </SheetHeader>
            <SheetBody>
              <SheetDescription>
                This sheet doesn't show a close button. Users can still close it by pressing Esc or
                clicking outside.
              </SheetDescription>
              <Text size="sm" className="text-foreground-neutral-subtle w-full">
                The close button can be hidden by setting the showClose prop to false.
              </Text>
            </SheetBody>
            <SheetFooter>
              <Button variant="primary" onClick={() => setOpen(false)}>
                Close
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>
    );
  },
};

export const LongContent: Story = {
  play: (ctx) => screenshotOpenSheet(ctx, 'Sheet With Long Content'),
  render: () => {
    const [open, setOpen] = useState(isTestEnvironment());

    return (
      <div className="flex h-[calc(100vh/2)] w-[calc(100vw/2)] items-center justify-center rounded-16 bg-background-subtle-base shadow-tooltip">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button>Open Sheet</Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Long Content Example</SheetTitle>
            </SheetHeader>
            <SheetBody>
              <SheetDescription>
                This sheet demonstrates how it handles long scrollable content.
              </SheetDescription>
              <div className="flex flex-col gap-16 w-full">
                {Array.from({length: 20}, (_, i) => {
                  const sectionId = `section-${i + 1}`;
                  return (
                    <div key={sectionId} className="flex flex-col gap-8">
                      <Text size="sm" className="font-medium text-foreground-neutral-base">
                        Section {i + 1}
                      </Text>
                      <Text size="sm" className="text-foreground-neutral-subtle">
                        This is paragraph {i + 1} of the long content. The sheet body is scrollable,
                        so you can scroll through all the content while the header and footer remain
                        fixed.
                      </Text>
                    </div>
                  );
                })}
              </div>
            </SheetBody>
            <SheetFooter>
              <Button variant="transparent" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => setOpen(false)}>
                Save
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>
    );
  },
};

const CLOSING_SURFACE_SELECTOR =
  '[data-state="closed"][role="dialog"], [data-state="closed"].fixed.inset-0';

/**
 * Closing an uncontrolled sheet must leave the page usable straight away: the
 * overlay and content stop catching clicks while they slide out, and the body
 * pointer-events lock comes off. Uncontrolled is the case with no other
 * coverage, since every visual story above drives `open` itself.
 */
export const TestClosingSurfaceStopsCatchingClicks: Story = {
  render: () => (
    <Sheet defaultOpen>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Sheet Title</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <Text size="sm">Body</Text>
        </SheetBody>
      </SheetContent>
    </Sheet>
  ),
  play: async () => {
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getAllByRole('button')[0] as HTMLElement);

    await waitFor(() => {
      const closing = document.querySelectorAll(CLOSING_SURFACE_SELECTOR);
      expect(closing.length).toBeGreaterThan(0);
      for (const node of closing) {
        expect(window.getComputedStyle(node).pointerEvents).toBe('none');
      }
    });

    await waitFor(() => {
      expect(document.body.style.pointerEvents).not.toBe('none');
    });
  },
};
