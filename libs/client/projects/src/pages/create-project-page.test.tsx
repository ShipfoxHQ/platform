import {configureApiClient} from '@shipfox/client-api';
import {fireEvent, screen, waitFor} from '@testing-library/react';
import {jsonResponse, renderProjectPage} from '#test/pages.js';
import {CreateProjectPage} from './create-project-page.js';

const REPOSITORY_NOT_FOUND_RE = /Repository not found/;

describe('CreateProjectPage', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ENABLE_TEST_VCS_PROVIDER', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('renders unavailable page when the provider flag is off', async () => {
    vi.stubEnv('VITE_ENABLE_TEST_VCS_PROVIDER', 'false');

    renderProjectPage('/projects/new', <CreateProjectPage />);

    expect(
      await screen.findByRole('heading', {name: 'Project creation is unavailable'}),
    ).toBeInTheDocument();
  });

  test('validates local form and updates the preview', async () => {
    configureApiClient({fetchImpl: vi.fn()});

    renderProjectPage('/projects/new', <CreateProjectPage />);
    fireEvent.click(await screen.findByRole('button', {name: 'Create project'}));

    expect(await screen.findByText('Repository id is required')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Repository id'), {target: {value: 'platform-api'}});

    expect((await screen.findAllByText('Platform Api'))[0]).toBeInTheDocument();
    expect(screen.getAllByText('test-owner/platform-api')[0]).toBeInTheDocument();
  });

  test('creates a connection and project, invalidates queries, and navigates to detail', async () => {
    const requestBodies: unknown[] = [];
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(async (input: RequestInfo | URL) => {
        requestBodies.push(await (input as Request).json());

        return jsonResponse({
          id: '33333333-3333-4333-8333-333333333333',
          workspace_id: '11111111-1111-4111-8111-111111111111',
          provider: 'test',
          provider_host: 'test.local',
          external_connection_id: 'test-workspace',
          display_name: 'Test provider',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      })
      .mockImplementationOnce(async (input: RequestInfo | URL) => {
        requestBodies.push(await (input as Request).json());

        return jsonResponse(projectDto({id: '44444444-4444-4444-8444-444444444444'}));
      })
      .mockResolvedValue(jsonResponse(projectDto({id: '44444444-4444-4444-8444-444444444444'})));
    configureApiClient({fetchImpl});

    renderProjectPage('/projects/new', <CreateProjectPage />);
    fireEvent.change(await screen.findByLabelText('Repository id'), {target: {value: 'platform'}});
    fireEvent.click(screen.getByRole('button', {name: 'Create project'}));

    expect(await screen.findByRole('heading', {name: 'Project Detail'})).toBeInTheDocument();
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
    const [connectionBody, projectBody] = requestBodies as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(connectionBody.provider).toBe('test');
    expect(projectBody.external_repository_id).toBe('platform');
  });

  test('navigates to the existing project for duplicate recovery', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: '33333333-3333-4333-8333-333333333333',
          workspace_id: '11111111-1111-4111-8111-111111111111',
          provider: 'test',
          provider_host: 'test.local',
          external_connection_id: 'test-workspace',
          display_name: 'Test provider',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            code: 'project-already-exists',
            details: {existing_project_id: '55555555-5555-4555-8555-555555555555'},
          },
          {status: 409},
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(projectDto({id: '55555555-5555-4555-8555-555555555555'})),
      );
    configureApiClient({fetchImpl});

    renderProjectPage('/projects/new', <CreateProjectPage />);
    fireEvent.change(await screen.findByLabelText('Repository id'), {target: {value: 'platform'}});
    fireEvent.click(screen.getByRole('button', {name: 'Create project'}));

    expect(await screen.findByRole('heading', {name: 'Project Detail'})).toBeInTheDocument();
  });

  test('shows provider-specific submit errors', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: '33333333-3333-4333-8333-333333333333',
          workspace_id: '11111111-1111-4111-8111-111111111111',
          provider: 'test',
          provider_host: 'test.local',
          external_connection_id: 'test-workspace',
          display_name: 'Test provider',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      )
      .mockResolvedValueOnce(jsonResponse({code: 'repository-not-found'}, {status: 422}));
    configureApiClient({fetchImpl});

    renderProjectPage('/projects/new', <CreateProjectPage />);
    fireEvent.change(await screen.findByLabelText('Repository id'), {target: {value: 'missing'}});
    fireEvent.click(screen.getByRole('button', {name: 'Create project'}));

    expect(await screen.findByText(REPOSITORY_NOT_FOUND_RE)).toBeInTheDocument();
  });
});

function projectDto({id}: {id: string}) {
  return {
    id,
    workspace_id: '11111111-1111-4111-8111-111111111111',
    repository_id: '66666666-6666-4666-8666-666666666666',
    name: 'Project Detail',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    repository: {
      id: '66666666-6666-4666-8666-666666666666',
      vcs_connection_id: '33333333-3333-4333-8333-333333333333',
      provider: 'test',
      provider_host: 'test.local',
      external_repository_id: 'platform',
      owner: 'test-owner',
      name: 'platform',
      full_name: 'test-owner/platform',
      default_branch: 'main',
      visibility: 'private',
      clone_url: 'https://test.local/test-owner/platform.git',
      html_url: 'https://test.local/test-owner/platform',
      metadata_fetched_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}
