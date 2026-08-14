// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type {IntegrationConnectionDto} from '@shipfox/api-integration-core-dto';
import {configureApiClient} from '@shipfox/client-api';
import {fireEvent, screen, waitFor, within} from '@testing-library/react';
import {
  INTEGRATIONS_TEST_WID,
  jsonResponse,
  renderIntegrationsPage,
  testWorkspace,
} from '#test/render.js';
import {IntegrationGallery} from './integration-gallery.js';

if (!HTMLElement.prototype.hasPointerCapture) {
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    configurable: true,
    value: () => false,
  });
}

if (!HTMLElement.prototype.setPointerCapture) {
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: () => undefined,
  });
}

if (!HTMLElement.prototype.releasePointerCapture) {
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    configurable: true,
    value: () => undefined,
  });
}

const SETUP_ROUTES = [
  '/w/$workspaceSlug/integrations/github',
  '/w/$workspaceSlug/integrations/sentry',
  '/w/$workspaceSlug/settings/events',
];
const EXTERNAL_SETTINGS_ACTION_RE = /Open.*settings/u;

const defaultProviders = [
  {provider: 'github', display_name: 'GitHub', capabilities: ['source_control']},
  {provider: 'sentry', display_name: 'Sentry', capabilities: []},
  {provider: 'webhook', display_name: 'Webhook', capabilities: []},
];

const githubConnection = {
  id: '44444444-4444-4444-8444-444444444444',
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

const webhookConnection = {
  id: '77777777-7777-4777-8777-777777777777',
  workspace_id: INTEGRATIONS_TEST_WID,
  provider: 'webhook',
  external_account_id: 'stripe-prod',
  slug: 'stripe-prod',
  display_name: 'Stripe production',
  lifecycle_status: 'active',
  capabilities: [],
  created_at: '2026-04-12T00:00:00.000Z',
  updated_at: '2026-04-12T00:00:00.000Z',
};

const webhookConnectionDto = {
  id: webhookConnection.id,
  workspace_id: INTEGRATIONS_TEST_WID,
  name: 'Stripe production',
  slug: 'stripe-prod',
  lifecycle_status: 'active',
  inbound_url: 'https://api.example.test/webhook/77777777-7777-4777-8777-777777777777',
  created_at: webhookConnection.created_at,
  updated_at: webhookConnection.updated_at,
};

interface FetchOptions {
  providers?: unknown[];
  connections?: unknown[];
  webhookConnections?: unknown[];
  providersFail?: boolean;
  connectionsFail?: boolean;
  webhookConnectionsFail?: boolean;
  onUpdateConnection?: (connectionId: string, body: {lifecycle_status?: string}) => void;
}

function fetchForGallery(options: FetchOptions = {}) {
  const {
    providers = defaultProviders,
    connections = [],
    webhookConnections = [webhookConnectionDto],
    providersFail = false,
    connectionsFail = false,
    webhookConnectionsFail = false,
    onUpdateConnection,
  } = options;
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : undefined;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? request?.method ?? 'GET';
    if (url.includes('/integrations/webhook/connections/')) {
      const connectionId = url.split('/integrations/webhook/connections/')[1]?.split('?')[0];
      if (!connectionId) return Promise.resolve(jsonResponse({}, {status: 404}));
      if (method === 'PATCH') {
        const rawBody =
          init?.body !== undefined ? String(init.body) : (await request?.clone().text()) || '{}';
        const body = JSON.parse(rawBody) as {lifecycle_status?: string};
        onUpdateConnection?.(connectionId, body);
        const connection = webhookConnections.find(
          (candidate) =>
            typeof candidate === 'object' &&
            candidate !== null &&
            'id' in candidate &&
            candidate.id === connectionId,
        ) as Record<string, unknown> | undefined;
        return Promise.resolve(
          jsonResponse({...connection, lifecycle_status: body.lifecycle_status}),
        );
      }
      if (method === 'DELETE') {
        return Promise.resolve(jsonResponse(undefined, {status: 204}));
      }
    }
    if (url.includes('/integrations/webhook/connections')) {
      if (webhookConnectionsFail)
        return Promise.resolve(jsonResponse({code: 'server-error'}, {status: 500}));
      if (method === 'POST') {
        const rawBody =
          init?.body !== undefined ? String(init.body) : (await request?.clone().text()) || '{}';
        const body = JSON.parse(rawBody) as {name?: string; slug?: string; workspace_id?: string};
        return Promise.resolve(
          jsonResponse({
            ...webhookConnectionDto,
            workspace_id: body.workspace_id ?? webhookConnectionDto.workspace_id,
            name: body.name ?? webhookConnectionDto.name,
            slug: body.slug ?? webhookConnectionDto.slug,
          }),
        );
      }
      return Promise.resolve(jsonResponse({connections: webhookConnections}));
    }
    if (url.includes('/integration-providers')) {
      if (providersFail)
        return Promise.resolve(jsonResponse({code: 'server-error'}, {status: 500}));
      return Promise.resolve(jsonResponse({providers}));
    }
    if (url.includes('/integration-connections/')) {
      const connectionId = url.split('/integration-connections/')[1]?.split('?')[0];
      if (!connectionId) return Promise.resolve(jsonResponse({}, {status: 404}));
      if (method === 'PATCH') {
        const rawBody =
          init?.body !== undefined ? String(init.body) : (await request?.clone().text()) || '{}';
        const body = JSON.parse(rawBody) as {lifecycle_status?: string};
        onUpdateConnection?.(connectionId, body);
        const connection = connections.find(
          (candidate) =>
            typeof candidate === 'object' &&
            candidate !== null &&
            'id' in candidate &&
            candidate.id === connectionId,
        ) as Record<string, unknown> | undefined;
        return Promise.resolve(
          jsonResponse({...connection, lifecycle_status: body.lifecycle_status}),
        );
      }
      if (method === 'DELETE') {
        return Promise.resolve(jsonResponse(undefined, {status: 204}));
      }
    }
    if (url.includes('/integration-connections')) {
      if (connectionsFail)
        return Promise.resolve(jsonResponse({code: 'server-error'}, {status: 500}));
      return Promise.resolve(jsonResponse({connections}));
    }
    return Promise.resolve(jsonResponse({}, {status: 404}));
  });
}

function renderGallery(
  props: Parameters<typeof IntegrationGallery>[0] = {},
  options: FetchOptions = {},
  renderOptions: {workspaces?: Parameters<typeof renderIntegrationsPage>[0]['workspaces']} = {},
) {
  configureApiClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: fetchForGallery(options),
  });
  return renderIntegrationsPage({
    path: '/w/acme/integrations',
    routePath: '/w/$workspaceSlug/integrations',
    element: <IntegrationGallery workspaceId={INTEGRATIONS_TEST_WID} {...props} />,
    extraRoutes: SETUP_ROUTES,
    ...(renderOptions.workspaces ? {workspaces: renderOptions.workspaces} : {}),
  });
}

const installedRegion = () => screen.getByRole('region', {name: 'Installed integrations'});
const availableRegion = () => screen.getByRole('region', {name: 'Available integrations'});
const openActions = async (name: string) => {
  fireEvent.pointerDown(await screen.findByRole('button', {name}));
};

const SORTED_NAMES_RE = /acme-(early|late)/;
// The meta line carries the date only: the provider is named once, by the
// icon and the account name, never repeated as body text in the row.
const ADDED_META_RE = /^Added /;
const GITHUB_LINK_RE = /GitHub/u;

describe('IntegrationGallery — installed section', () => {
  test('waits for an explicit workspace id to hydrate before showing install links', async () => {
    renderGallery({}, {}, {workspaces: [testWorkspace({id: 'stale-workspace', slug: 'acme'})]});

    expect(await screen.findByText('Loading workspace details…')).toBeVisible();
    expect(screen.queryByRole('link', {name: GITHUB_LINK_RE})).not.toBeInTheDocument();
  });

  test('renders two distinct cards for two connections sharing one provider', async () => {
    renderGallery(
      {},
      {
        connections: [
          {
            ...githubConnection,
            id: '11111111-1111-4111-8111-aaaaaaaaaaaa',
            display_name: 'acme-one',
          },
          {
            ...githubConnection,
            id: '22222222-2222-4222-8222-bbbbbbbbbbbb',
            display_name: 'acme-two',
          },
        ],
      },
    );

    expect(await screen.findByText('acme-one')).toBeVisible();
    expect(screen.getByText('acme-two')).toBeVisible();
    expect(screen.getByText('Provider accounts installed in this workspace.')).toBeVisible();
  });

  test('sorts stably by provider name then created_at regardless of input order', async () => {
    renderGallery(
      {},
      {
        connections: [
          {
            ...githubConnection,
            id: '22222222-2222-4222-8222-bbbbbbbbbbbb',
            display_name: 'acme-late',
            created_at: '2026-05-01T00:00:00.000Z',
          },
          {
            ...githubConnection,
            id: '11111111-1111-4111-8111-aaaaaaaaaaaa',
            display_name: 'acme-early',
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    );

    await screen.findByText('acme-early');
    const names = within(installedRegion())
      .getAllByText(SORTED_NAMES_RE)
      .map((element) => element.textContent);

    expect(names).toEqual(['acme-early', 'acme-late']);
  });

  test('renders lifecycle badges only for states that need attention', async () => {
    renderGallery(
      {},
      {
        connections: [
          {
            ...githubConnection,
            id: '11111111-1111-4111-8111-aaaaaaaaaaaa',
            lifecycle_status: 'active',
          },
          {
            ...githubConnection,
            id: '22222222-2222-4222-8222-bbbbbbbbbbbb',
            display_name: 'acme-disabled',
            lifecycle_status: 'disabled',
          },
          {
            ...githubConnection,
            id: '33333333-3333-4333-8333-cccccccccccc',
            display_name: 'acme-error',
            lifecycle_status: 'error',
          },
        ],
      },
    );

    expect(await screen.findByText('acme-corp')).toBeVisible();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeVisible();
    expect(screen.getByText('Error')).toBeVisible();
  });

  test('mutes the title of a disabled connection', async () => {
    renderGallery({}, {connections: [{...githubConnection, lifecycle_status: 'disabled'}]});

    const title = await screen.findByText('acme-corp');

    expect(title).toHaveClass('text-foreground-neutral-disabled');
  });

  test('shows the standard actions menu for installed rows', async () => {
    renderGallery({}, {connections: [webhookConnection]});

    expect(await screen.findByText('Stripe production')).toBeVisible();
    await openActions('Open Stripe production integration actions');

    expect(screen.getByRole('menuitem', {name: 'Use this integration'})).toBeVisible();
    expect(screen.getByRole('menuitem', {name: 'View recent events'})).toBeVisible();
    expect(screen.getByRole('menuitem', {name: 'Disable integration'})).toBeVisible();
    expect(screen.getByRole('menuitem', {name: 'Delete integration'})).toBeVisible();
  });

  test('opens external provider settings safely when a connection exposes a URL', async () => {
    renderGallery({}, {connections: [githubConnection]});

    await openActions('Open acme-corp integration actions');

    const externalAction = screen.getByRole('menuitem', {name: 'Open in GitHub'});
    expect(externalAction).toHaveAttribute('href', githubConnection.external_url);
    expect(externalAction).toHaveAttribute('target', '_blank');
    expect(externalAction).toHaveAttribute('rel', 'noreferrer noopener');
  });

  test('uses generic external copy without provider metadata and omits it without a URL', async () => {
    const gallery = renderGallery({}, {providers: [], connections: [githubConnection]});

    await openActions('Open acme-corp integration actions');
    expect(screen.getByRole('menuitem', {name: 'Open provider settings'})).toHaveAttribute(
      'href',
      githubConnection.external_url,
    );

    gallery.unmount();
    renderGallery({}, {providers: [], connections: [webhookConnection]});
    await openActions('Open Stripe production integration actions');
    expect(
      screen.queryByRole('menuitem', {name: EXTERNAL_SETTINGS_ACTION_RE}),
    ).not.toBeInTheDocument();
  });

  test('opens the standard usage modal with webhook details', async () => {
    renderGallery({}, {connections: [webhookConnection]});

    await openActions('Open Stripe production integration actions');
    fireEvent.click(screen.getByRole('menuitem', {name: 'Use this integration'}));

    expect(await screen.findByText('Usage')).toBeVisible();
    expect(await screen.findByText('Inbound URL')).toBeVisible();
    expect(screen.getByText(webhookConnectionDto.inbound_url)).toBeVisible();
  });

  test('restores page interactivity after closing the usage modal', async () => {
    renderGallery({}, {connections: [webhookConnection]});

    await openActions('Open Stripe production integration actions');
    expect(document.body.style.pointerEvents).toBe('none');
    fireEvent.click(screen.getByRole('menuitem', {name: 'Use this integration'}));
    expect(await screen.findByRole('dialog', {name: 'Use Stripe production'})).toBeVisible();
    expect(document.body.style.pointerEvents).toBe('none');

    const usageDialog = screen.getByRole('dialog', {name: 'Use Stripe production'});
    fireEvent.click(within(usageDialog).getByRole('button', {name: 'Done'}));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', {name: 'Use Stripe production'})).not.toBeInTheDocument();
      expect(document.body).not.toHaveStyle({pointerEvents: 'none'});
    });

    await openActions('Open Stripe production integration actions');
    expect(screen.getByRole('menuitem', {name: 'Use this integration'})).toBeVisible();
  });

  test('opens the usage modal with a GitHub event selector', async () => {
    renderGallery({}, {connections: [githubConnection]});

    await openActions('Open acme-corp integration actions');
    fireEvent.click(screen.getByRole('menuitem', {name: 'Use this integration'}));

    expect(await screen.findByText('Usage')).toBeVisible();
    const eventSelect = await screen.findByRole('combobox', {name: 'Event'});

    expect(eventSelect).toBeVisible();
    await waitFor(() => {
      expect(eventSelect).toHaveTextContent('push');
    });
  });

  test('toggles integration lifecycle status from the actions menu', async () => {
    const updates: Array<{connectionId: string; body: {lifecycle_status?: string}}> = [];
    const fetchImpl = fetchForGallery({
      connections: [githubConnection],
      onUpdateConnection: (connectionId, body) => updates.push({connectionId, body}),
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    renderIntegrationsPage({
      path: '/w/acme/integrations',
      routePath: '/w/$workspaceSlug/integrations',
      element: <IntegrationGallery />,
      extraRoutes: SETUP_ROUTES,
    });

    await openActions('Open acme-corp integration actions');
    fireEvent.click(screen.getByRole('menuitem', {name: 'Disable integration'}));

    await screen.findByText('Integration disabled.');
    const updateRequest = fetchImpl.mock.calls
      .map(([input]) => input)
      .find(
        (input) =>
          input instanceof Request &&
          input.url.includes(`/integration-connections/${githubConnection.id}`),
      );
    expect(updateRequest).toBeInstanceOf(Request);
    expect((updateRequest as Request).method).toBe('PATCH');
    expect(updates).toEqual([
      {
        connectionId: githubConnection.id,
        body: {lifecycle_status: 'disabled'},
      },
    ]);
  });

  test('toggles webhook connections through the webhook endpoint', async () => {
    const updates: Array<{connectionId: string; body: {lifecycle_status?: string}}> = [];
    const fetchImpl = fetchForGallery({
      connections: [webhookConnection],
      onUpdateConnection: (connectionId, body) => updates.push({connectionId, body}),
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    renderIntegrationsPage({
      path: '/w/acme/integrations',
      routePath: '/w/$workspaceSlug/integrations',
      element: <IntegrationGallery />,
      extraRoutes: SETUP_ROUTES,
    });

    await openActions('Open Stripe production integration actions');
    fireEvent.click(screen.getByRole('menuitem', {name: 'Disable integration'}));

    await screen.findByText('Integration disabled.');
    const updateRequest = fetchImpl.mock.calls
      .map(([input]) => input)
      .find(
        (input) =>
          input instanceof Request &&
          input.url.includes(`/integrations/webhook/connections/${webhookConnection.id}`),
      );
    expect(updateRequest).toBeInstanceOf(Request);
    expect((updateRequest as Request).method).toBe('PATCH');
    expect(updates).toEqual([
      {
        connectionId: webhookConnection.id,
        body: {lifecycle_status: 'disabled'},
      },
    ]);
  });

  test('deletes webhook connections through the webhook endpoint', async () => {
    const fetchImpl = fetchForGallery({connections: [webhookConnection]});
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    renderIntegrationsPage({
      path: '/w/acme/integrations',
      routePath: '/w/$workspaceSlug/integrations',
      element: <IntegrationGallery />,
      extraRoutes: SETUP_ROUTES,
    });

    await openActions('Open Stripe production integration actions');
    fireEvent.click(screen.getByRole('menuitem', {name: 'Delete integration'}));
    fireEvent.click(await screen.findByRole('button', {name: 'Delete integration'}));

    await screen.findByText('Integration deleted.');
    const deleteRequest = fetchImpl.mock.calls
      .map(([input]) => input)
      .find(
        (input) =>
          input instanceof Request &&
          input.url.includes(`/integrations/webhook/connections/${webhookConnection.id}`) &&
          input.method === 'DELETE',
      );
    expect(deleteRequest).toBeInstanceOf(Request);
  });

  test('opens the delete confirmation from the actions menu', async () => {
    renderGallery({}, {connections: [githubConnection]});

    await openActions('Open acme-corp integration actions');
    fireEvent.click(screen.getByRole('menuitem', {name: 'Delete integration'}));

    const dialog = await screen.findByRole('dialog', {name: 'Delete integration'});
    const integrationName = within(dialog).getByText('acme-corp');

    expect(dialog).toHaveTextContent(
      'Are you sure you want to delete acme-corp? Once deleted, Shipfox will immediately stop processing events from this integration. This cannot be undone.',
    );
    expect(integrationName.tagName).toBe('STRONG');
    expect(integrationName).toHaveClass('font-medium');
    expect(within(dialog).getByRole('button', {name: 'Delete integration'})).toBeVisible();
  });

  test('filters connections by capability in memory', async () => {
    renderGallery(
      {capability: 'source_control'},
      {
        connections: [
          githubConnection,
          {
            ...githubConnection,
            id: '22222222-2222-4222-8222-bbbbbbbbbbbb',
            provider: 'sentry',
            display_name: 'sentry-org',
            capabilities: [],
          },
        ],
      },
    );

    expect(await screen.findByText('acme-corp')).toBeVisible();
    expect(screen.queryByText('sentry-org')).not.toBeInTheDocument();
  });

  test('renders a connection whose provider is missing from the catalog', async () => {
    renderGallery(
      {},
      {connections: [{...githubConnection, provider: 'mystery', display_name: 'mystery-acct'}]},
    );

    expect(await screen.findByText('mystery-acct')).toBeVisible();
    expect(within(installedRegion()).getByText(ADDED_META_RE)).toBeVisible();
  });

  test('names the provider once per row: not repeated in the meta line', async () => {
    renderGallery({}, {connections: [githubConnection]});

    await screen.findByText('acme-corp');

    const region = installedRegion();
    expect(within(region).getByText(ADDED_META_RE)).toBeVisible();
    expect(within(region).queryByText('GitHub')).not.toBeInTheDocument();
  });

  test('renders installed cards even when the providers query fails', async () => {
    renderGallery({}, {providersFail: true, connections: [githubConnection]});

    expect(await screen.findByText('acme-corp')).toBeVisible();
    expect(within(installedRegion()).getByText(ADDED_META_RE)).toBeVisible();
    expect(
      screen.getByRole('button', {name: 'Open acme-corp integration actions'}),
    ).toBeInTheDocument();
    expect(
      within(availableRegion()).getByText("Couldn't load available integrations"),
    ).toBeInTheDocument();
  });

  test('surfaces a connections error only in the installed section (settings context)', async () => {
    renderGallery({}, {connectionsFail: true});

    expect(await screen.findByText("Couldn't load integrations")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load available integrations")).not.toBeInTheDocument();
    expect(within(availableRegion()).getByRole('link', {name: 'Install GitHub'})).toBeVisible();
  });

  test('shows the empty state in the settings context', async () => {
    renderGallery({}, {connections: []});

    expect(await screen.findByText('No integrations installed yet')).toBeVisible();
  });
});

describe('IntegrationGallery: available section', () => {
  test('lists every provider with an Install link, including installed ones', async () => {
    renderGallery({}, {connections: [githubConnection]});

    expect(await screen.findByRole('link', {name: 'Install GitHub'})).toBeVisible();
    expect(screen.getByRole('link', {name: 'Install Sentry'})).toBeVisible();
    expect(screen.getByRole('button', {name: 'Add Webhook'})).toBeVisible();
    expect(screen.getByText('Providers available to install in this workspace.')).toBeVisible();
  });

  test('exposes each available tile as a single link with no nested button', async () => {
    renderGallery({}, {connections: [githubConnection]});

    const link = await screen.findByRole('link', {name: 'Install GitHub'});

    expect(link).toHaveClass('focus-visible:shadow-button-neutral-focus');
    expect(link).toHaveClass('shadow-button-neutral');
    expect(link.className).not.toContain('shadow-button-secondary');
    expect(within(link).getByText('Install')).toBeVisible();
    expect(within(link).queryByRole('button')).not.toBeInTheDocument();
  });

  test('opens the webhook create modal from the Add card', async () => {
    renderGallery({}, {connections: []});

    fireEvent.click(await screen.findByRole('button', {name: 'Add Webhook'}));

    expect(await screen.findByRole('textbox', {name: 'Name'})).toBeVisible();
    expect(screen.getByRole('textbox', {name: 'Slug'})).toBeVisible();
  });

  test('opens the usage modal after creating a webhook', async () => {
    renderGallery({}, {connections: []});

    fireEvent.click(await screen.findByRole('button', {name: 'Add Webhook'}));
    fireEvent.change(await screen.findByRole('textbox', {name: 'Name'}), {
      target: {value: 'Stripe production'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'Create'}));

    expect(await screen.findByText('Usage')).toBeVisible();
    expect(screen.getAllByText('webhook-stripe-production')[0]).toBeVisible();
    expect(await screen.findByText('Inbound URL')).toBeVisible();
    expect(screen.getByText(webhookConnectionDto.inbound_url)).toBeVisible();
    expect(screen.queryByRole('textbox', {name: 'Name'})).not.toBeInTheDocument();
  });

  test('fills an empty webhook slug from the name', async () => {
    renderGallery({}, {connections: []});

    fireEvent.click(await screen.findByRole('button', {name: 'Add Webhook'}));
    fireEvent.change(await screen.findByRole('textbox', {name: 'Name'}), {
      target: {value: 'Stripe production'},
    });

    await waitFor(() => {
      expect(screen.getByRole('textbox', {name: 'Slug'})).toHaveValue('webhook-stripe-production');
    });
  });

  test('preserves a non-empty manual webhook slug until the slug is cleared', async () => {
    renderGallery({}, {connections: []});

    fireEvent.click(await screen.findByRole('button', {name: 'Add Webhook'}));
    fireEvent.change(await screen.findByRole('textbox', {name: 'Name'}), {
      target: {value: 'Stripe production'},
    });
    await waitFor(() => {
      expect(screen.getByRole('textbox', {name: 'Slug'})).toHaveValue('webhook-stripe-production');
    });

    fireEvent.change(screen.getByRole('textbox', {name: 'Slug'}), {
      target: {value: 'custom-stripe-hook'},
    });
    fireEvent.change(screen.getByRole('textbox', {name: 'Name'}), {
      target: {value: 'Billing alerts'},
    });

    expect(screen.getByRole('textbox', {name: 'Slug'})).toHaveValue('custom-stripe-hook');

    fireEvent.change(screen.getByRole('textbox', {name: 'Slug'}), {
      target: {value: ''},
    });

    await waitFor(() => {
      expect(screen.getByRole('textbox', {name: 'Slug'})).toHaveValue('webhook-billing-alerts');
    });
  });

  test('rejects reserved webhook slugs inline', async () => {
    renderGallery({}, {connections: []});

    fireEvent.click(await screen.findByRole('button', {name: 'Add Webhook'}));
    fireEvent.change(await screen.findByRole('textbox', {name: 'Name'}), {
      target: {value: 'Stripe production'},
    });
    fireEvent.change(screen.getByRole('textbox', {name: 'Slug'}), {
      target: {value: 'github'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'Create'}));

    expect(await screen.findByText('That slug is reserved.')).toBeVisible();
  });

  test('validates webhook names after trimming whitespace', async () => {
    renderGallery({}, {connections: []});

    fireEvent.click(await screen.findByRole('button', {name: 'Add Webhook'}));
    fireEvent.change(await screen.findByRole('textbox', {name: 'Name'}), {
      target: {value: '   '},
    });
    fireEvent.change(screen.getByRole('textbox', {name: 'Slug'}), {
      target: {value: 'stripe-prod'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'Create'}));

    expect(await screen.findByText('Webhook name is required.')).toBeVisible();
  });

  test('surfaces a providers error only in the available section', async () => {
    renderGallery({}, {providersFail: true, connections: [githubConnection]});

    expect(await screen.findByText("Couldn't load available integrations")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load integrations")).not.toBeInTheDocument();
  });

  test('skips providers with no catalog entry', async () => {
    renderGallery(
      {},
      {
        providers: [
          ...defaultProviders,
          {provider: 'mystery', display_name: 'Mystery', capabilities: []},
        ],
      },
    );

    await screen.findByRole('link', {name: 'Install GitHub'});

    expect(screen.queryByRole('link', {name: 'Install Mystery'})).not.toBeInTheDocument();
  });
});
