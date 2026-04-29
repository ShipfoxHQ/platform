import type {Meta, StoryObj} from '@storybook/react';
import {FullPageLoader} from './full-page-loader.js';
import {ShipfoxLoader} from './shipfox-loader.js';

const meta = {
  title: 'Components/Loader',
  component: ShipfoxLoader,
  tags: ['autodocs'],
  argTypes: {
    animation: {
      control: 'select',
      options: ['random', 'circular', 'linear'],
    },
    color: {
      control: 'select',
      options: ['orange', 'white', 'black'],
    },
    background: {
      control: 'select',
      options: ['dark', 'light', 'transparent'],
    },
    size: {control: 'number'},
    speed: {control: 'number'},
    showControls: {control: 'boolean'},
    autoPlay: {control: 'boolean'},
  },
  args: {
    size: 80,
    animation: 'random',
    color: 'orange',
    background: 'dark',
    autoPlay: true,
    showControls: false,
    speed: 1,
  },
} satisfies Meta<typeof ShipfoxLoader>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="flex items-center gap-32">
      <ShipfoxLoader size={80} animation="random" color="orange" background="dark" />
      <ShipfoxLoader size={80} animation="circular" color="white" background="dark" />
      <ShipfoxLoader size={80} animation="leftright" color="black" background="light" />
    </div>
  ),
};

export const FullPage: Story = {
  render: () => <FullPageLoader className="h-320 w-560 rounded-8" />,
};
