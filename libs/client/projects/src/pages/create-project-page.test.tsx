import {configureApiClient} from '@shipfox/client-api';
import {fireEvent, screen, waitFor} from '@testing-library/react';
import {
  jsonResponse,
  PROJECT_TEST_WID,
  PROJECT_TEST_WSLUG,
  renderProjectPage,
} from '#test/pages.js';
import {CreateProjectPage} from './create-project-page.js';

const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';
const SECOND_CONNECTION_ID = '66666666-6666-4666-8666-666666666666';
const REPOSITORY_NOT_FOUND_RE = /Repository not found/;
const PROJECT_REQUEST_FAILED_RE = /Project request failed/;
const GITEA_RADIO_LABEL_RE = /^Gitea Source$/;

describe('CreateProjectPage', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  test('with a single connection: pre-selects, renders repos, creates a project', async () => {
    let createProjectBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.includes('/integration-connections?')) {
        return jsonResponse({connections: [connectionDto()]});
      }
      if (request.url.includes(`/integration-connections/${CONNECTION_ID}/repositories`)) {
        return jsonResponse({repositories: [repositoryDto()], next_cursor: null});
      }
      if (request.url.endsWith('/projects') && request.method === 'POST') {
        createProjectBody = await request.json();
        return jsonResponse(projectDto({id: '44444444-4444-4444-8444-444444444444'}));
      }
      return jsonResponse(projectDto({id: '44444444-4444-4444-8444-444444444444'}));
    });
    configureApiClient({fetchImpl});

    renderProjectPage(`/w/${PROJECT_TEST_WSLUG}/projects/new`, <CreateProjectPage />);
    const nameInput = await screen.findByLabelText('Project name');
    const slugInput = await screen.findByLabelText('Project slug');
    await waitFor(() => expect(nameInput).toHaveValue('Platform'));
    expect(slugInput).toHaveValue('platform');
    expect(slugInput).toHaveAttribute('aria-describedby', 'project-slug-description');
    expect(screen.getByText('/w/acme/p/platform')).toBeInTheDocument();
    expect(screen.getByRole('radio', {name: GITEA_RADIO_LABEL_RE})).toBeChecked();
    expect(screen.getAllByText('gitea-owner/platform').length).toBeGreaterThan(0);
    fireEvent.change(nameInput, {
      target: {value: '  Launch Pad  '},
    });
    fireEvent.change(slugInput, {
      target: {value: 'launchpad'},
    });
    expect(screen.getByText('/w/acme/p/launchpad')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Create project'}));

    expect(await screen.findByRole('heading', {name: 'Runs'})).toBeInTheDocument();
    expect(createProjectBody).toEqual({
      workspace_id: PROJECT_TEST_WID,
      name: 'Launch Pad',
      slug: 'launchpad',
      source: {
        connection_id: CONNECTION_ID,
        external_repository_id: 'platform',
      },
    });
  }, 10_000);

  test('auto-derives the slug from each keystroke in the name field until the slug is touched', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.includes('/integration-connections?')) {
        return Promise.resolve(jsonResponse({connections: [connectionDto()]}));
      }
      if (request.url.includes(`/integration-connections/${CONNECTION_ID}/repositories`)) {
        return Promise.resolve(jsonResponse({repositories: [repositoryDto()], next_cursor: null}));
      }
      return Promise.resolve(jsonResponse({}));
    });
    configureApiClient({fetchImpl});

    renderProjectPage(`/w/${PROJECT_TEST_WSLUG}/projects/new`, <CreateProjectPage />);
    const nameInput = await screen.findByLabelText('Project name');
    const slugInput = await screen.findByLabelText('Project slug');
    await waitFor(() => expect(nameInput).toHaveValue('Platform'));

    fireEvent.change(nameInput, {target: {value: 'L'}});
    fireEvent.change(nameInput, {target: {value: 'La'}});
    fireEvent.change(nameInput, {target: {value: 'Launch Pad'}});

    expect(slugInput).toHaveValue('launch-pad');
    expect(screen.getByText('/w/acme/p/launch-pad')).toBeInTheDocument();
  });

  test('checks project slug availability from memory without an availability request', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.includes('/integration-connections?')) {
        return Promise.resolve(jsonResponse({connections: [connectionDto()]}));
      }
      if (request.url.includes(`/integration-connections/${CONNECTION_ID}/repositories`)) {
        return Promise.resolve(jsonResponse({repositories: [repositoryDto()], next_cursor: null}));
      }
      return Promise.resolve(jsonResponse({}));
    });
    configureApiClient({fetchImpl});

    renderProjectPage(`/w/${PROJECT_TEST_WSLUG}/projects/new`, <CreateProjectPage />);
    const slugInput = await screen.findByLabelText('Project slug');
    fireEvent.change(slugInput, {target: {value: 'custom-project'}});

    expect(await screen.findByText('Slug is available.')).toBeInTheDocument();
    expect(
      fetchImpl.mock.calls.some(([input]) =>
        (input as Request).url.includes('/projects/slug-availability'),
      ),
    ).toBe(false);
  });

  test('uses the current repository-derived name when submitted before touching the field', async () => {
    let createProjectBody: unknown;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.includes('/integration-connections?')) {
        return jsonResponse({connections: [connectionDto()]});
      }
      if (request.url.includes(`/integration-connections/${CONNECTION_ID}/repositories`)) {
        return jsonResponse({repositories: [repositoryDto()], next_cursor: null});
      }
      if (request.url.endsWith('/projects') && request.method === 'POST') {
        createProjectBody = await request.json();
        return jsonResponse(projectDto({id: '44444444-4444-4444-8444-444444444444'}));
      }
      return jsonResponse(projectDto({id: '44444444-4444-4444-8444-444444444444'}));
    });
    configureApiClient({fetchImpl});

    renderProjectPage(`/w/${PROJECT_TEST_WSLUG}/projects/new`, <CreateProjectPage />);
    expect((await screen.findAllByText('gitea-owner/platform')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', {name: 'Create project'}));

    expect(await screen.findByRole('heading', {name: 'Runs'})).toBeInTheDocument();
    expect(createProjectBody).toEqual({
      workspace_id: PROJECT_TEST_WID,
      name: 'Platform',
      slug: 'platform',
      source: {
        connection_id: CONNECTION_ID,
        external_repository_id: 'platform',
      },
    });
  });

  test('with multiple connections: hides repo picker until a connection is selected', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.includes('/integration-connections?')) {
        return Promise.resolve(
          jsonResponse({connections: [connectionDto(), secondConnectionDto()]}),
        );
      }
      if (request.url.includes(`/integration-connections/${CONNECTION_ID}/repositories`)) {
        return Promise.resolve(jsonResponse({repositories: [repositoryDto()], next_cursor: null}));
      }
      return Promise.resolve(jsonResponse({}));
    });
    configureApiClient({fetchImpl});

    renderProjectPage(`/w/${PROJECT_TEST_WSLUG}/projects/new`, <CreateProjectPage />);
    expect((await screen.findAllByText('Gitea Source')).length).toBeGreaterThan(0);
    expect(await screen.findByText('Other Gitea Source')).toBeInTheDocument();
    expect(screen.queryByText('gitea-owner/platform')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', {name: GITEA_RADIO_LABEL_RE}));

    expect((await screen.findAllByText('gitea-owner/platform')).length).toBeGreaterThan(0);
  });

  test('rejects invalid custom project names locally', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.includes('/integration-connections?')) {
        return Promise.resolve(jsonResponse({connections: [connectionDto()]}));
      }
      if (request.url.includes(`/integration-connections/${CONNECTION_ID}/repositories`)) {
        return Promise.resolve(jsonResponse({repositories: [repositoryDto()], next_cursor: null}));
      }
      return Promise.resolve(jsonResponse({}));
    });
    configureApiClient({fetchImpl});

    renderProjectPage(`/w/${PROJECT_TEST_WSLUG}/projects/new`, <CreateProjectPage />);
    expect((await screen.findAllByText('gitea-owner/platform')).length).toBeGreaterThan(0);
    fireEvent.change(await screen.findByLabelText('Project name'), {
      target: {value: 'Bad\u202eName'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'Create project'}));

    expect(
      await screen.findByText(
        'Project name cannot include line breaks, tabs, or hidden formatting characters.',
      ),
    ).toBeInTheDocument();
    expect(projectPostCount(fetchImpl)).toBe(0);
  });

  test('with a single connection: shows workspace-scoped "Add another integration" link', async () => {
    configureApiClient({
      fetchImpl: vi.fn((input: RequestInfo | URL) => {
        const request = input as Request;
        if (request.url.includes('/integration-connections?')) {
          return Promise.resolve(jsonResponse({connections: [connectionDto()]}));
        }
        if (request.url.includes(`/integration-connections/${CONNECTION_ID}/repositories`)) {
          return Promise.resolve(
            jsonResponse({repositories: [repositoryDto()], next_cursor: null}),
          );
        }
        return Promise.resolve(jsonResponse({}));
      }),
    });

    renderProjectPage(`/w/${PROJECT_TEST_WSLUG}/projects/new`, <CreateProjectPage />);
    const link = await screen.findByRole('link', {name: 'Add another integration'});
    expect(link).toHaveAttribute('href', `/w/${PROJECT_TEST_WSLUG}/integrations`);
  });

  test('shows the model provider reminder on project creation when no provider is configured', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.endsWith('/agent/model-providers')) {
        return Promise.resolve(
          jsonResponse({configs: [], default_provider_id: null, default_harness_id: null}),
        );
      }
      if (request.url.includes('/integration-connections?')) {
        return Promise.resolve(jsonResponse({connections: [connectionDto()]}));
      }
      if (request.url.includes(`/integration-connections/${CONNECTION_ID}/repositories`)) {
        return Promise.resolve(jsonResponse({repositories: [repositoryDto()], next_cursor: null}));
      }
      return Promise.resolve(jsonResponse({}));
    });
    configureApiClient({fetchImpl});

    renderProjectPage(`/w/${PROJECT_TEST_WSLUG}/projects/new`, <CreateProjectPage />);

    expect(await screen.findByText('Finish setting up a model provider')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Agents'})).toHaveAttribute(
      'href',
      `/w/${PROJECT_TEST_WSLUG}/settings/agents`,
    );
  });

  test('navigates to the existing project for duplicate recovery', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.includes('/integration-connections?')) {
        return Promise.resolve(jsonResponse({connections: [connectionDto()]}));
      }
      if (request.url.includes(`/integration-connections/${CONNECTION_ID}/repositories`)) {
        return Promise.resolve(jsonResponse({repositories: [repositoryDto()], next_cursor: null}));
      }
      if (request.url.endsWith('/projects')) {
        return Promise.resolve(
          jsonResponse(
            {
              code: 'project-already-exists',
              details: {existing_project_id: '55555555-5555-4555-8555-555555555555'},
            },
            {status: 409},
          ),
        );
      }
      if (request.url.includes('/projects?')) {
        return Promise.resolve(
          jsonResponse({
            projects: [projectDto({id: '55555555-5555-4555-8555-555555555555'})],
            next_cursor: null,
          }),
        );
      }
      if (request.url.includes('/definitions?')) {
        return Promise.resolve(jsonResponse({definitions: [], next_cursor: null, sync: null}));
      }
      return Promise.resolve(
        jsonResponse(projectDto({id: '55555555-5555-4555-8555-555555555555'})),
      );
    });
    configureApiClient({fetchImpl});

    renderProjectPage(`/w/${PROJECT_TEST_WSLUG}/projects/new`, <CreateProjectPage />);
    expect((await screen.findAllByText('gitea-owner/platform')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', {name: 'Create project'}));

    // After duplicate recovery, navigation lands on the workspace-scoped project
    // URL. Production redirects that URL to the Runs tab.
    expect(await screen.findByRole('heading', {name: 'Runs'})).toBeInTheDocument();
  });

  test('surfaces a slug conflict on the slug field without a generic form error', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.includes('/integration-connections?')) {
        return Promise.resolve(jsonResponse({connections: [connectionDto()]}));
      }
      if (request.url.includes(`/integration-connections/${CONNECTION_ID}/repositories`)) {
        return Promise.resolve(jsonResponse({repositories: [repositoryDto()], next_cursor: null}));
      }
      if (request.url.endsWith('/projects') && request.method === 'POST') {
        return Promise.resolve(jsonResponse({code: 'slug-conflict'}, {status: 409}));
      }
      return Promise.resolve(jsonResponse({}));
    });
    configureApiClient({fetchImpl});

    renderProjectPage(`/w/${PROJECT_TEST_WSLUG}/projects/new`, <CreateProjectPage />);
    expect((await screen.findAllByText('gitea-owner/platform')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', {name: 'Create project'}));

    expect(await screen.findByText('This project slug is already in use.')).toBeInTheDocument();
    expect(screen.getByLabelText('Project slug')).toHaveAttribute(
      'aria-describedby',
      'project-slug-error',
    );
    await waitFor(() => expect(screen.getByLabelText('Project slug')).toHaveFocus());
    expect(screen.queryByText(PROJECT_REQUEST_FAILED_RE)).not.toBeInTheDocument();
  });

  test('clears a slug conflict when the slug is regenerated from the project name', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.includes('/integration-connections?')) {
        return Promise.resolve(jsonResponse({connections: [connectionDto()]}));
      }
      if (request.url.includes(`/integration-connections/${CONNECTION_ID}/repositories`)) {
        return Promise.resolve(jsonResponse({repositories: [repositoryDto()], next_cursor: null}));
      }
      if (request.url.endsWith('/projects') && request.method === 'POST') {
        return Promise.resolve(jsonResponse({code: 'slug-conflict'}, {status: 409}));
      }
      return Promise.resolve(jsonResponse({}));
    });
    configureApiClient({fetchImpl});

    renderProjectPage(`/w/${PROJECT_TEST_WSLUG}/projects/new`, <CreateProjectPage />);
    expect((await screen.findAllByText('gitea-owner/platform')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', {name: 'Create project'}));

    expect(await screen.findByText('This project slug is already in use.')).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText('Project name'), {
      target: {value: 'Launch Pad'},
    });

    await waitFor(() => {
      expect(screen.queryByText('This project slug is already in use.')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Project slug')).toHaveValue('launch-pad');
    });
  });

  test('shows provider-specific submit errors', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.includes('/integration-connections?')) {
        return Promise.resolve(jsonResponse({connections: [connectionDto()]}));
      }
      if (request.url.includes(`/integration-connections/${CONNECTION_ID}/repositories`)) {
        return Promise.resolve(jsonResponse({repositories: [repositoryDto()], next_cursor: null}));
      }
      return Promise.resolve(jsonResponse({code: 'repository-not-found'}, {status: 422}));
    });
    configureApiClient({fetchImpl});

    renderProjectPage(`/w/${PROJECT_TEST_WSLUG}/projects/new`, <CreateProjectPage />);
    expect((await screen.findAllByText('gitea-owner/platform')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', {name: 'Create project'}));

    expect(await screen.findByText(REPOSITORY_NOT_FOUND_RE)).toBeInTheDocument();
  });
});

function connectionDto() {
  return {
    id: CONNECTION_ID,
    workspace_id: '11111111-1111-4111-8111-111111111111',
    provider: 'gitea',
    external_account_id: 'gitea-owner',
    slug: 'gitea_owner',
    display_name: 'Gitea Source',
    lifecycle_status: 'active',
    capabilities: ['source_control'],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function secondConnectionDto() {
  return {
    id: SECOND_CONNECTION_ID,
    workspace_id: '11111111-1111-4111-8111-111111111111',
    provider: 'gitea',
    external_account_id: 'gitea-owner-2',
    slug: 'gitea_owner_2',
    display_name: 'Other Gitea Source',
    lifecycle_status: 'active',
    capabilities: ['source_control'],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function repositoryDto() {
  return {
    connection_id: CONNECTION_ID,
    external_repository_id: 'platform',
    owner: 'gitea-owner',
    name: 'platform',
    full_name: 'gitea-owner/platform',
    default_branch: 'main',
    visibility: 'private',
    clone_url: 'https://gitea.local/gitea-owner/platform.git',
    html_url: 'https://gitea.local/gitea-owner/platform',
  };
}

function projectDto({id}: {id: string}) {
  return {
    id,
    workspace_id: '11111111-1111-4111-8111-111111111111',
    name: 'Project Detail',
    slug: 'project-detail',
    source: {
      connection_id: CONNECTION_ID,
      external_repository_id: 'platform',
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function projectPostCount(fetchImpl: ReturnType<typeof vi.fn>): number {
  return fetchImpl.mock.calls.filter(([input]) => {
    const request = input as Request;
    return request.url.endsWith('/projects') && request.method === 'POST';
  }).length;
}
