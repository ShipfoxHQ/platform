// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type {IntegrationConnectionDto} from '@shipfox/api-integration-core-dto';
import {configureApiClient} from '@shipfox/client-api';
import {fireEvent, screen} from '@testing-library/react';
import {INTEGRATIONS_TEST_WID, jsonResponse, renderIntegrationsPage} from '#test/render.js';
import {ConnectionDetailsPage} from './connection-details-page.js';

const CONNECTION_ID = '44444444-4444-4444-8444-444444444444';
const PROJECT_ID = '55555555-5555-4555-8555-555555555555';
const GRANT_ID = '66666666-6666-4666-8666-666666666666';
const REPOSITORY_ACCESS_PATH = `/integration-connections/${CONNECTION_ID}/repository-access`;
const SELECTED_MODE_RE = /Selected direct targets/u;
const ALL_MODE_RE = /All installation repositories/u;
const GITHUB_EFFECTS_RE = /Some ID-based, organization-scoped, and indirect GitHub effects remain/u;
const ALL_MODE_COPY_RE = /Shipfox performs no repository allowlist check/u;

const githubConnection = {
  id: CONNECTION_ID,
  workspace_id: INTEGRATIONS_TEST_WID,
  provider: 'github',
  external_account_id: 'installation-1',
  slug: 'github_acme_corp',
  display_name: 'acme-corp',
  lifecycle_status: 'active',
  capabilities: ['source_control'],
  external_url: 'https://github.com/organizations/acme-corp/settings/installations/1',
  created_at: '2026-03-12T00:00:00.000Z',
  updated_at: '2026-03-12T00:00:00.000Z',
} satisfies IntegrationConnectionDto;

type RepositoryAccessResponse = {
  mode: 'selected' | 'all';
  repositories: Array<{
    external_repository_id: string;
    owner: string;
    name: string;
    origins: Array<
      | {type: 'project'; project_id: string; project_name: string}
      | {type: 'manual'; grant_id: string}
    >;
  }>;
  next_cursor: string | null;
};

const selectedAccess: RepositoryAccessResponse = {
  mode: 'selected',
  repositories: [
    {
      external_repository_id: 'acme/platform',
      owner: 'acme',
      name: 'platform',
      origins: [
        {type: 'project', project_id: PROJECT_ID, project_name: 'Platform'},
        {type: 'manual', grant_id: GRANT_ID},
      ],
    },
  ],
  next_cursor: null,
};

const allAccess: RepositoryAccessResponse = {
  mode: 'all',
  repositories: [],
  next_cursor: null,
};

interface DetailsFetchOptions {
  access?: RepositoryAccessResponse;
  nextPageAccess?: RepositoryAccessResponse;
  accessError?: {status: number; code: string};
  mutationResponse?: () => Response | Promise<Response>;
  onUpdateMode?: (mode: 'selected' | 'all') => void;
}

function detailsFetch({
  access = selectedAccess,
  nextPageAccess,
  accessError,
  mutationResponse,
  onUpdateMode,
}: DetailsFetchOptions = {}) {
  let currentAccess = access;
  let accessAttempts = 0;

  function repositoryAccessGetResponse(request: Request): Response {
    if (accessError && accessAttempts++ === 0) {
      return jsonResponse(
        {code: accessError.code, message: 'Repository access unavailable'},
        {
          status: accessError.status,
        },
      );
    }
    const cursor = new URL(request.url).searchParams.get('cursor');
    return jsonResponse(cursor && nextPageAccess ? nextPageAccess : currentAccess);
  }

  async function repositoryAccessPutResponse(request: Request): Promise<Response> {
    const body = (await request.json()) as {mode: 'selected' | 'all'};
    currentAccess = body.mode === 'all' ? allAccess : selectedAccess;
    onUpdateMode?.(body.mode);
    if (mutationResponse) return mutationResponse();
    return jsonResponse({mode: body.mode});
  }

  function repositoryAccessResponse(request: Request): Promise<Response> {
    if (request.method === 'GET') return Promise.resolve(repositoryAccessGetResponse(request));
    if (request.method === 'PUT') return repositoryAccessPutResponse(request);
    throw new Error(`Unexpected repository access request: ${request.method} ${request.url}`);
  }

  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);

    if (url.pathname === '/integration-connections')
      return Promise.resolve(jsonResponse({connections: [githubConnection]}));
    if (url.pathname === REPOSITORY_ACCESS_PATH) return repositoryAccessResponse(request);

    throw new Error(`Unexpected integrations request: ${request.method} ${request.url}`);
  });
}

function renderDetails(fetchImpl: typeof fetch) {
  configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
  return renderIntegrationsPage({
    path: '/w/acme/settings/integrations/github_acme_corp',
    routePath: '/w/$workspaceSlug/settings/integrations/$connectionSlug',
    element: <ConnectionDetailsPage workspaceSlug="acme" connectionSlug="github_acme_corp" />,
    extraRoutes: ['/w/$workspaceSlug/settings/integrations'],
  });
}

describe('ConnectionDetailsPage', () => {
  test('renders selected targets, origins, mode copy, and the GitHub installation link', async () => {
    renderDetails(detailsFetch());

    expect(await screen.findByRole('heading', {name: 'Repository access'})).toBeVisible();
    expect(await screen.findByRole('radio', {name: SELECTED_MODE_RE})).toBeChecked();
    expect(screen.getByRole('radio', {name: ALL_MODE_RE})).not.toBeChecked();
    expect(screen.getAllByText('acme/platform')).toHaveLength(2);
    expect(screen.getByText('Project: Platform')).toBeVisible();
    expect(screen.getByText('Manual grant')).toBeVisible();
    expect(screen.getByText(GITHUB_EFFECTS_RE)).toBeVisible();
    expect(screen.getByRole('link', {name: 'Manage GitHub installation'})).toHaveAttribute(
      'href',
      githubConnection.external_url,
    );
  });

  test('renders all-installation mode without a selected-target list', async () => {
    renderDetails(detailsFetch({access: allAccess}));

    expect(await screen.findByRole('radio', {name: ALL_MODE_RE})).toBeChecked();
    expect(screen.getByText(ALL_MODE_COPY_RE)).toBeVisible();
    expect(
      screen.queryByRole('heading', {name: 'Selected direct targets'}),
    ).not.toBeInTheDocument();
  });

  test('keeps an empty selected-repository list useful', async () => {
    renderDetails(
      detailsFetch({
        access: {...selectedAccess, repositories: []},
      }),
    );

    expect(await screen.findByText('No selected repositories')).toBeVisible();
    expect(
      screen.getByText(
        'Repositories connected through projects or manual grants will appear here.',
      ),
    ).toBeVisible();
  });

  test('loads additional composed targets from the paginated read model', async () => {
    const firstPage: RepositoryAccessResponse = {
      ...selectedAccess,
      next_cursor: 'page-2',
    };
    const secondPage: RepositoryAccessResponse = {
      mode: 'selected',
      repositories: [
        {
          external_repository_id: 'acme/docs',
          owner: 'acme',
          name: 'docs',
          origins: [{type: 'project', project_id: PROJECT_ID, project_name: 'Docs'}],
        },
      ],
      next_cursor: null,
    };
    const fetchImpl = detailsFetch({access: firstPage, nextPageAccess: secondPage});
    renderDetails(fetchImpl);

    expect(await screen.findByRole('button', {name: 'Load more'})).toBeVisible();
    fireEvent.click(screen.getByRole('button', {name: 'Load more'}));

    expect(await screen.findAllByText('acme/docs')).toHaveLength(2);
    expect(
      fetchImpl.mock.calls.some(([input]) =>
        (input instanceof Request ? input.url : String(input)).includes('cursor=page-2'),
      ),
    ).toBe(true);
  });

  test.each([
    ['access denied', {status: 403, code: 'forbidden'}, 'Access denied'],
    [
      'unsupported providers',
      {status: 422, code: 'integration-repository-access-unsupported'},
      'Repository access controls unavailable',
    ],
  ] as const)('renders the %s state without controls', async (_name, error, title) => {
    renderDetails(detailsFetch({accessError: error}));

    expect(await screen.findByText(title)).toBeVisible();
    expect(screen.queryByRole('radio', {name: SELECTED_MODE_RE})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Save changes'})).not.toBeInTheDocument();
  });

  test('recovers from a read-model server error', async () => {
    renderDetails(detailsFetch({accessError: {status: 503, code: 'server-error'}}));

    expect(await screen.findByText("Couldn't load repository access settings")).toBeVisible();
    fireEvent.click(screen.getByRole('button', {name: 'Retry loading repository access settings'}));

    expect(await screen.findByRole('radio', {name: SELECTED_MODE_RE})).toBeChecked();
  });

  test('saves a changed mode through PUT and reports the pending and success states', async () => {
    let resolveMutation: ((response: Response) => void) | undefined;
    const mutation = new Promise<Response>((resolve) => {
      resolveMutation = resolve;
    });
    const updatedModes: Array<'selected' | 'all'> = [];
    renderDetails(
      detailsFetch({
        mutationResponse: () => mutation,
        onUpdateMode: (mode) => updatedModes.push(mode),
      }),
    );

    await screen.findByRole('radio', {name: SELECTED_MODE_RE});
    fireEvent.click(screen.getByRole('radio', {name: ALL_MODE_RE}));
    fireEvent.click(screen.getByRole('button', {name: 'Save changes'}));

    expect(await screen.findByText('Saving repository access settings…')).toBeVisible();
    expect(screen.getByRole('button', {name: 'Save changes'})).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('radio', {name: ALL_MODE_RE})).toBeDisabled();

    resolveMutation?.(jsonResponse({mode: 'all'}));
    await screen.findByText('Repository access settings saved.');
    expect(updatedModes).toEqual(['all']);
  });

  test('keeps the form recoverable when saving fails', async () => {
    renderDetails(
      detailsFetch({
        mutationResponse: () =>
          jsonResponse({code: 'server-error', message: 'save failed'}, {status: 500}),
      }),
    );

    await screen.findByRole('radio', {name: SELECTED_MODE_RE});
    fireEvent.click(screen.getByRole('radio', {name: ALL_MODE_RE}));
    fireEvent.click(screen.getByRole('button', {name: 'Save changes'}));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Try again. The current repository access mode is unchanged.',
    );
    expect(screen.getByRole('button', {name: 'Save changes'})).toBeEnabled();
  });
});
