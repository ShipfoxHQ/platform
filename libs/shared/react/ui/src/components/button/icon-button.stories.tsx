import type {Meta, StoryObj} from '@storybook/react';
import {Code} from '#components/typography/index.js';
import {IconButton} from './icon-button.js';

const variantOptions = ['primary', 'transparent'] as const;
const sizeOptions = ['2xs', 'xs', 'sm', 'md', 'lg', 'xl'] as const;
const radiusOptions = ['rounded', 'full'] as const;

const meta = {
  title: 'Components/Button/IconButton',
  component: IconButton,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: variantOptions,
    },
    size: {
      control: 'select',
      options: sizeOptions,
    },
    radius: {
      control: 'select',
      options: radiusOptions,
    },
    muted: {control: 'boolean'},
    isLoading: {control: 'boolean'},
    asChild: {control: 'boolean'},
  },
  args: {
    icon: 'addLine',
    variant: 'primary',
    size: 'md',
    radius: 'rounded',
    muted: false,
    'aria-label': 'Add',
  },
} satisfies Meta<typeof IconButton>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Variants: Story = {
  render: (args) => (
    <div className="flex flex-col gap-32">
      {sizeOptions.map((size) => (
        <div key={size} className="flex flex-col gap-16">
          <Code variant="label" className="text-foreground-neutral-subtle">
            Size: {size}
          </Code>
          {radiusOptions.map((radius) => (
            <table
              key={radius}
              className="w-fit border-separate border-spacing-x-32 border-spacing-y-16"
            >
              <thead>
                <tr>
                  <th>{radius}</th>
                  <th>Default</th>
                  <th>Hover</th>
                  <th>Focus</th>
                  <th>Disabled</th>
                </tr>
              </thead>
              <tbody>
                {variantOptions.map((variant) => (
                  <tr key={variant}>
                    <td>
                      <Code variant="label" className="text-foreground-neutral-subtle">
                        {variant}
                      </Code>
                    </td>
                    <td>
                      <IconButton {...args} variant={variant} size={size} radius={radius} />
                    </td>
                    <td>
                      <IconButton
                        {...args}
                        variant={variant}
                        className="hover"
                        size={size}
                        radius={radius}
                      />
                    </td>
                    <td>
                      <IconButton
                        {...args}
                        variant={variant}
                        className="focus"
                        size={size}
                        radius={radius}
                      />
                    </td>
                    <td>
                      <IconButton
                        {...args}
                        variant={variant}
                        disabled
                        size={size}
                        radius={radius}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      ))}
    </div>
  ),
  parameters: {
    pseudo: {
      hover: '.hover',
      focusVisible: '.focus',
    },
  },
};

export const States: Story = {
  render: (args) => (
    <div className="flex items-center gap-16">
      <IconButton {...args} icon="addLine" aria-label="Add" />
      <IconButton {...args} icon="addLine" aria-label="Add muted" muted />
      <IconButton {...args} icon="spinner" aria-label="Loading" isLoading />
      <IconButton {...args} icon="addLine" aria-label="Disabled" disabled />
    </div>
  ),
};
