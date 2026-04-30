import {configureApiClient} from '@shipfox/client-api';
import {fireEvent, screen, waitFor} from '@testing-library/react';
import {jsonResponse, renderProjectPage} from '#test/pages.js';
import {CreateProjectPage} from './create-project-page.js';

const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';
const REPOSITORY_NOT_FOUND_RE = /Repository not found/;

describe('CreateProjectPage', () => {
  test('connects Debug source control and creates a project from a listed repository', async () => {
    const requestBodies: unknown[] = [];
    let connected = false;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.method !== 'GET') {
        requestBodies.push(await request.json());
      }
      if (request.url.includes('/integration-connections?')) {
        return jsonResponse({connections: connected ? [connectionDto()] : []});
      }
      if (request.url.endsWith('/integrations/debug/connections')) {
        connected = true;
        return jsonResponse(connectionDto());
      }
      if (request.url.endsWith(`/integration-connections/${CONNECTION_ID}/repositories`)) {
        return jsonResponse({repositories: [repositoryDto()], next_cursor: null});
      }
      if (request.url.endsWith('/projects')) {
        return jsonResponse(projectDto({id: '44444444-4444-4444-8444-444444444444'}));
      }
      return jsonResponse(projectDto({id: '44444444-4444-4444-8444-444444444444'}));
    });
    configureApiClient({fetchImpl});

    renderProjectPage('/projects/new', <CreateProjectPage />);
    fireEvent.click(await screen.findByRole('button', {name: 'Connect Debug'}));
    expect(await screen.findByText('debug-owner/platform')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Create project'}));

    expect(await screen.findByRole('heading', {name: 'Project Detail'})).toBeInTheDocument();
    await waitFor(() =>
      expect(requestBodies).toEqual(
        expect.arrayContaining([
          {workspace_id: '11111111-1111-4111-8111-111111111111'},
          expect.objectContaining({
            source: {
              connection_id: CONNECTION_ID,
              external_repository_id: 'platform',
            },
          }),
        ]),
      ),
    );
  });

  test('uses existing source connections and listed repositories', async () => {
    const requestBodies: unknown[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.method !== 'GET') {
        requestBodies.push(await request.json());
      }
      if (request.url.includes('/integration-connections?')) {
        return jsonResponse({connections: [connectionDto()]});
      }
      if (request.url.endsWith(`/integration-connections/${CONNECTION_ID}/repositories`)) {
        return jsonResponse({repositories: [repositoryDto()], next_cursor: null});
      }
      if (request.url.endsWith('/projects')) {
        return jsonResponse(projectDto({id: '44444444-4444-4444-8444-444444444444'}));
      }
      return jsonResponse(projectDto({id: '44444444-4444-4444-8444-444444444444'}));
    });
    configureApiClient({fetchImpl});

    renderProjectPage('/projects/new', <CreateProjectPage />);
    expect(await screen.findByText('Debug Source Control')).toBeInTheDocument();
    expect(await screen.findByText('debug-owner/platform')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Create project'}));

    await waitFor(() =>
      expect(requestBodies).toContainEqual(
        expect.objectContaining({
          name: 'Platform',
          source: {
            connection_id: CONNECTION_ID,
            external_repository_id: 'platform',
          },
        }),
      ),
    );
  });

  test('navigates to the existing project for duplicate recovery', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.includes('/integration-connections?')) {
        return Promise.resolve(jsonResponse({connections: [connectionDto()]}));
      }
      if (request.url.endsWith(`/integration-connections/${CONNECTION_ID}/repositories`)) {
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
      return Promise.resolve(projectDtoResponse('55555555-5555-4555-8555-555555555555'));
    });
    configureApiClient({fetchImpl});

    renderProjectPage('/projects/new', <CreateProjectPage />);
    expect(await screen.findByText('debug-owner/platform')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Create project'}));

    expect(await screen.findByRole('heading', {name: 'Project Detail'})).toBeInTheDocument();
  });

  test('shows provider-specific submit errors', async () => {
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      if (request.url.includes('/integration-connections?')) {
        return Promise.resolve(jsonResponse({connections: [connectionDto()]}));
      }
      if (request.url.endsWith(`/integration-connections/${CONNECTION_ID}/repositories`)) {
        return Promise.resolve(jsonResponse({repositories: [repositoryDto()], next_cursor: null}));
      }
      return Promise.resolve(jsonResponse({code: 'repository-not-found'}, {status: 422}));
    });
    configureApiClient({fetchImpl});

    renderProjectPage('/projects/new', <CreateProjectPage />);
    expect(await screen.findByText('debug-owner/platform')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Create project'}));

    expect(await screen.findByText(REPOSITORY_NOT_FOUND_RE)).toBeInTheDocument();
  });
});

function connectionDto() {
  return {
    id: CONNECTION_ID,
    workspace_id: '11111111-1111-4111-8111-111111111111',
    provider: 'debug',
    external_account_id: 'debug',
    display_name: 'Debug Source Control',
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
    owner: 'debug-owner',
    name: 'platform',
    full_name: 'debug-owner/platform',
    default_branch: 'main',
    visibility: 'private',
    clone_url: 'https://debug.local/debug-owner/platform.git',
    html_url: 'https://debug.local/debug-owner/platform',
  };
}

function projectDtoResponse(id: string) {
  return jsonResponse(projectDto({id}));
}

function projectDto({id}: {id: string}) {
  return {
    id,
    workspace_id: '11111111-1111-4111-8111-111111111111',
    name: 'Project Detail',
    source: {
      connection_id: CONNECTION_ID,
      external_repository_id: 'platform',
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
