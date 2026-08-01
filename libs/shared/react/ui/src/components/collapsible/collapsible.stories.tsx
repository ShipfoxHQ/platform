import type {Meta, StoryObj} from '@storybook/react';
import {useState} from 'react';
import {Button} from '#components/button/index.js';
import {Card} from '#components/card/index.js';
import {Icon} from '#components/icon/index.js';
import {Text} from '#components/typography/index.js';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from './collapsible.js';

const isTestEnvironment = () => typeof navigator !== 'undefined' && navigator.webdriver === true;

const meta = {
  title: 'Components/Collapsible',
  component: Collapsible,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Single panel that expands and collapses, built on `@radix-ui/react-collapsible`. Use it for "show more" rows, optional/advanced settings, and any place a section should fold away until needed. The three primitives (`Collapsible`, `CollapsibleTrigger`, and `CollapsibleContent`) compose with our `Button`, `Icon`, and surface components; the content animates its height with the shared `collapsible-down`/`collapsible-up` keyframes. For several independently toggled rows, compose multiple `Collapsible`s. `CollapsibleContent` stays `overflow-hidden` so the height animation can clip cleanly, so portal any nested overlay (popover, tooltip, dropdown menu) rather than rendering it inline, where it would be clipped.',
      },
    },
  },
} satisfies Meta<typeof Collapsible>;

export default meta;

type Story = StoryObj<typeof meta>;

function TriggerRow({children}: {children: React.ReactNode}) {
  return (
    <CollapsibleTrigger className="group flex w-full items-center justify-between gap-8 rounded-6 px-8 py-6 text-left text-foreground-neutral-base transition-colors hover:bg-background-button-transparent-hover focus-visible:shadow-button-neutral-focus">
      <Text size="sm" bold>
        {children}
      </Text>
      <Icon
        name="chevronRight"
        className="text-foreground-neutral-muted transition-transform group-data-[state=open]:rotate-90"
      />
    </CollapsibleTrigger>
  );
}

export const Playground: Story = {
  render: () => (
    <Collapsible className="flex w-[420px] flex-col gap-4">
      <TriggerRow>Repository access</TriggerRow>
      <CollapsibleContent>
        <Text size="sm" className="px-8 py-6 text-foreground-neutral-muted">
          Grant the runner read access to the repositories it needs to clone. You can change the
          selection at any time from workspace settings.
        </Text>
      </CollapsibleContent>
    </Collapsible>
  ),
};

export const Open: Story = {
  render: () => (
    <Collapsible defaultOpen className="flex w-[420px] flex-col gap-4">
      <TriggerRow>Repository access</TriggerRow>
      <CollapsibleContent>
        <Text size="sm" className="px-8 py-6 text-foreground-neutral-muted">
          Grant the runner read access to the repositories it needs to clone. You can change the
          selection at any time from workspace settings.
        </Text>
      </CollapsibleContent>
    </Collapsible>
  ),
};

export const Controlled: Story = {
  render: () => {
    function ControlledCollapsible() {
      const [open, setOpen] = useState(isTestEnvironment());
      return (
        <div className="flex w-[420px] flex-col gap-10">
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            iconRight={open ? 'subtractLine' : 'addLine'}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? 'Hide advanced settings' : 'Show advanced settings'}
          </Button>

          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleContent>
              <Card>
                <Text size="sm" className="text-foreground-neutral-muted">
                  Advanced settings let you override the default runner image, concurrency limits,
                  and environment variables. Most workspaces never need to touch these.
                </Text>
              </Card>
            </CollapsibleContent>
          </Collapsible>
        </div>
      );
    }

    return <ControlledCollapsible />;
  },
};

export const InCard: Story = {
  render: () => (
    <Card className="w-[420px] gap-8">
      <Collapsible defaultOpen className="flex flex-col gap-4">
        <TriggerRow>What counts as a build minute?</TriggerRow>
        <CollapsibleContent>
          <Text size="sm" className="px-8 py-6 text-foreground-neutral-muted">
            A build minute is one wall-clock minute a runner spends executing your job, rounded up
            to the nearest second and billed per runner.
          </Text>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  ),
};
