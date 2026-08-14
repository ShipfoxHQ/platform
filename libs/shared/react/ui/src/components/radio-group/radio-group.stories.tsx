import type {Meta, StoryObj} from '@storybook/react';
import {useState} from 'react';
import {Label} from '#components/label/index.js';
import {Text} from '#components/typography/index.js';
import {RadioGroup, RadioGroupItem, RadioGroupItemSkeleton} from './radio-group.js';

const meta = {
  title: 'Components/RadioGroup',
  component: RadioGroup,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Single-select picker built on `@radix-ui/react-radio-group`. Use for source-control connection pickers, repository pickers, and other "1-of-N" choices where each option is a card-shaped surface. The leading dot is what separates a choice from a navigation tile, which wears a trailing chevron instead. Arrow keys cycle selection, Home/End jump to ends.',
      },
    },
  },
} satisfies Meta<typeof RadioGroup>;

export default meta;

type Story = StoryObj<typeof meta>;

const SAMPLE_CONNECTIONS = [
  {id: 'conn-1', name: 'GitHub Source Control', subtitle: 'github · acme'},
  {id: 'conn-2', name: 'Debug', subtitle: 'debug · debug'},
  {id: 'conn-3', name: 'Other GitHub Source', subtitle: 'github · acme-fork'},
];

function Option({name, subtitle}: {name: string; subtitle: string}) {
  return (
    <>
      <Text as="span" size="sm" bold>
        {name}
      </Text>
      <Text as="span" size="xs" className="text-foreground-neutral-muted">
        {subtitle}
      </Text>
    </>
  );
}

export const Playground: Story = {
  render: () => {
    function ControlledRadioGroup() {
      const [value, setValue] = useState<string>('conn-1');
      return (
        <div className="flex w-[420px] flex-col gap-10">
          <Label id="connection-picker-label">Source connection</Label>
          <RadioGroup
            aria-labelledby="connection-picker-label"
            value={value}
            onValueChange={setValue}
          >
            {SAMPLE_CONNECTIONS.map((connection) => (
              <RadioGroupItem key={connection.id} value={connection.id}>
                <Option name={connection.name} subtitle={connection.subtitle} />
              </RadioGroupItem>
            ))}
          </RadioGroup>
        </div>
      );
    }
    return <ControlledRadioGroup />;
  },
};

export const States: Story = {
  render: () => (
    <div className="flex w-[420px] flex-col gap-24">
      <div className="flex flex-col gap-10">
        <Label>States preview</Label>
        <RadioGroup defaultValue="conn-2">
          <RadioGroupItem value="conn-1">
            <Option name="Default" subtitle="Unselected" />
          </RadioGroupItem>
          <RadioGroupItem value="conn-2">
            <Option name="Selected" subtitle='data-state="checked"' />
          </RadioGroupItem>
          <RadioGroupItem value="conn-3" className="hover">
            <Option name="Hover" subtitle="Pseudo-class preview" />
          </RadioGroupItem>
          <RadioGroupItem value="conn-4" disabled>
            <Option name="Disabled" subtitle="Not selectable" />
          </RadioGroupItem>
        </RadioGroup>
      </div>

      {/* A roving tabindex lands keyboard focus on the checked item first, so the
          checked + focused pair is the state most likely to regress. */}
      <div className="flex flex-col gap-10">
        <Label>Keyboard focus</Label>
        <RadioGroup defaultValue="focus-2">
          <RadioGroupItem value="focus-1" className="focus">
            <Option name="Focus visible" subtitle="Unselected, keyboard focused" />
          </RadioGroupItem>
          <RadioGroupItem value="focus-2" className="focus">
            <Option name="Focus visible" subtitle="Selected and keyboard focused" />
          </RadioGroupItem>
        </RadioGroup>
      </div>
    </div>
  ),
  parameters: {
    pseudo: {
      hover: '.hover',
      focusVisible: '.focus',
    },
  },
};

export const SingleOption: Story = {
  render: () => (
    <div className="flex w-[420px] flex-col gap-10">
      <Label>Source connection</Label>
      <RadioGroup defaultValue="only-one">
        <RadioGroupItem value="only-one">
          <Option
            name="Only one option"
            subtitle="Pre-selected; useful when there is exactly one connection."
          />
        </RadioGroupItem>
      </RadioGroup>
    </div>
  ),
};

export const Loading: Story = {
  render: () => (
    <div className="flex w-[420px] flex-col gap-10">
      <Label>Repository</Label>
      <div className="flex flex-col gap-inline">
        {['w-64', 'w-96', 'w-80', 'w-112'].map((width) => (
          <RadioGroupItemSkeleton key={width} labelClassName={width} />
        ))}
      </div>
    </div>
  ),
};
