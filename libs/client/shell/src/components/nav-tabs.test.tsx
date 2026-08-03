import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {render, screen} from '@testing-library/react';
import type {NavTabEntry} from '#contract.js';
import {NavTabs} from './nav-tabs.js';

const entries: readonly NavTabEntry[] = [
  {
    id: 'projects',
    scope: 'workspace',
    label: 'Projects',
    to: '/w/$workspaceSlug/projects',
    exact: true,
  },
  {
    id: 'settings',
    scope: 'workspace',
    label: 'Settings',
    to: '/w/$workspaceSlug/settings',
  },
];

function WorkspaceTabs() {
  return <NavTabs entries={entries} scope="workspace" />;
}

describe('NavTabs', () => {
  test('distinguishes active and inactive workspace tabs', async () => {
    const rootRoute = createRootRoute({component: Outlet});
    const projectsRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/w/$workspaceSlug/projects',
      component: WorkspaceTabs,
    });
    const settingsRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/w/$workspaceSlug/settings',
      component: WorkspaceTabs,
    });
    const router = createRouter({
      history: createMemoryHistory({initialEntries: ['/w/workspace/settings']}),
      routeTree: rootRoute.addChildren([projectsRoute, settingsRoute]),
    });

    render(<RouterProvider router={router} />);

    const projectsTab = await screen.findByRole('tab', {name: 'Projects'});
    const settingsTab = screen.getByRole('tab', {name: 'Settings'});
    expect(projectsTab).toHaveClass('text-foreground-neutral-muted');
    expect(projectsTab).toHaveAttribute('aria-selected', 'false');
    expect(settingsTab).toHaveClass('text-foreground-neutral-base');
    expect(settingsTab).toHaveAttribute('aria-selected', 'true');
  });
});
