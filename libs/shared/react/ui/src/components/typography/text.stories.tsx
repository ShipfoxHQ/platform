import type {Meta, StoryObj} from '@storybook/react';
import {Code} from './code.js';
import {Text} from './text.js';

const meta = {
  title: 'Typography/Text',
  component: Text,
  tags: ['autodocs'],
} satisfies Meta<typeof Text>;

export default meta;

type Story = StoryObj<typeof meta>;

const sizes = ['xs', 'sm', 'md', 'lg', 'xl'] as const;
const textParagraph =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';

export const Default: Story = {
  render: () => (
    <div className="flex flex-col gap-16">
      {sizes.map((size) => (
        <div key={size} className="grid grid-cols-2 gap-8">
          <div className="flex flex-col gap-4">
            <Code variant="label" className="text-foreground-neutral-subtle">
              {size}
            </Code>
            <Text size={size}>The quick brown fox jumps over the lazy dog</Text>
          </div>
          <div className="flex flex-col gap-4">
            <Code variant="label" className="text-foreground-neutral-subtle">
              {size} bold
            </Code>
            <Text size={size} bold>
              The quick brown fox jumps over the lazy dog
            </Text>
          </div>
        </div>
      ))}
    </div>
  ),
};

export const Paragraph: Story = {
  render: () => (
    <div className="flex flex-col gap-16">
      {sizes.map((size) => (
        <div key={size} className="grid grid-cols-2 gap-8">
          <div className="flex flex-col gap-4">
            <Code variant="label" className="text-foreground-neutral-subtle">
              {size} regular
            </Code>
            <Text size={size} compact={false}>
              {textParagraph}
            </Text>
          </div>
          <div className="flex flex-col gap-4">
            <Code variant="label" className="text-foreground-neutral-subtle">
              {size} compact
            </Code>
            <Text size={size}>{textParagraph}</Text>
          </div>
        </div>
      ))}
    </div>
  ),
};
