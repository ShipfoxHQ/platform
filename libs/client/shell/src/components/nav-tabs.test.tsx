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
  return <NavTabs ariaLabel="Workspace sections" entries={entries} />;
}

const projectEntries: readonly NavTabEntry[] = [
  {
    id: 'runs',
    scope: 'project',
    label: 'Runs',
    to: '/w/$workspaceSlug/p/$projectSlug/runs',
  },
];

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
    expect(projectsTab).toHaveClass(
      'text-foreground-neutral-subtle',
      'hover:text-foreground-neutral-base',
    );
    expect(projectsTab).toHaveAttribute('aria-selected', 'false');
    expect(settingsTab).toHaveClass('text-foreground-neutral-base');
    expect(settingsTab).toHaveAttribute('aria-selected', 'true');
  });

  test('uses a quiet branded marker for the active project section', async () => {
    const rootRoute = createRootRoute({component: Outlet});
    const runsRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/w/$workspaceSlug/p/$projectSlug/runs',
      component: () => (
        <NavTabs ariaLabel="Project sections" entries={projectEntries} projectScoped />
      ),
    });
    const router = createRouter({
      history: createMemoryHistory({initialEntries: ['/w/workspace/p/project/runs']}),
      routeTree: rootRoute.addChildren([runsRoute]),
    });

    render(<RouterProvider router={router} />);

    const runsTab = await screen.findByRole('tab', {name: 'Runs'});
    expect(screen.getByRole('tablist', {name: 'Project sections'})).toHaveClass(
      'overflow-x-auto',
      'whitespace-nowrap',
    );
    expect(runsTab).toHaveClass('shrink-0', 'whitespace-nowrap');
    expect(runsTab).toHaveClass('border-b', 'border-border-highlights-interactive');
    expect(runsTab).not.toHaveClass('border-b-2');
  });
});
