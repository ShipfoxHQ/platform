import type {Meta, StoryObj} from '@storybook/react';
import {Code} from '../typography/index.js';
import {Avatar} from './avatar.js';
import {AvatarGroup, AvatarGroupTooltip} from './avatar-group.js';

// In Playwright (Argos CI) navigator.webdriver is true. DiceBear image fetches
// are unreliable in CI. Skip them so screenshots are deterministic.
const isTest = typeof navigator !== 'undefined' && navigator.webdriver === true;

const contentOptions = ['letters', 'logo', 'logoPlaceholder', 'image', 'upload'] as const;
const radiusOptions = ['full', 'rounded'] as const;
const sizeOptions = ['3xs', '2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'] as const;
const logoNameOptions = ['shipfox', 'slack', 'stripe', 'github'] as const;

const meta = {
  title: 'Components/Avatar',
  component: Avatar,
  tags: ['autodocs'],
  argTypes: {
    content: {
      control: 'select',
      options: contentOptions,
    },
    radius: {
      control: 'select',
      options: radiusOptions,
    },
    size: {
      control: 'select',
      options: sizeOptions,
    },
    fallback: {
      control: 'text',
    },
    src: {
      control: 'text',
    },
    alt: {
      control: 'text',
    },
    logoName: {
      control: 'select',
      options: logoNameOptions,
      description: 'Logo icon name to display when content is "logo" or "logoPlaceholder"',
    },
  },
  args: {
    content: 'letters',
    radius: 'full',
    size: 'md',
    fallback: 'John Doe',
    logoName: 'shipfox',
  },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: {
    content: 'logo',
    fallback: 'Shipfox',
  },

  render: (args) => (
    <div className="flex flex-wrap items-end gap-16">
      {sizeOptions.map((size) => (
        <div key={size} className="flex flex-col items-center gap-8">
          <Avatar {...args} size={size} />
          <Code variant="label" className="text-foreground-neutral-base">
            {size}
          </Code>
        </div>
      ))}
    </div>
  ),
};

const avatarGroupMeta = {
  title: 'Components/AvatarGroup',
  component: AvatarGroup,
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: sizeOptions,
    },
    maxVisible: {
      control: 'number',
    },
  },
  args: {
    size: 'md',
    children: [],
  },
} satisfies Meta<typeof AvatarGroup>;

export const AvatarGroupDefault: StoryObj<typeof avatarGroupMeta> = {
  args: {
    children: [],
  },
  render: () => {
    const avatars = [
      {name: 'John Doe', content: isTest ? 'letters' : 'image'},
      {name: 'Jane Smith', content: isTest ? 'letters' : 'image'},
      {name: 'Bob Johnson', content: isTest ? 'letters' : 'image'},
      {name: 'Alice Brown', content: isTest ? 'letters' : 'image'},
    ] as const;

    return (
      <div className="flex flex-col gap-16">
        <div className="flex flex-col gap-8">
          <Code variant="label" className="text-foreground-neutral-base">
            Default (without tooltips)
          </Code>
          <AvatarGroup size="md">
            {avatars.map((avatar) => (
              <Avatar key={avatar.name} content={avatar.content} fallback={avatar.name} />
            ))}
          </AvatarGroup>
        </div>
      </div>
    );
  },
};

export const AvatarGroupWithTooltips: StoryObj<typeof avatarGroupMeta> = {
  args: {
    children: [],
  },
  render: () => {
    const avatars = [
      {name: 'John Doe', content: isTest ? 'letters' : 'image'},
      {name: 'Jane Smith', content: isTest ? 'letters' : 'image'},
      {name: 'Bob Johnson', content: isTest ? 'letters' : 'image'},
      {name: 'Alice Brown', content: isTest ? 'letters' : 'image'},
      {name: 'Carlos Vega', content: isTest ? 'letters' : 'image'},
      {name: 'Linda Tran', content: isTest ? 'letters' : 'image'},
    ] as const;

    return (
      <div className="flex flex-col gap-16">
        <div className="flex flex-col gap-8">
          <Code variant="label" className="text-foreground-neutral-base">
            With Tooltips
          </Code>
          <AvatarGroup size="md">
            {avatars.map((avatar) => (
              <Avatar key={avatar.name} content={avatar.content} fallback={avatar.name}>
                <AvatarGroupTooltip>{avatar.name}</AvatarGroupTooltip>
              </Avatar>
            ))}
          </AvatarGroup>
        </div>
        <div className="flex flex-col gap-8">
          <Code variant="label" className="text-foreground-neutral-base">
            With Tooltips (maxVisible: 4)
          </Code>
          <AvatarGroup size="md" maxVisible={4}>
            {avatars.map((avatar) => (
              <Avatar key={avatar.name} content={avatar.content} fallback={avatar.name}>
                <AvatarGroupTooltip>{avatar.name}</AvatarGroupTooltip>
              </Avatar>
            ))}
          </AvatarGroup>
        </div>
        <div className="flex flex-col gap-8">
          <Code variant="label" className="text-foreground-neutral-base">
            With Tooltips and Hover Animation
          </Code>
          <AvatarGroup size="md" maxVisible={4} animateOnHover>
            {avatars.map((avatar) => (
              <Avatar key={avatar.name} content={avatar.content} fallback={avatar.name}>
                <AvatarGroupTooltip>{avatar.name}</AvatarGroupTooltip>
              </Avatar>
            ))}
          </AvatarGroup>
        </div>
      </div>
    );
  },
};
