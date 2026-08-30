import {configureApiClient} from '@shipfox/client-api';
import {fireEvent, screen, waitFor} from '@testing-library/react';
import {AuthGuard, WorkspaceGuard} from '#components/auth-guard.js';
import {pageUserFactory} from '#test/factories/user.js';
import {renderAuthPage} from '#test/pages.js';
import {jsonResponse, requestUrl} from '#test/utils.js';

type WorkspaceCreationState = {didCreate: boolean; body: unknown};

function workspaceCreationFetch(
  user: ReturnType<typeof pageUserFactory.build>,
  state: WorkspaceCreationState,
) {
  return vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const url = requestUrl(input);
    const method = input instanceof Request ? input.method : 'GET';
    if (url.endsWith('/auth/refresh')) return workspaceRefreshResponse(user, state.didCreate);
    if (url.endsWith('/workspaces') && method === 'GET') {
      return workspaceMembershipsResponse(user, state.didCreate);
    }
    if (url.endsWith('/workspaces') && method === 'POST') {
      state.didCreate = true;
      state.body = input instanceof Request ? await input.json() : undefined;
      return createdWorkspaceResponse();
    }
    return jsonResponse({code: 'not-found', message: 'Not found'}, {status: 404});
  });
}

function workspaceRefreshResponse(
  user: ReturnType<typeof pageUserFactory.build>,
  didCreate: boolean,
) {
  return jsonResponse({token: didCreate ? 'workspace-access-token' : 'access-token', user});
}

function workspaceMembershipsResponse(
  user: ReturnType<typeof pageUserFactory.build>,
  didCreate: boolean,
) {
  if (!didCreate) return jsonResponse({memberships: []});
  return jsonResponse({
    memberships: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        user_id: user.id,
        workspace_id: '33333333-3333-4333-8333-333333333333',
        workspace_name: 'Acme',
        workspace_slug: 'acme',
        created_at: '2026-04-27T00:00:00.000Z',
        updated_at: '2026-04-27T00:00:00.000Z',
      },
    ],
  });
}

function createdWorkspaceResponse() {
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
    const state: WorkspaceCreationState = {didCreate: false, body: undefined};
    const fetchImpl = workspaceCreationFetch(user, state);
    configureApiClient({fetchImpl});

    const {container} = renderAuthPage(
      '/',
      <AuthGuard>
        <WorkspaceGuard>
          <h1>Authenticated home</h1>
        </WorkspaceGuard>
      </AuthGuard>,
    );
    const workspaceName = await screen.findByLabelText('Workspace name');
    expect(container.querySelector('[data-slot="panel-header"]')).toHaveAttribute(
      'data-variant',
      'plain',
    );
    expect(container.querySelector('[data-slot="panel-body"]')).toBeInTheDocument();
    fireEvent.change(workspaceName, {
      target: {value: '  Acme  '},
    });
    fireEvent.click(screen.getByRole('button', {name: 'Create workspace'}));

    await waitFor(() => expect(state.didCreate).toBe(true));
    expect(state.body).toEqual({name: 'Acme', slug: 'acme'});
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
    await waitFor(() => {
      expect(slug).toHaveValue('acme-labs');
      expect(screen.getByText(`${window.location.origin}/w/acme-labs`)).toBeInTheDocument();
    });

    fireEvent.change(slug, {target: {value: 'custom-workspace'}});
    fireEvent.change(name, {target: {value: 'Renamed Labs'}});
    await waitFor(() => {
      expect(slug).toHaveValue('custom-workspace');
      expect(screen.getByText(`${window.location.origin}/w/custom-workspace`)).toBeInTheDocument();
    });
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
