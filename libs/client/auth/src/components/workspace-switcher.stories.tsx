import {argosScreenshot} from '@argos-ci/storybook/vitest';
import type {Meta, StoryObj} from '@storybook/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {createStore, Provider as JotaiProvider} from 'jotai';
import {useMemo} from 'react';
import {expect, userEvent, waitFor, within} from 'storybook/test';
import {authStateAtom, type Workspace} from '#state/auth.js';
import {WorkspaceSwitcher} from './workspace-switcher.js';

const ACTIVE_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const WORKSPACES = [
  workspace(ACTIVE_WORKSPACE_ID, 'Alpha Workspace', 1),
  workspace('00000000-0000-4000-8000-000000000002', 'Beta Workspace', 2),
  workspace('00000000-0000-4000-8000-000000000003', 'Gamma Workspace', 3),
  workspace('00000000-0000-4000-8000-000000000004', 'Delta Workspace', 4),
];
const SINGLE_WORKSPACE = [workspace(ACTIVE_WORKSPACE_ID, 'Alpha Workspace', 1)];
const MANY_WORKSPACES = Array.from({length: 20}, (_, index) =>
  workspace(
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    `Workspace ${String(index + 1).padStart(2, '0')}`,
    index + 1,
  ),
);

interface WorkspaceSwitcherStoryProps {
  activeWorkspaceId: string;
  workspaces: Workspace[];
}

function workspace(id: string, name: string, index: number): Workspace {
  return {
    id,
    name,
    slug: name.toLowerCase().replaceAll(' ', '-'),
    membershipId: `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  };
}

function WorkspaceSwitcherStory({activeWorkspaceId, workspaces}: WorkspaceSwitcherStoryProps) {
  const store = useMemo(() => {
    const nextStore = createStore();
    nextStore.set(authStateAtom, {status: 'authenticated', workspaces});
    return nextStore;
  }, [workspaces]);
  const router = useMemo(() => {
    const rootRoute = createRootRoute({component: Outlet});
    const workspaceRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/workspaces/$wid',
      component: () => (
        <JotaiProvider store={store}>
          <div className="min-h-screen bg-background-neutral-base p-24">
            <div className="w-[280px] rounded-10 bg-background-neutral-overlay shadow-tooltip">
              <WorkspaceSwitcher activeWorkspaceId={activeWorkspaceId} />
            </div>
          </div>
        </JotaiProvider>
      ),
    });
    const setupRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/setup/workspaces/new',
      component: () => <div />,
    });

    return createRouter({
      routeTree: rootRoute.addChildren([workspaceRoute, setupRoute]),
      history: createMemoryHistory({initialEntries: [`/workspaces/${activeWorkspaceId}`]}),
    });
  }, [activeWorkspaceId, store]);

  return <RouterProvider router={router} />;
}

const meta = {
  title: 'Auth/WorkspaceSwitcher',
  component: WorkspaceSwitcherStory,
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    activeWorkspaceId: ACTIVE_WORKSPACE_ID,
    workspaces: WORKSPACES,
  },
} satisfies Meta<typeof WorkspaceSwitcherStory>;

export default meta;
type Story = StoryObj<typeof meta>;
type WorkspaceSwitcherStoryContext = Parameters<NonNullable<Story['play']>>[0];

async function captureSwitcher(ctx: WorkspaceSwitcherStoryContext, screenshotName: string) {
  const canvas = within(ctx.canvasElement);
  await canvas.findByRole('option', {name: 'Create workspace'});
  await argosScreenshot(ctx, screenshotName);
}

export const Playground: Story = {
  play: async (ctx) => {
    await captureSwitcher(ctx, 'Workspace Switcher Open');
  },
};

export const SingleWithCreate: Story = {
  args: {
    workspaces: SINGLE_WORKSPACE,
  },
  play: async (ctx) => {
    await captureSwitcher(ctx, 'Workspace Switcher Single With Create');
  },
};

export const EmptySearch: Story = {
  play: async (ctx) => {
    const canvas = within(ctx.canvasElement);

    await userEvent.type(
      await canvas.findByPlaceholderText('Search workspaces...'),
      'zzz-no-match',
    );

    await canvas.findByText('No workspaces found.');
    await canvas.findByRole('option', {name: 'Create workspace'});
    await argosScreenshot(ctx, 'Workspace Switcher Empty Search');
  },
};

export const ManyOverflow: Story = {
  args: {
    activeWorkspaceId: MANY_WORKSPACES[0]?.id ?? ACTIVE_WORKSPACE_ID,
    workspaces: MANY_WORKSPACES,
  },
  play: async (ctx) => {
    await captureSwitcher(ctx, 'Workspace Switcher Many Overflow');
  },
};

export const ManyOverflowScrolled: Story = {
  args: {
    activeWorkspaceId: MANY_WORKSPACES[0]?.id ?? ACTIVE_WORKSPACE_ID,
    workspaces: MANY_WORKSPACES,
  },
  play: async (ctx) => {
    const canvas = within(ctx.canvasElement);

    await canvas.findByRole('option', {name: 'Workspace 01'});
    await canvas.findByRole('option', {name: 'Create workspace'});

    await canvas.findByRole('option', {name: 'Workspace 20'});
    const firstOption = canvas.getAllByRole('option')[0];
    let scrollContainer = firstOption?.parentElement ?? null;
    while (scrollContainer && scrollContainer.scrollHeight <= scrollContainer.clientHeight) {
      scrollContainer = scrollContainer.parentElement;
    }
    if (!scrollContainer) {
      throw new Error('Workspace switcher scroll container was not found');
    }
    scrollContainer.scrollTop = scrollContainer.scrollHeight;

    await waitFor(() => expect(canvas.getByRole('option', {name: 'Workspace 20'})).toBeVisible());
    await argosScreenshot(ctx, 'Workspace Switcher Many Overflow Scrolled');
  },
};
