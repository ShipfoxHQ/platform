// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {modelProviderQueryKeys} from '@shipfox/client-agent';
import {configureApiClient} from '@shipfox/client-api';
import {
  type IntegrationConnection,
  type IntegrationProvider,
  integrationConnectionsQueryOptions,
  integrationProvidersQueryOptions,
} from '@shipfox/client-integrations';
import {provisionerTokenQueryKeys} from '@shipfox/client-runners';
import {
  type ClientAnalytics,
  ClientAnalyticsProvider,
  clearWorkspaceSetupChecklistDismissal,
  dismissWorkspaceSetupChecklist,
} from '@shipfox/client-shell/runtime';
import {listInvitationsQueryKey, listMembersQueryKey} from '@shipfox/client-workspace-settings';
import {afterEach, beforeEach, describe, expect, test, vi} from '@shipfox/vitest/vi';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {deriveIntegrationReadiness} from '#core/integration-readiness.js';
import {deriveSetupChecklist} from '#core/setup-checklist.js';
import {
  SetupChecklistBody,
  type WorkspaceReference,
  WorkspaceSetupChecklist,
  WorkspaceSetupIndicator,
} from './setup-checklist.js';

const WORKSPACE: WorkspaceReference = {id: 'test-workspace', slug: 'acme'};
const GET_STARTED_BUTTON_RE = /Get started/u;
const now = new Date().toISOString();
const githubProvider: IntegrationProvider = {
  provider: 'github',
  displayName: 'GitHub',
  capabilities: ['source_control'],
};
const linearProvider: IntegrationProvider = {
  provider: 'linear',
  displayName: 'Linear',
  capabilities: ['agent_tools'],
};

function connection(
  provider: 'github' | 'linear',
  lifecycleStatus: IntegrationConnection['lifecycleStatus'],
): IntegrationConnection {
  return {
    id: `${provider}-connection`,
    workspaceId: WORKSPACE.id,
    provider,
    externalAccountId: `${provider}-account`,
    slug: `${provider}-account`,
    displayName: provider === 'github' ? 'GitHub' : 'Linear',
    lifecycleStatus,
    capabilities: provider === 'github' ? ['source_control'] : ['agent_tools'],
    createdAt: now,
    updatedAt: now,
  };
}

function createQueryClient() {
  return new QueryClient({defaultOptions: {queries: {retry: false}}});
}

function pendingResponse(): Promise<Response> {
  return new Promise<Response>((resolve) => {
    void resolve;
  });
}

function seedQueries(queryClient: QueryClient, toolsConnected = false) {
  queryClient.setQueryData(integrationProvidersQueryOptions().queryKey, [
    githubProvider,
    linearProvider,
  ]);
  queryClient.setQueryData(integrationConnectionsQueryOptions(WORKSPACE.id).queryKey, [
    connection('github', 'active'),
    ...(toolsConnected ? [connection('linear', 'active')] : []),
  ]);
  queryClient.setQueryData(provisionerTokenQueryKeys.active(WORKSPACE.id), {
    provisioners: [],
    installationRunners: 'managed' as const,
  });
  queryClient.setQueryData(modelProviderQueryKeys.catalog(), {
    providers: [],
    workspaceProviders: 'enabled' as const,
    managedProviderId: 'managed-default',
    instanceDefaultProviderId: null,
  });
  queryClient.setQueryData(modelProviderQueryKeys.configs(WORKSPACE.id), {
    configs: [],
    defaultHarnessId: null,
    defaultProviderId: null,
  });
  queryClient.setQueryData(listMembersQueryKey(WORKSPACE.id), [
    {
      id: 'member-1',
      userId: 'user-1',
      workspaceId: WORKSPACE.id,
      email: 'you@example.com',
      name: 'You',
      role: 'admin' as const,
      joinedAt: now,
      updatedAt: now,
    },
  ]);
  queryClient.setQueryData(listInvitationsQueryKey(WORKSPACE.id), []);
}

function renderWithProviders(
  element: React.ReactElement,
  queryClient: QueryClient,
  analytics: ClientAnalytics,
) {
  const rootRoute = createRootRoute({component: Outlet});
  const routePaths = [
    '/w/$workspaceSlug',
    '/w/$workspaceSlug/settings/integrations',
    '/w/$workspaceSlug/settings/runners',
    '/w/$workspaceSlug/settings/agents',
    '/w/$workspaceSlug/settings/members',
  ];
  const routes = routePaths.map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => element,
    }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({initialEntries: ['/w/acme']}),
  });

  return render(
    <ClientAnalyticsProvider analytics={analytics}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ClientAnalyticsProvider>,
  );
}

describe('SetupChecklistBody', () => {
  test('renders ordered statuses, purposes, and actions', async () => {
    const checklist = deriveSetupChecklist({
      readiness: deriveIntegrationReadiness({
        providers: [githubProvider, linearProvider],
        connections: [connection('github', 'active')],
      }),
      installationRunners: 'none',
      workspaceRunnerCapacity: false,
      modelProvider: {installationProvided: false, configured: false},
      membership: {memberCount: 1, pendingInvitationCount: 0},
    });
    const queryClient = createQueryClient();

    renderWithProviders(
      <SetupChecklistBody checklist={checklist} workspaceSlug={WORKSPACE.slug} />,
      queryClient,
      {capture: vi.fn()},
    );

    expect(await screen.findByRole('list', {name: 'Setup steps'})).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    expect(await screen.findByText('Connect your tools')).toBeInTheDocument();
    expect(
      await screen.findByText('Jobs wait in `pending` until a runner is online'),
    ).toBeInTheDocument();
    expect(await screen.findByRole('link', {name: 'Connect'})).toHaveAttribute(
      'href',
      `/w/${WORKSPACE.slug}/settings/integrations`,
    );
    expect(await screen.findByRole('link', {name: 'Set up'})).toHaveAttribute(
      'href',
      `/w/${WORKSPACE.slug}/settings/runners`,
    );
    expect(await screen.findByRole('link', {name: 'Configure'})).toHaveAttribute(
      'href',
      `/w/${WORKSPACE.slug}/settings/agents`,
    );
    expect(await screen.findByRole('link', {name: 'Read the quickstart'})).toHaveAttribute(
      'href',
      'https://www.shipfox.io/docs/getting-started',
    );
    expect(await screen.findByRole('link', {name: 'Invite'})).toHaveAttribute(
      'href',
      `/w/${WORKSPACE.slug}/settings/members`,
    );
    expect(screen.queryByText('Next', {exact: true})).not.toBeInTheDocument();
    expect(await screen.findAllByText('next step', {exact: true})).toHaveLength(2);
    expect(
      screen
        .getAllByText('done', {exact: true})
        .every((node) => node.classList.contains('sr-only')),
    ).toBe(true);
    expect(
      screen
        .getAllByText('to do', {exact: true})
        .every((node) => node.classList.contains('sr-only')),
    ).toBe(true);
  });
});

describe('workspace checklist hosts', () => {
  beforeEach(() => {
    window.localStorage.clear();
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: vi.fn()});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  test('does not subscribe to checklist queries after dismissal', () => {
    const queryClient = createQueryClient();
    const fetchImpl = vi.fn();
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    dismissWorkspaceSetupChecklist(WORKSPACE.id);

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {
      capture: vi.fn(),
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(
      queryClient
        .getQueryCache()
        .find({queryKey: integrationProvidersQueryOptions().queryKey})
        ?.getObserversCount() ?? 0,
    ).toBe(0);
    clearWorkspaceSetupChecklistDismissal(WORKSPACE.id);
  });

  test('renders the completion state only after an observed false-to-true transition', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient);
    const capture = vi.fn();

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {capture});

    expect(screen.queryByText("You're set up")).not.toBeInTheDocument();
    expect(await screen.findByText('Connect your tools')).toBeInTheDocument();

    act(() => {
      queryClient.setQueryData(integrationConnectionsQueryOptions(WORKSPACE.id).queryKey, [
        connection('github', 'active'),
        connection('linear', 'active'),
      ]);
    });

    expect(await screen.findByText("You're set up")).toBeInTheDocument();
    expect(capture).toHaveBeenCalledWith('onboarding_checklist_shown', {host: 'panel'});
    expect(capture).toHaveBeenCalledWith('onboarding_checklist_completed', {host: 'panel'});

    fireEvent.click(screen.getByRole('button', {name: 'Done'}));
    expect(capture).toHaveBeenCalledWith('onboarding_checklist_dismissed', {host: 'panel'});
  });

  test('does not replay or keep the completion state after a regression', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient);
    const capture = vi.fn();

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {capture});

    expect(await screen.findByText('Connect your tools')).toBeInTheDocument();
    act(() => {
      queryClient.setQueryData(integrationConnectionsQueryOptions(WORKSPACE.id).queryKey, [
        connection('github', 'active'),
        connection('linear', 'active'),
      ]);
    });
    expect(await screen.findByText("You're set up")).toBeInTheDocument();

    act(() => {
      queryClient.setQueryData(integrationConnectionsQueryOptions(WORKSPACE.id).queryKey, [
        connection('github', 'active'),
      ]);
    });
    await waitFor(() => expect(screen.queryByText("You're set up")).not.toBeInTheDocument());

    act(() => {
      queryClient.setQueryData(integrationConnectionsQueryOptions(WORKSPACE.id).queryKey, [
        connection('github', 'active'),
        connection('linear', 'active'),
      ]);
    });
    await waitFor(() => expect(screen.queryByText("You're set up")).not.toBeInTheDocument());
    expect(
      capture.mock.calls.filter(([event]) => event === 'onboarding_checklist_completed'),
    ).toHaveLength(1);
  });

  test('captures row clicks with the checklist row id', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient);
    const capture = vi.fn();

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {capture});

    fireEvent.click(await screen.findByRole('link', {name: 'Connect'}));

    expect(capture).toHaveBeenCalledWith('onboarding_checklist_row_clicked', {row_id: 'tools'});
  });

  test('exposes the indicator progress without duplicating its completion label', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient);

    renderWithProviders(<WorkspaceSetupIndicator workspace={WORKSPACE} />, queryClient, {
      capture: vi.fn(),
    });

    expect(
      await screen.findByRole('button', {name: 'Get started, 2 of 3 done'}),
    ).toBeInTheDocument();
  });

  test('shows the indicator completion transition and its dismiss action', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient);
    const capture = vi.fn();

    renderWithProviders(<WorkspaceSetupIndicator workspace={WORKSPACE} />, queryClient, {capture});
    expect(
      await screen.findByRole('button', {name: 'Get started, 2 of 3 done'}),
    ).toBeInTheDocument();

    act(() => {
      queryClient.setQueryData(integrationConnectionsQueryOptions(WORKSPACE.id).queryKey, [
        connection('github', 'active'),
        connection('linear', 'active'),
      ]);
    });

    const trigger = await screen.findByRole('button', {name: 'Get started, 3 of 3 done'});
    expect(capture).toHaveBeenCalledWith('onboarding_checklist_completed', {host: 'popover'});
    fireEvent.click(trigger);

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent("You're set up");
    expect(status).toHaveAttribute('aria-live', 'polite');
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-labelledby', trigger.id);
    fireEvent.click(screen.getByRole('button', {name: 'Hide setup guide'}));

    await waitFor(() =>
      expect(screen.queryByRole('button', {name: GET_STARTED_BUTTON_RE})).not.toBeInTheDocument(),
    );
    expect(capture).toHaveBeenCalledWith('onboarding_checklist_dismissed', {host: 'popover'});
  });

  test('synchronizes dismissal between mounted hosts in the same tab', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient);
    const capture = vi.fn();

    renderWithProviders(
      <>
        <WorkspaceSetupChecklist workspace={WORKSPACE} />
        <WorkspaceSetupIndicator workspace={WORKSPACE} />
      </>,
      queryClient,
      {capture},
    );

    expect(
      await screen.findByRole('button', {name: 'Get started, 2 of 3 done'}),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Hide setup guide'}));

    await waitFor(() => {
      expect(screen.queryByRole('region', {name: 'Get started'})).not.toBeInTheDocument();
      expect(screen.queryByRole('button', {name: GET_STARTED_BUTTON_RE})).not.toBeInTheDocument();
    });
  });

  test('keeps a local dismissal when browser storage cannot persist it', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient);
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: vi.fn()});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {
      capture: vi.fn(),
    });

    expect(await screen.findByRole('button', {name: 'Hide setup guide'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Hide setup guide'}));

    await waitFor(() => {
      expect(screen.queryByRole('region', {name: 'Get started'})).not.toBeInTheDocument();
    });
  });

  test('waits for non-base query families before showing completion', async () => {
    const queryClient = createQueryClient();
    const fetchImpl = vi.fn(() => pendingResponse());
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    queryClient.setQueryData(integrationProvidersQueryOptions().queryKey, [
      githubProvider,
      linearProvider,
    ]);
    queryClient.setQueryData(integrationConnectionsQueryOptions(WORKSPACE.id).queryKey, [
      connection('github', 'active'),
    ]);

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {
      capture: vi.fn(),
    });

    expect(await screen.findByText('Connect your tools')).toBeInTheDocument();
    act(() => {
      queryClient.setQueryData(integrationConnectionsQueryOptions(WORKSPACE.id).queryKey, [
        connection('github', 'active'),
        connection('linear', 'active'),
      ]);
    });
    await waitFor(() => expect(screen.queryByText("You're set up")).not.toBeInTheDocument());

    act(() => {
      queryClient.setQueryData(provisionerTokenQueryKeys.active(WORKSPACE.id), {
        provisioners: [],
        installationRunners: 'managed' as const,
      });
      queryClient.setQueryData(modelProviderQueryKeys.catalog(), {
        providers: [],
        workspaceProviders: 'enabled' as const,
        managedProviderId: 'managed-default',
        instanceDefaultProviderId: null,
      });
      queryClient.setQueryData(modelProviderQueryKeys.configs(WORKSPACE.id), {
        configs: [],
        defaultHarnessId: null,
        defaultProviderId: null,
      });
      queryClient.setQueryData(listMembersQueryKey(WORKSPACE.id), []);
      queryClient.setQueryData(listInvitationsQueryKey(WORKSPACE.id), []);
    });

    expect(await screen.findByText("You're set up")).toBeInTheDocument();
  });

  test('keeps the panel skeleton while base queries are pending', async () => {
    const queryClient = createQueryClient();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(() => pendingResponse()),
    });

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {
      capture: vi.fn(),
    });

    expect(await screen.findByRole('status', {name: 'Loading setup guide'})).toBeInTheDocument();
  });

  test('hides rows from failed query families without marking the checklist complete', async () => {
    const queryClient = createQueryClient();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(() => Promise.reject(new Error('request failed'))),
    });

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {
      capture: vi.fn(),
    });

    await waitFor(() => {
      expect(screen.queryByRole('status', {name: 'Loading setup guide'})).not.toBeInTheDocument();
    });
    expect(screen.queryByText('Connect your tools')).not.toBeInTheDocument();
    expect(screen.queryByText('Set up runner capacity')).not.toBeInTheDocument();
    expect(screen.queryByText('Configure a model provider')).not.toBeInTheDocument();
    expect(screen.queryByText("You're set up")).not.toBeInTheDocument();
  });

  test('does not let a failed optional family block visible completion', async () => {
    const queryClient = createQueryClient();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(() => Promise.reject(new Error('optional request failed'))),
    });
    queryClient.setQueryData(integrationProvidersQueryOptions().queryKey, [
      githubProvider,
      linearProvider,
    ]);
    queryClient.setQueryData(integrationConnectionsQueryOptions(WORKSPACE.id).queryKey, [
      connection('github', 'active'),
      connection('linear', 'active'),
    ]);

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {
      capture: vi.fn(),
    });

    await waitFor(() => {
      expect(screen.queryByRole('status', {name: 'Loading setup guide'})).not.toBeInTheDocument();
      expect(screen.queryByRole('region', {name: 'Get started'})).not.toBeInTheDocument();
    });
  });

  test('hides the indicator while optional checklist families are unsettled', async () => {
    const queryClient = createQueryClient();
    const fetchImpl = vi.fn(() => pendingResponse());
    const capture = vi.fn();
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    queryClient.setQueryData(integrationProvidersQueryOptions().queryKey, [
      githubProvider,
      linearProvider,
    ]);
    queryClient.setQueryData(integrationConnectionsQueryOptions(WORKSPACE.id).queryKey, [
      connection('github', 'active'),
      connection('linear', 'active'),
    ]);

    renderWithProviders(<WorkspaceSetupIndicator workspace={WORKSPACE} />, queryClient, {capture});

    await waitFor(() => {
      expect(screen.queryByRole('button', {name: GET_STARTED_BUTTON_RE})).not.toBeInTheDocument();
    });
    expect(capture).not.toHaveBeenCalledWith('onboarding_checklist_shown', {host: 'popover'});
  });

  test('does not render an initially complete checklist without a transition', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, true);

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {
      capture: vi.fn(),
    });

    await waitFor(() => {
      expect(screen.queryByRole('region', {name: 'Get started'})).not.toBeInTheDocument();
    });
  });

  test('does not render an initially complete indicator without a transition', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, true);

    renderWithProviders(<WorkspaceSetupIndicator workspace={WORKSPACE} />, queryClient, {
      capture: vi.fn(),
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', {name: GET_STARTED_BUTTON_RE})).not.toBeInTheDocument();
    });
  });
});
