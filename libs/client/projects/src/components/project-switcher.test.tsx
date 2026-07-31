import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {fireEvent, render, screen} from '@testing-library/react';
import {toProject} from '#hooks/api/mappers.js';
import {projectsQueryKeys} from '#hooks/api/projects.js';
import {PROJECT_TEST_WID} from '#test/pages.js';
import {ProjectSwitcher} from './project-switcher.js';

const CREATE_PROJECT_LABEL_RE = /Create project/u;

describe('ProjectSwitcher', () => {
  test('keeps Create project pinned and keyboard-selectable under empty search', async () => {
    const onSelect = vi.fn();
    const projects = [projectDto({id: 'project-1', name: 'Platform'})];

    renderProjectSwitcher({onSelect, projects});
    await screen.findByRole('option', {name: 'Platform'});
    const createOption = screen.getByRole('option', {name: CREATE_PROJECT_LABEL_RE});
    const searchInput = screen.getByPlaceholderText('Search projects...');

    expect(createOption.closest('[data-slot="command-list"]')).toBeNull();

    fireEvent.change(searchInput, {target: {value: 'zzz-no-match'}});

    expect(screen.getByText('No projects found.')).toBeVisible();
    expect(screen.getByRole('option', {name: CREATE_PROJECT_LABEL_RE})).toBeVisible();

    searchInput.focus();
    fireEvent.keyDown(searchInput, {key: 'Enter', code: 'Enter'});

    expect(await screen.findByTestId('create-project-route')).toBeInTheDocument();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

function renderProjectSwitcher({
  onSelect,
  projects,
}: {
  onSelect: () => void;
  projects: ReturnType<typeof projectDto>[];
}) {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false, staleTime: Number.POSITIVE_INFINITY}},
  });
  queryClient.setQueryData(projectsQueryKeys.list(PROJECT_TEST_WID), {
    pages: [{projects: projects.map(toProject), nextCursor: null}],
    pageParams: [undefined],
  });
  const rootRoute = createRootRoute({component: Outlet});
  const workspaceRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workspaces/$wid',
    component: () => <ProjectSwitcher workspaceId={PROJECT_TEST_WID} onSelect={onSelect} />,
  });
  const createProjectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workspaces/$wid/projects/new',
    component: () => <div data-testid="create-project-route">Create project route</div>,
  });
  const router = createRouter({
    history: createMemoryHistory({initialEntries: [`/workspaces/${PROJECT_TEST_WID}`]}),
    routeTree: rootRoute.addChildren([workspaceRoute, createProjectRoute]),
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function projectDto({id, name}: {id: string; name: string}) {
  return {
    id,
    workspace_id: PROJECT_TEST_WID,
    name,
    slug: name.toLowerCase(),
    source: {
      connection_id: '33333333-3333-4333-8333-333333333333',
      external_repository_id: name.toLowerCase(),
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
