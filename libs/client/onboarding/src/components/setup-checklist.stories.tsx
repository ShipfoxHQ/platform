import {modelProviderQueryKeys} from '@shipfox/client-agent';
import {
  type IntegrationConnection,
  type IntegrationProvider,
  integrationConnectionsQueryOptions,
  integrationProvidersQueryOptions,
} from '@shipfox/client-integrations';
import {provisionerTokenQueryKeys} from '@shipfox/client-runners';
import {
  clearWorkspaceSetupChecklistDismissal,
  dismissWorkspaceSetupChecklist,
} from '@shipfox/client-shell/runtime';
import {listInvitationsQueryKey, listMembersQueryKey} from '@shipfox/client-workspace-settings';
import {Panel, PanelBody} from '@shipfox/react-ui/panel';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import type {ReactNode} from 'react';
import {useEffect, useMemo, useState} from 'react';
import {deriveSetupChecklist} from '#core/setup-checklist.js';
import {setWorkspaceSetupChecklistExpanded} from '#hooks/use-checklist-expansion.js';
import {
  SetupChecklistBody,
  SetupChecklistCompletion,
  type WorkspaceReference,
  WorkspaceSetupChecklist,
  WorkspaceSetupIndicator,
} from './setup-checklist.js';

const WORKSPACE: WorkspaceReference = {id: 'story-workspace', slug: 'acme'};
const DISMISSED_WORKSPACE: WorkspaceReference = {
  id: 'dismissed-story-workspace',
  slug: WORKSPACE.slug,
};
const EXPANDED_WORKSPACE: WorkspaceReference = {
  id: 'expanded-story-workspace',
  slug: WORKSPACE.slug,
};
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
const githubConnection: IntegrationConnection = {
  id: 'github-connection',
  workspaceId: WORKSPACE.id,
  provider: 'github',
  externalAccountId: 'github-account',
  slug: 'github-account',
  displayName: 'GitHub',
  lifecycleStatus: 'active',
  capabilities: ['source_control'],
  createdAt: now,
  updatedAt: now,
};
const disabledLinearConnection: IntegrationConnection = {
  id: 'linear-connection',
  workspaceId: WORKSPACE.id,
  provider: 'linear',
  externalAccountId: 'linear-account',
  slug: 'linear-account',
  displayName: 'Linear',
  lifecycleStatus: 'error',
  capabilities: ['agent_tools'],
  createdAt: now,
  updatedAt: now,
};

const completeChecklist = deriveSetupChecklist({
  readiness: {
    providers: [
      {
        provider: 'github',
        displayName: 'GitHub',
        capabilities: ['source_control'],
        connected: true,
        attention: false,
      },
      {
        provider: 'linear',
        displayName: 'Linear',
        capabilities: ['agent_tools'],
        connected: true,
        attention: false,
      },
    ],
    attentionProviders: [],
    hasSourceControl: true,
    hasToolIntegration: true,
  },
  installationRunners: 'managed',
  workspaceRunnerCapacity: false,
  modelProvider: {installationProvided: true, configured: false},
  membership: {memberCount: 2, pendingInvitationCount: 0},
});

const meta = {
  title: 'Client onboarding/Setup checklist',
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const CloudPanel: Story = {
  render: () => <HostStory scenario="cloud" host="panel" />,
};

export const CloudIndicator: Story = {
  render: () => <HostStory scenario="cloud" host="indicator" />,
};

export const SelfHostedPanel: Story = {
  render: () => <HostStory scenario="self-hosted" host="panel" />,
};

export const SelfHostedIndicator: Story = {
  render: () => <HostStory scenario="self-hosted" host="indicator" />,
};

export const NeedsAttentionPanel: Story = {
  render: () => <HostStory scenario="attention" host="panel" />,
};

export const NeedsAttentionIndicator: Story = {
  render: () => <HostStory scenario="attention" host="indicator" />,
};

export const SelfHostedPanelExpanded: Story = {
  render: () => <ExpandedPanelStory />,
};

export const Dismissed: Story = {
  render: () => <DismissedStory />,
};

export const PanelCompletion: Story = {
  render: () => (
    <div className="min-h-[240px] bg-background-subtle-base p-frame">
      <div className="mx-auto w-full max-w-[480px]">
        <Panel>
          <PanelBody>
            <SetupChecklistCompletion standalone showBurst={false} />
          </PanelBody>
        </Panel>
      </div>
    </div>
  ),
};

export const CompletedWithBurst: Story = {
  render: () => <CompletedStory showBurst />,
};

export const CompletedWithoutBurst: Story = {
  render: () => <CompletedStory />,
};

function HostStory({scenario, host}: {scenario: Scenario; host: 'panel' | 'indicator'}) {
  return (
    <StoryProviders scenario={scenario} workspace={WORKSPACE}>
      <div className="min-h-[240px] bg-background-subtle-base p-frame">
        <div className="mx-auto flex w-full max-w-[480px] flex-col gap-group">
          {host === 'panel' ? (
            <WorkspaceSetupChecklist workspace={WORKSPACE} />
          ) : (
            <div className="flex justify-end border-b border-border-neutral-base bg-background-neutral-base p-row">
              <WorkspaceSetupIndicator workspace={WORKSPACE} />
            </div>
          )}
        </div>
      </div>
    </StoryProviders>
  );
}

/**
 * The panel opens collapsed, so the expanded list needs its own workspace: a
 * shared one would leak the persisted expansion into the collapsed stories.
 */
function ExpandedPanelStory() {
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    setWorkspaceSetupChecklistExpanded(EXPANDED_WORKSPACE.id, true);
    setInitialized(true);
    return () => setWorkspaceSetupChecklistExpanded(EXPANDED_WORKSPACE.id, false);
  }, []);

  return (
    <StoryProviders scenario="self-hosted" workspace={EXPANDED_WORKSPACE}>
      <div className="min-h-[240px] bg-background-subtle-base p-frame">
        <div className="mx-auto w-full max-w-[480px]">
          {initialized ? <WorkspaceSetupChecklist workspace={EXPANDED_WORKSPACE} /> : null}
        </div>
      </div>
    </StoryProviders>
  );
}

function CompletedStory({showBurst = false}: {showBurst?: boolean}) {
  return (
    <StoryProviders scenario="complete" workspace={WORKSPACE}>
      <div className="min-h-[240px] bg-background-subtle-base p-frame">
        <div className="mx-auto w-full max-w-[480px]">
          <div className="overflow-hidden rounded-8 border border-border-neutral-base bg-background-neutral-base">
            <SetupChecklistBody
              checklist={completeChecklist}
              workspaceSlug={WORKSPACE.slug}
              completion
              showBurst={showBurst}
            />
          </div>
        </div>
      </div>
    </StoryProviders>
  );
}

function DismissedStory() {
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    dismissWorkspaceSetupChecklist(DISMISSED_WORKSPACE.id);
    setInitialized(true);
    return () => clearWorkspaceSetupChecklistDismissal(DISMISSED_WORKSPACE.id);
  }, []);

  return (
    <StoryProviders scenario="cloud" workspace={DISMISSED_WORKSPACE}>
      <div className="min-h-[240px] bg-background-subtle-base p-frame">
        {initialized ? <WorkspaceSetupChecklist workspace={DISMISSED_WORKSPACE} /> : null}
      </div>
    </StoryProviders>
  );
}

type Scenario = 'attention' | 'cloud' | 'complete' | 'self-hosted';

function StoryProviders({
  scenario,
  workspace,
  children,
}: {
  scenario: Scenario;
  workspace: WorkspaceReference;
  children: ReactNode;
}) {
  const queryClient = useMemo(
    () => createScenarioQueryClient(scenario, workspace),
    [scenario, workspace],
  );
  const router = useMemo(() => createStoryRouter(children), [children]);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

function createScenarioQueryClient(scenario: Scenario, workspace: WorkspaceReference) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const cloud = scenario === 'cloud' || scenario === 'complete';
  const attention = scenario === 'attention';
  const providers = attention ? [githubProvider, linearProvider] : [githubProvider];
  const connections = attention ? [githubConnection, disabledLinearConnection] : [githubConnection];
  const runnerResponse = {
    provisioners: [],
    installationRunners: cloud ? ('managed' as const) : ('none' as const),
  };
  const catalog = {
    providers: [],
    workspaceProviders: 'enabled' as const,
    managedProviderId: cloud ? 'managed-default' : null,
    instanceDefaultProviderId: null,
  };

  queryClient.setQueryData(integrationProvidersQueryOptions().queryKey, providers);
  queryClient.setQueryData(integrationConnectionsQueryOptions(workspace.id).queryKey, connections);
  queryClient.setQueryData(provisionerTokenQueryKeys.active(workspace.id), runnerResponse);
  queryClient.setQueryData(modelProviderQueryKeys.catalog(), catalog);
  queryClient.setQueryData(modelProviderQueryKeys.configs(workspace.id), {
    configs: [],
    defaultHarnessId: null,
    defaultProviderId: null,
  });
  queryClient.setQueryData(listMembersQueryKey(workspace.id), [
    {
      id: 'member-1',
      userId: 'user-1',
      workspaceId: workspace.id,
      email: 'you@example.com',
      name: 'You',
      role: 'admin' as const,
      joinedAt: now,
      updatedAt: now,
    },
  ]);
  queryClient.setQueryData(listInvitationsQueryKey(workspace.id), []);

  return queryClient;
}

function createStoryRouter(children: ReactNode) {
  const rootRoute = createRootRoute({component: Outlet});
  const routes = [
    '/w/$workspaceSlug',
    '/w/$workspaceSlug/settings/integrations',
    '/w/$workspaceSlug/settings/runners',
    '/w/$workspaceSlug/settings/agents',
    '/w/$workspaceSlug/settings/members',
  ].map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => children,
    }),
  );

  return createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({initialEntries: ['/w/acme']}),
  });
}
