import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {type RenderResult, render} from '@testing-library/react';
import type {ReactElement} from 'react';

function createComponentRouter(element: ReactElement) {
  const rootRoute = createRootRoute({component: Outlet});
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => element,
  });
  // Workflow run rows link here; TanStack Router needs the target route to build hrefs.
  const runDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId',
    component: () => null,
  });

  return createRouter({
    history: createMemoryHistory({initialEntries: ['/']}),
    routeTree: rootRoute.addChildren([indexRoute, runDetailRoute]),
  });
}

export function renderWithRouter(
  element: ReactElement,
): RenderResult & {router: ReturnType<typeof createComponentRouter>} {
  const router = createComponentRouter(element);

  const result = render(<RouterProvider router={router} />);

  return Object.assign(result, {router});
}
