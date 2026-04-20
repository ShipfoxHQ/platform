import {configureApiClient} from '@shipfox/client-api';
import {fireEvent, screen} from '@testing-library/react';
import {jsonResponse, renderProjectPage} from '#test/pages.js';
import {ProjectsHubPage} from './projects-hub-page.js';

describe('ProjectsHubPage', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ENABLE_TEST_VCS_PROVIDER', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('renders empty state with create CTA', async () => {
    configureApiClient({
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({projects: [], next_cursor: null})),
    });

    renderProjectPage('/', <ProjectsHubPage />);

    expect(await screen.findByRole('heading', {name: 'Projects'})).toBeInTheDocument();
    expect(await screen.findByText('Create your first project')).toBeInTheDocument();
    expect(screen.getAllByRole('link', {name: 'Create project'})[0]).toHaveAttribute(
      'href',
      '/projects/new',
    );
  });

  test('renders projects and loads the next cursor page', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          projects: [projectDto({id: 'project-1', name: 'Platform'})],
          next_cursor: 'cursor-1',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          projects: [projectDto({id: 'project-2', name: 'API'})],
          next_cursor: null,
        }),
      );
    configureApiClient({fetchImpl});

    renderProjectPage('/', <ProjectsHubPage />);
    expect(await screen.findByText('Platform')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Load more'}));

    expect(await screen.findByText('API')).toBeInTheDocument();
    const secondRequest = fetchImpl.mock.calls[1]?.[0] as Request;
    expect(secondRequest.url).toContain('cursor=cursor-1');
  });

  test('shows disabled production CTA when the UI flag is off', async () => {
    vi.stubEnv('VITE_ENABLE_TEST_VCS_PROVIDER', 'false');
    configureApiClient({
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({projects: [], next_cursor: null})),
    });

    renderProjectPage('/', <ProjectsHubPage />);

    expect(
      await screen.findByText('Project creation is disabled in this environment.'),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', {name: 'Create project'})[0]).toBeDisabled();
  });

  test('renders an error alert with retry', async () => {
    configureApiClient({
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({code: 'server-error'}, {status: 500})),
    });

    renderProjectPage('/', <ProjectsHubPage />);

    expect(await screen.findByText('Project request failed')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Retry'})).toBeInTheDocument();
  });
});

function projectDto({id, name}: {id: string; name: string}) {
  return {
    id,
    workspace_id: '11111111-1111-4111-8111-111111111111',
    repository_id: `${id}-repo`,
    name,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    repository: {
      id: `${id}-repo`,
      vcs_connection_id: '33333333-3333-4333-8333-333333333333',
      provider: 'test',
      provider_host: 'test.local',
      external_repository_id: name.toLowerCase(),
      owner: 'test-owner',
      name: name.toLowerCase(),
      full_name: `test-owner/${name.toLowerCase()}`,
      default_branch: 'main',
      visibility: 'private',
      clone_url: `https://test.local/test-owner/${name.toLowerCase()}.git`,
      html_url: `https://test.local/test-owner/${name.toLowerCase()}`,
      metadata_fetched_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}
