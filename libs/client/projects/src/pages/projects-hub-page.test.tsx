import {configureApiClient} from '@shipfox/client-api';
import {fireEvent, screen, waitFor} from '@testing-library/react';
import {jsonResponse, PROJECT_TEST_WID, renderProjectPage} from '#test/pages.js';
import {ProjectsHubPage} from './projects-hub-page.js';

const NEW_PROJECT_REGEX = /New project/i;
const WORKSPACE_PROJECTS_NEW_HREF = `/workspaces/${PROJECT_TEST_WID}/projects/new`;
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';

describe('ProjectsHubPage', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  test('renders Projects H2 + New project button + empty state with create CTA', async () => {
    configureApiClient({
      fetchImpl: createHubFetch({
        projects: jsonResponse({projects: [], next_cursor: null}),
        modelProviders: jsonResponse(modelProviderConfigsDto()),
      }),
    });

    renderProjectPage(`/workspaces/${PROJECT_TEST_WID}`, <ProjectsHubPage />);

    expect(await screen.findByText('Create your first project')).toBeInTheDocument();
    // The page-level "Projects" title belongs in content because the top nav owns
    // workspace identity.
    expect(screen.getByRole('heading', {name: 'Projects'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: NEW_PROJECT_REGEX})).toHaveAttribute(
      'href',
      WORKSPACE_PROJECTS_NEW_HREF,
    );
    expect(
      (screen.getAllByRole('link', {name: 'Create project'})[0] as HTMLAnchorElement).getAttribute(
        'href',
      ),
    ).toBe(WORKSPACE_PROJECTS_NEW_HREF);
  });

  test('shows and dismisses the model provider reminder when no provider is configured', async () => {
    const fetchImpl = createHubFetch({
      projects: jsonResponse({projects: [], next_cursor: null}),
      modelProviders: jsonResponse({
        configs: [],
        default_provider_id: null,
        default_harness_id: null,
      }),
    });
    configureApiClient({fetchImpl});

    renderProjectPage(`/workspaces/${PROJECT_TEST_WID}`, <ProjectsHubPage />);

    expect(await screen.findByText('Finish setting up a model provider')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Agents'})).toHaveAttribute(
      'href',
      `/workspaces/${PROJECT_TEST_WID}/settings/agents`,
    );
    fireEvent.click(screen.getByRole('button', {name: 'Close'}));

    await waitFor(() => {
      expect(screen.queryByText('Finish setting up a model provider')).not.toBeInTheDocument();
    });
  });

  test('hides the model provider reminder when a provider is configured', async () => {
    const fetchImpl = createHubFetch({
      projects: jsonResponse({projects: [], next_cursor: null}),
      modelProviders: jsonResponse(modelProviderConfigsDto()),
    });
    configureApiClient({fetchImpl});

    renderProjectPage(`/workspaces/${PROJECT_TEST_WID}`, <ProjectsHubPage />);

    expect(await screen.findByText('Create your first project')).toBeInTheDocument();
    expect(screen.queryByText('Finish setting up a model provider')).not.toBeInTheDocument();
  });

  test('renders projects and loads the next cursor page', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(requestInputUrl(input));
      if (url.pathname.endsWith('/agent/model-providers')) {
        return Promise.resolve(jsonResponse(modelProviderConfigsDto()));
      }
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

    renderProjectPage(`/workspaces/${PROJECT_TEST_WID}`, <ProjectsHubPage />);
    expect(await screen.findByText('Platform')).toBeInTheDocument();
    const projectLink = screen.getByText('Platform').closest('a');
    // The whole card is the link, carrying the neutral focus ring (matching the
    // integration gallery cards).
    expect(projectLink).toHaveClass('focus-visible:shadow-button-neutral-focus');
    expect(projectLink?.className).not.toContain('shadow-button-secondary');

    fireEvent.click(screen.getByRole('button', {name: 'Load more'}));

    expect(await screen.findByText('API')).toBeInTheDocument();
  });

  test('renders an error alert with retry', async () => {
    configureApiClient({
      fetchImpl: createHubFetch({
        projects: jsonResponse({code: 'server-error'}, {status: 500}),
      }),
    });

    renderProjectPage(`/workspaces/${PROJECT_TEST_WID}`, <ProjectsHubPage />);

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

    renderProjectPage(`/workspaces/${PROJECT_TEST_WID}`, <ProjectsHubPage />);

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

    renderProjectPage(`/workspaces/${PROJECT_TEST_WID}`, <ProjectsHubPage />);

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

    renderProjectPage(`/workspaces/${PROJECT_TEST_WID}`, <ProjectsHubPage />);

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
  modelProviders = jsonResponse(modelProviderConfigsDto()),
}: {
  projects?: Response;
  connections?: Response;
  modelProviders?: Response;
} = {}) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = new URL(requestInputUrl(input));
    if (url.pathname.endsWith('/agent/model-providers')) {
      return Promise.resolve(modelProviders.clone());
    }
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

function modelProviderConfigsDto() {
  return {
    configs: [
      {
        kind: 'builtin',
        provider_id: 'anthropic',
        default_model: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ],
    default_provider_id: 'anthropic',
    default_harness_id: null,
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
