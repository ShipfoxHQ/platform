import {configureApiClient} from '@shipfox/client-api';
import {fireEvent, screen, waitFor} from '@testing-library/react';
import {AuthGuard, WorkspaceGuard} from '#components/auth-guard.js';
import {pageUserFactory} from '#test/factories/user.js';
import {renderAuthPage} from '#test/pages.js';
import {jsonResponse, requestUrl} from '#test/utils.js';

describe('WorkspaceOnboardingPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    configureApiClient({baseUrl: 'https://api.example.test', getAccessToken: undefined});
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  test('creates a workspace before showing the signed-in app', async () => {
    const user = pageUserFactory.build({email: 'workspace@example.com'});
    let didCreateWorkspace = false;
    let createWorkspaceBody: unknown;
    const fetchImpl = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      const method = input instanceof Request ? input.method : 'GET';
      if (url.endsWith('/auth/refresh')) {
        return jsonResponse({
          token: didCreateWorkspace ? 'workspace-access-token' : 'access-token',
          user,
        });
      }
      if (url.endsWith('/workspaces') && method === 'GET') {
        return jsonResponse({
          memberships: didCreateWorkspace
            ? [
                {
                  id: '22222222-2222-4222-8222-222222222222',
                  user_id: user.id,
                  workspace_id: '33333333-3333-4333-8333-333333333333',
                  workspace_name: 'Acme',
                  workspace_slug: 'acme',
                  created_at: '2026-04-27T00:00:00.000Z',
                  updated_at: '2026-04-27T00:00:00.000Z',
                },
              ]
            : [],
        });
      }
      if (url.endsWith('/workspaces') && method === 'POST') {
        didCreateWorkspace = true;
        createWorkspaceBody = input instanceof Request ? await input.json() : undefined;
        return jsonResponse(
          {
            id: '33333333-3333-4333-8333-333333333333',
            name: 'Acme',
            slug: 'acme',
            status: 'active',
            settings: {},
            created_at: '2026-04-27T00:00:00.000Z',
            updated_at: '2026-04-27T00:00:00.000Z',
          },
          {status: 201},
        );
      }

      return jsonResponse({code: 'not-found', message: 'Not found'}, {status: 404});
    });
    configureApiClient({fetchImpl});

    renderAuthPage(
      '/',
      <AuthGuard>
        <WorkspaceGuard>
          <h1>Authenticated home</h1>
        </WorkspaceGuard>
      </AuthGuard>,
    );
    fireEvent.change(await screen.findByLabelText('Workspace name'), {
      target: {value: '  Acme  '},
    });
    fireEvent.click(screen.getByRole('button', {name: 'Create workspace'}));

    await waitFor(() => expect(didCreateWorkspace).toBe(true));
    expect(createWorkspaceBody).toEqual({name: 'Acme', slug: 'acme'});
  });

  test('prefills the slug from the name until the slug is edited', async () => {
    const user = pageUserFactory.build({email: 'workspace-slug@example.com'});
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/refresh')) {
        return Promise.resolve(jsonResponse({token: 'access-token', user}));
      }
      if (url.endsWith('/workspaces')) {
        return Promise.resolve(jsonResponse({memberships: []}));
      }
      return Promise.resolve(
        jsonResponse({code: 'not-found', message: 'Not found'}, {status: 404}),
      );
    });
    configureApiClient({fetchImpl});

    renderAuthPage(
      '/',
      <AuthGuard>
        <WorkspaceGuard>
          <h1>Authenticated home</h1>
        </WorkspaceGuard>
      </AuthGuard>,
    );
    const name = await screen.findByLabelText('Workspace name');
    const slug = screen.getByLabelText('Workspace slug');
    expect(screen.getByText(`${window.location.origin}/w/acme`)).toBeInTheDocument();
    fireEvent.change(name, {target: {value: 'Acme Labs'}});
    expect(slug).toHaveValue('acme-labs');
    expect(screen.getByText(`${window.location.origin}/w/acme-labs`)).toBeInTheDocument();

    fireEvent.change(slug, {target: {value: 'custom-workspace'}});
    fireEvent.change(name, {target: {value: 'Renamed Labs'}});
    expect(slug).toHaveValue('custom-workspace');
    expect(screen.getByText(`${window.location.origin}/w/custom-workspace`)).toBeInTheDocument();
  });

  test('checks a manually edited workspace slug for availability', async () => {
    const user = pageUserFactory.build({email: 'workspace-availability@example.com'});
    const availabilityRequests: string[] = [];
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const request = input as Request;
      const url = request.url;
      if (url.includes('/auth/refresh')) {
        return Promise.resolve(jsonResponse({token: 'access-token', user}));
      }
      if (url.includes('/workspaces/slug-availability')) {
        availabilityRequests.push(url);
        return Promise.resolve(jsonResponse({available: true}));
      }
      if (url.endsWith('/workspaces')) {
        return Promise.resolve(jsonResponse({memberships: []}));
      }
      return Promise.resolve(
        jsonResponse({code: 'not-found', message: 'Not found'}, {status: 404}),
      );
    });
    configureApiClient({fetchImpl});

    renderAuthPage(
      '/',
      <AuthGuard>
        <WorkspaceGuard>
          <h1>Authenticated home</h1>
        </WorkspaceGuard>
      </AuthGuard>,
    );
    fireEvent.change(await screen.findByLabelText('Workspace slug'), {
      target: {value: 'custom-workspace'},
    });

    await waitFor(() => expect(availabilityRequests).toHaveLength(1));
    expect(new URL(availabilityRequests[0] ?? '').searchParams.get('slug')).toBe(
      'custom-workspace',
    );
    expect(await screen.findByText('Slug is available.')).toBeInTheDocument();
  });

  test('shows a duplicate slug error on the slug field', async () => {
    const user = pageUserFactory.build({email: 'workspace-conflict@example.com'});
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      const method = input instanceof Request ? input.method : 'GET';
      if (url.endsWith('/auth/refresh')) {
        return Promise.resolve(jsonResponse({token: 'access-token', user}));
      }
      if (url.endsWith('/workspaces') && method === 'GET') {
        return Promise.resolve(jsonResponse({memberships: []}));
      }
      if (url.endsWith('/workspaces') && method === 'POST') {
        return Promise.resolve(
          jsonResponse(
            {code: 'slug-conflict', message: 'Workspace slug is already taken'},
            {status: 409},
          ),
        );
      }
      return Promise.resolve(
        jsonResponse({code: 'not-found', message: 'Not found'}, {status: 404}),
      );
    });
    configureApiClient({fetchImpl});

    renderAuthPage(
      '/',
      <AuthGuard>
        <WorkspaceGuard>
          <h1>Authenticated home</h1>
        </WorkspaceGuard>
      </AuthGuard>,
    );
    fireEvent.change(await screen.findByLabelText('Workspace name'), {
      target: {value: 'Acme'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'Create workspace'}));

    expect(await screen.findByText('That workspace slug is already taken.')).toBeInTheDocument();
    expect(screen.getByLabelText('Workspace slug')).toBeInvalid();
  });

  test('requires the workspace name locally', async () => {
    const user = pageUserFactory.build({email: 'workspace@example.com'});
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/refresh')) {
        return Promise.resolve(jsonResponse({token: 'access-token', user}));
      }
      if (url.endsWith('/workspaces')) {
        return Promise.resolve(jsonResponse({memberships: []}));
      }

      return Promise.resolve(
        jsonResponse({code: 'not-found', message: 'Not found'}, {status: 404}),
      );
    });
    configureApiClient({fetchImpl});

    renderAuthPage(
      '/',
      <AuthGuard>
        <WorkspaceGuard>
          <h1>Authenticated home</h1>
        </WorkspaceGuard>
      </AuthGuard>,
    );
    fireEvent.click(await screen.findByRole('button', {name: 'Create workspace'}));

    expect(await screen.findByText('Workspace name is required.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Workspace name')).toBeInvalid());
    expect(workspacePostCount(fetchImpl)).toBe(0);
  });

  test('rejects control characters in the workspace name locally', async () => {
    const user = pageUserFactory.build({email: 'workspace@example.com'});
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/refresh')) {
        return Promise.resolve(jsonResponse({token: 'access-token', user}));
      }
      if (url.endsWith('/workspaces')) {
        return Promise.resolve(jsonResponse({memberships: []}));
      }

      return Promise.resolve(
        jsonResponse({code: 'not-found', message: 'Not found'}, {status: 404}),
      );
    });
    configureApiClient({fetchImpl});

    renderAuthPage(
      '/',
      <AuthGuard>
        <WorkspaceGuard>
          <h1>Authenticated home</h1>
        </WorkspaceGuard>
      </AuthGuard>,
    );
    fireEvent.change(await screen.findByLabelText('Workspace name'), {
      target: {value: 'Acme\u202eLabs'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'Create workspace'}));

    expect(
      await screen.findByText(
        'Workspace name cannot include line breaks, tabs, or hidden formatting characters.',
      ),
    ).toBeInTheDocument();
    expect(workspacePostCount(fetchImpl)).toBe(0);
  });
});

function workspacePostCount(fetchImpl: ReturnType<typeof vi.fn>): number {
  return fetchImpl.mock.calls.filter(([input]) => {
    const url = requestUrl(input as RequestInfo | URL);
    const method = input instanceof Request ? input.method : 'GET';
    return url.endsWith('/workspaces') && method === 'POST';
  }).length;
}
