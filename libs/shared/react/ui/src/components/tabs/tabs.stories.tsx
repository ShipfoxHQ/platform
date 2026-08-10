import {argosScreenshot} from '@argos-ci/storybook/vitest';
import type {Meta, StoryObj} from '@storybook/react';
import {useState} from 'react';
import {Tabs, TabsContent, TabsContents, TabsList, TabsTrigger} from '.';

const meta = {
  title: 'Components/Tabs',
  component: Tabs,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: {defaultValue: 'analytics'} as never,
  play: async (ctx) => {
    // Wait for requestAnimationFrame inside TabsList to fire and position the
    // active indicator before taking the Argos screenshot.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await argosScreenshot(ctx, 'Tabs Default');
  },
  render: () => (
    <div className="bg-background-subtle-base p-24 w-[80vw]">
      <Tabs defaultValue="analytics">
        <TabsList className="gap-12 border-b border-neutral-strong">
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  ),
};

export const Controlled: Story = {
  args: {value: 'analytics', onValueChange: () => undefined} as never,
  play: async (ctx) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await argosScreenshot(ctx, 'Tabs Controlled');
  },
  render: () => {
    const [value, setValue] = useState('analytics');
    return (
      <div className="bg-background-subtle-base p-24 w-[80vw]">
        <Tabs value={value} onValueChange={setValue}>
          <TabsList className="gap-12 border-b border-neutral-strong">
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            <TabsTrigger value="jobs">Jobs</TabsTrigger>
          </TabsList>
          <TabsContents>
            <TabsContent value="analytics">
              <div className="py-16">
                <p className="text-foreground-neutral-base">
                  Analytics content - Current value: {value}
                </p>
              </div>
            </TabsContent>
            <TabsContent value="jobs">
              <div className="py-16">
                <p className="text-foreground-neutral-base">
                  Jobs content - Current value: {value}
                </p>
              </div>
            </TabsContent>
          </TabsContents>
        </Tabs>
      </div>
    );
  },
};

export const MultipleTabs: Story = {
  args: {defaultValue: 'tab1'} as never,
  play: async (ctx) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    await argosScreenshot(ctx, 'Tabs Multiple');
  },
  render: () => (
    <div className="bg-background-subtle-base p-24 w-[80vw]">
      <Tabs defaultValue="tab1">
        <TabsList className="gap-12 border-b border-neutral-strong">
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          <TabsTrigger value="tab2">Tab 2</TabsTrigger>
          <TabsTrigger value="tab3">Tab 3</TabsTrigger>
          <TabsTrigger value="tab4">Tab 4</TabsTrigger>
        </TabsList>
        <TabsContents>
          <TabsContent value="tab1">
            <div className="py-16">
              <p className="text-foreground-neutral-base">Content for Tab 1</p>
            </div>
          </TabsContent>
          <TabsContent value="tab2">
            <div className="py-16">
              <p className="text-foreground-neutral-base">Content for Tab 2</p>
            </div>
          </TabsContent>
          <TabsContent value="tab3">
            <div className="py-16">
              <p className="text-foreground-neutral-base">Content for Tab 3</p>
            </div>
          </TabsContent>
          <TabsContent value="tab4">
            <div className="py-16">
              <p className="text-foreground-neutral-base">Content for Tab 4</p>
            </div>
          </TabsContent>
        </TabsContents>
      </Tabs>
    </div>
  ),
};
