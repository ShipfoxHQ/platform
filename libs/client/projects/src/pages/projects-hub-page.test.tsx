import {configureApiClient} from '@shipfox/client-api';
import {fireEvent, screen, waitFor, within} from '@testing-library/react';
import {
  jsonResponse,
  PROJECT_TEST_WID,
  PROJECT_TEST_WSLUG,
  renderProjectPage,
} from '#test/pages.js';
import {ProjectsHubPage} from './projects-hub-page.js';

const NEW_PROJECT_REGEX = /New project/i;
const WORKSPACE_PROJECTS_NEW_HREF = `/w/${PROJECT_TEST_WSLUG}/projects/new`;
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';

function StubWorkspaceSetupChecklist() {
  return <section aria-label="Workspace setup checklist">Workspace setup checklist</section>;
}

describe('ProjectsHubPage', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  test('renders the workspace setup checklist before the projects panel', async () => {
    configureApiClient({
      fetchImpl: createHubFetch({
        projects: jsonResponse({projects: [], next_cursor: null}),
      }),
    });

    renderProjectPage(`/w/${PROJECT_TEST_WSLUG}`, <ProjectsHubPage />, undefined, {
      WorkspaceSetupChecklist: StubWorkspaceSetupChecklist,
    });

    expect(await screen.findByText('Create your first project')).toBeInTheDocument();
    const checklist = screen.getByRole('region', {name: 'Workspace setup checklist'});
    const projects = screen.getByRole('region', {name: 'Projects'});

    expect(checklist.compareDocumentPosition(projects) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  test('renders the Projects panel controls and empty state with create CTA', async () => {
    configureApiClient({
      fetchImpl: createHubFetch({
        projects: jsonResponse({projects: [], next_cursor: null}),
      }),
    });

    renderProjectPage(`/w/${PROJECT_TEST_WSLUG}`, <ProjectsHubPage />);

    expect(await screen.findByText('Create your first project')).toBeInTheDocument();
    // Without the slot, the hub renders no checklist panel above the projects.
    expect(
      screen.queryByRole('region', {name: 'Workspace setup checklist'}),
    ).not.toBeInTheDocument();
    const projectsRegion = screen.getByRole('region', {name: 'Projects'});
    expect(projectsRegion.querySelectorAll('[data-slot="panel"]')).toHaveLength(1);
    const panelHeader = projectsRegion.querySelector<HTMLElement>('[data-slot="panel-header"]');
    if (!panelHeader) throw new Error('Projects panel header was not rendered');
    expect(panelHeader).toBeInTheDocument();
    expect(projectsRegion.querySelector('[data-slot="panel-body"]')).toBeInTheDocument();
    expect(screen.queryByRole('heading', {name: 'Projects'})).not.toBeInTheDocument();
    expect(
      within(panelHeader).getByRole('searchbox', {name: 'Search projects'}),
    ).toBeInTheDocument();
    expect(within(panelHeader).getByRole('link', {name: NEW_PROJECT_REGEX})).toHaveAttribute(
      'href',
      WORKSPACE_PROJECTS_NEW_HREF,
    );
    expect(
      (screen.getAllByRole('link', {name: 'Create project'})[0] as HTMLAnchorElement).getAttribute(
        'href',
      ),
    ).toBe(WORKSPACE_PROJECTS_NEW_HREF);
  });

  test('renders projects and loads the next cursor page', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(requestInputUrl(input));
      if (url.pathname === '/integration-connections') {
        return Promise.resolve(jsonResponse(connectionsDto()));
      }
      if (url.pathname === '/projects') {
        if (url.searchParams.get('cursor') === 'cursor-1') {
          return Promise.resolve(
            jsonResponse({
              projects: [projectDto({id: '11111111-1111-4111-8111-111111111113', name: 'API'})],
              next_cursor: null,
            }),
          );
        }
        return Promise.resolve(
          jsonResponse({
            projects: [projectDto({id: '11111111-1111-4111-8111-111111111112', name: 'Platform'})],
            next_cursor: 'cursor-1',
          }),
        );
      }
      return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
    });
    configureApiClient({fetchImpl});

    renderProjectPage(`/w/${PROJECT_TEST_WSLUG}`, <ProjectsHubPage />);
    expect(await screen.findByText('Platform')).toBeInTheDocument();
    const projectsList = screen.getByRole('list', {name: 'Projects list'});
    expect(projectsList).toHaveClass('grid-cols-2', 'max-[760px]:grid-cols-1');
    expect(projectsList).not.toHaveClass('gap-px');
    expect(projectsList).not.toHaveClass('bg-border-neutral-base');
    expect(projectsList.querySelectorAll('[data-slot="panel-cell"]')).toHaveLength(1);
    const projectLink = screen.getByText('Platform').closest('a');
    // The whole cell is the link, carrying an inset neutral focus ring.
    expect(projectLink).toHaveClass('focus-visible:shadow-focus-inset');
    expect(projectLink).toHaveClass('hover:bg-background-neutral-hover');

    fireEvent.click(screen.getByRole('button', {name: 'Load more'}));

    expect(await screen.findByText('API')).toBeInTheDocument();
  });

  test('renders an odd project count without an empty border-colored cell', async () => {
    configureApiClient({
      fetchImpl: createHubFetch({
        projects: jsonResponse({
          projects: [
            projectDto({id: '11111111-1111-4111-8111-111111111112', name: 'Platform'}),
            projectDto({id: '11111111-1111-4111-8111-111111111113', name: 'Agent'}),
            projectDto({id: '11111111-1111-4111-8111-111111111114', name: 'Workflows'}),
          ],
          next_cursor: null,
        }),
      }),
    });

    renderProjectPage(`/w/${PROJECT_TEST_WSLUG}`, <ProjectsHubPage />);

    const projectsList = await screen.findByRole('list', {name: 'Projects list'});
    expect(projectsList.querySelectorAll('[data-slot="panel-cell"]')).toHaveLength(3);
    expect(projectsList).not.toHaveClass('gap-px', 'bg-border-neutral-base');
    // The odd count is padded so the last row's divider still spans the panel,
    // and the pad carries the panel fill rather than the border colour.
    const filler = projectsList.querySelector('[data-slot="panel-cell-filler"]');
    expect(filler).not.toBeNull();
    expect(filler).toHaveClass('bg-background-neutral-base');
  });

  test('keeps existing projects and the load-more retry after a cursor failure', async () => {
    let cursorRequests = 0;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(requestInputUrl(input));
      if (url.pathname === '/integration-connections') {
        return Promise.resolve(jsonResponse(connectionsDto()));
      }
      if (url.pathname === '/projects') {
        if (url.searchParams.get('cursor') === 'cursor-1') {
          cursorRequests += 1;
          return Promise.resolve(jsonResponse({code: 'server-error'}, {status: 500}));
        }
        return Promise.resolve(
          jsonResponse({
            projects: [projectDto({id: '11111111-1111-4111-8111-111111111112', name: 'Platform'})],
            next_cursor: 'cursor-1',
          }),
        );
      }
      return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
    });
    configureApiClient({fetchImpl});

    renderProjectPage(`/w/${PROJECT_TEST_WSLUG}`, <ProjectsHubPage />);
    expect(await screen.findByText('Platform')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'Load more'}));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load the next page. Existing projects are still shown.',
    );
    expect(screen.getByText('Platform')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Load more'})).toBeInTheDocument();
    expect(cursorRequests).toBe(1);

    fireEvent.click(screen.getByRole('button', {name: 'Load more'}));

    await waitFor(() => expect(cursorRequests).toBe(2));
  });

  test('renders an error alert with retry', async () => {
    configureApiClient({
      fetchImpl: createHubFetch({
        projects: jsonResponse({code: 'server-error'}, {status: 500}),
      }),
    });

    renderProjectPage(`/w/${PROJECT_TEST_WSLUG}`, <ProjectsHubPage />);

    expect(await screen.findByText("Couldn't load projects")).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Retry loading projects'})).toBeInTheDocument();
  });

  test('shows no status pill or repository id for a connected source', async () => {
    configureApiClient({
      fetchImpl: createHubFetch({
        projects: jsonResponse({
          projects: [
            projectDto({
              id: '11111111-1111-4111-8111-111111111112',
              name: 'Platform',
              externalRepositoryId: 'github:octo/platform',
            }),
          ],
          next_cursor: null,
        }),
        connections: jsonResponse(connectionsDto()),
      }),
    });

    renderProjectPage(`/w/${PROJECT_TEST_WSLUG}`, <ProjectsHubPage />);

    expect(await screen.findByText('Platform')).toBeInTheDocument();

    // The provider logo resolves to a real icon, not the neutral fallback
    // (componentLine is the only icon with a 25x24 viewBox).
    await waitFor(() => {
      const card = screen.getByText('Platform').closest('li');
      expect(card?.querySelector('[data-slot="skeleton"]')).toBeNull();
      expect(card?.querySelector('svg')).toBeInTheDocument();
      expect(card?.querySelector('svg[viewBox="0 0 25 24"]')).toBeNull();
    });

    // "active" is the expected state, so it stays unbadged; the raw repository
    // id is dropped because it is meaningless to end users.
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
    expect(screen.queryByText('Disabled')).not.toBeInTheDocument();
    expect(screen.queryByText('Error')).not.toBeInTheDocument();
    expect(screen.queryByText('github:octo/platform')).not.toBeInTheDocument();
  });

  test.each([
    ['error', 'Error'],
    ['disabled', 'Disabled'],
  ] as const)('flags a %s source with the matching status pill', async (lifecycleStatus, label) => {
    configureApiClient({
      fetchImpl: createHubFetch({
        projects: jsonResponse({
          projects: [projectDto({id: '11111111-1111-4111-8111-111111111112', name: 'Platform'})],
          next_cursor: null,
        }),
        connections: jsonResponse(connectionsDto({lifecycleStatus})),
      }),
    });

    renderProjectPage(`/w/${PROJECT_TEST_WSLUG}`, <ProjectsHubPage />);

    expect(await screen.findByText('Platform')).toBeInTheDocument();
    expect(await screen.findByText(label)).toBeInTheDocument();
    // The aligned card carries no CTA.
    expect(screen.queryByRole('link', {name: 'Reconnect'})).not.toBeInTheDocument();
  });

  test('keeps cards usable and unflagged when the connections request fails', async () => {
    configureApiClient({
      fetchImpl: createHubFetch({
        projects: jsonResponse({
          projects: [projectDto({id: '11111111-1111-4111-8111-111111111112', name: 'Platform'})],
          next_cursor: null,
        }),
        connections: jsonResponse({code: 'server-error'}, {status: 500}),
      }),
    });

    renderProjectPage(`/w/${PROJECT_TEST_WSLUG}`, <ProjectsHubPage />);

    expect(await screen.findByText('Platform')).toBeInTheDocument();

    // The icon settles to the neutral fallback rather than spinning on the
    // loading skeleton forever when the connections fetch errors.
    await waitFor(() => {
      const card = screen.getByText('Platform').closest('li');
      expect(card?.querySelector('[data-slot="skeleton"]')).toBeNull();
      expect(card?.querySelector('svg')).toBeInTheDocument();
    });

    // A failed connections fetch is not mistaken for a disconnected source.
    expect(screen.queryByText('Disabled')).not.toBeInTheDocument();
    expect(screen.queryByText('Error')).not.toBeInTheDocument();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
  });
});

function createHubFetch({
  projects = jsonResponse({
    projects: [projectDto({id: '11111111-1111-4111-8111-111111111112', name: 'Platform'})],
    next_cursor: null,
  }),
  connections = jsonResponse(connectionsDto()),
}: {
  projects?: Response;
  connections?: Response;
} = {}) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = new URL(requestInputUrl(input));
    if (url.pathname === '/integration-connections') {
      return Promise.resolve(connections.clone());
    }
    if (url.pathname === '/projects') {
      return Promise.resolve(projects.clone());
    }
    return Promise.resolve(jsonResponse({code: 'not-found'}, {status: 404}));
  });
}

function requestInputUrl(input: RequestInfo | URL) {
  if (input instanceof Request) return input.url;
  return String(input);
}

function projectDto({
  id,
  name,
  connectionId = CONNECTION_ID,
  externalRepositoryId = 'github:octo/platform',
}: {
  id: string;
  name: string;
  connectionId?: string;
  externalRepositoryId?: string;
}) {
  return {
    id,
    workspace_id: PROJECT_TEST_WID,
    name,
    slug: name.toLowerCase(),
    source: {
      connection_id: connectionId,
      external_repository_id: externalRepositoryId,
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function connectionsDto({
  lifecycleStatus = 'active',
  id = CONNECTION_ID,
}: {
  lifecycleStatus?: 'active' | 'disabled' | 'error';
  id?: string;
} = {}) {
  return {
    connections: [
      {
        id,
        workspace_id: PROJECT_TEST_WID,
        provider: 'github',
        external_account_id: 'octo',
        slug: 'github_octo',
        display_name: 'Acme GitHub',
        lifecycle_status: lifecycleStatus,
        capabilities: ['source_control'],
        created_at: '2026-05-07T00:00:00.000Z',
        updated_at: '2026-05-07T00:00:00.000Z',
      },
    ],
  };
}
