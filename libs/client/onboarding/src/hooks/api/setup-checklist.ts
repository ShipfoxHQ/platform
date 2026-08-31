import {
  modelProviderCatalogQueryOptions,
  modelProviderConfigsQueryOptions,
} from '@shipfox/client-agent';
import {
  integrationConnectionsQueryOptions,
  integrationProvidersQueryOptions,
} from '@shipfox/client-integrations';
import {
  activeProvisionersQueryOptions,
  installationRunnersStatusQueryOptions,
} from '@shipfox/client-runners';
import {
  listInvitationsQueryOptions,
  listMembersQueryOptions,
} from '@shipfox/client-workspace-settings';
import {useQuery} from '@tanstack/react-query';
import {deriveIntegrationReadiness} from '#core/integration-readiness.js';
import {
  deriveSetupChecklist,
  type SetupChecklist,
  type SetupChecklistItemId,
} from '#core/setup-checklist.js';

const CHECKLIST_STALE_TIME_MS = 5 * 60 * 1000;

export interface ChecklistQueryState {
  checklist: SetupChecklist;
  baseSettled: boolean;
  completionReady: boolean;
}

/**
 * Composes the server state needed by both checklist hosts. Keeping this hook
 * in the API adapter boundary gives each query family one shared cache policy
 * while allowing dismissed hosts to remain unsubscribed.
 */
export function useSetupChecklistQueryState(
  workspaceId: string,
  subscribed: boolean,
): ChecklistQueryState {
  const queryEnabled = shouldEnableChecklistQueries(subscribed, workspaceId);
  const queryPolicy = {
    enabled: queryEnabled,
    subscribed: queryEnabled,
    refetchInterval: false,
    retry: false,
    staleTime: CHECKLIST_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  } as const;

  const providersQuery = useQuery({
    ...integrationProvidersQueryOptions(),
    ...queryPolicy,
  });
  const connectionsQuery = useQuery({
    ...integrationConnectionsQueryOptions(workspaceId),
    ...queryPolicy,
  });
  const activeProvisionersQuery = useQuery({
    ...activeProvisionersQueryOptions(workspaceId),
    ...queryPolicy,
  });
  const runnersStatusQuery = useQuery({
    ...installationRunnersStatusQueryOptions(workspaceId),
    ...queryPolicy,
  });
  const catalogQuery = useQuery({
    ...modelProviderCatalogQueryOptions(),
    ...queryPolicy,
  });
  const configsQuery = useQuery({
    ...modelProviderConfigsQueryOptions(workspaceId),
    ...queryPolicy,
  });
  const membersQuery = useQuery({
    ...listMembersQueryOptions(workspaceId),
    ...queryPolicy,
  });
  const invitationsQuery = useQuery({
    ...listInvitationsQueryOptions(workspaceId),
    ...queryPolicy,
  });

  const baseSettled = isSettled(providersQuery) && isSettled(connectionsQuery);
  const runnerSettled = isSettled(activeProvisionersQuery) && isSettled(runnersStatusQuery);
  const runnerReady = activeProvisionersQuery.isSuccess && runnersStatusQuery.isSuccess;
  const catalogInstallationProvided = hasInstallationProvider(catalogQuery.data);
  const modelReady = catalogQuery.isSuccess && configsQuery.isSuccess;
  const membersReady = membersQuery.isSuccess && invitationsQuery.isSuccess;
  const modelSettled = isSettled(catalogQuery) && isSettled(configsQuery);
  const membersSettled = isSettled(membersQuery) && isSettled(invitationsQuery);
  const completionReady = allChecklistQueriesReady({
    providersReady: providersQuery.isSuccess,
    connectionsReady: connectionsQuery.isSuccess,
    runnerSettled,
    modelSettled,
    membersSettled,
  });

  const rawChecklist = deriveSetupChecklist({
    readiness: deriveIntegrationReadiness({
      providers: providersQuery.data ?? [],
      connections: connectionsQuery.data ?? [],
    }),
    installationRunners: runnersStatusQuery.data ?? 'managed',
    workspaceRunnerCapacity: (activeProvisionersQuery.data?.length ?? 0) > 0,
    modelProvider: {
      installationProvided: installationProviderReadiness(
        catalogQuery.isSuccess,
        catalogInstallationProvided,
      ),
      configured: (configsQuery.data?.configs.length ?? 0) > 0,
    },
    membership: {
      memberCount: membersQuery.data?.length ?? 0,
      pendingInvitationCount: invitationsQuery.data?.length ?? 0,
    },
  });

  const hiddenRows = hiddenChecklistRows({
    providersReady: providersQuery.isSuccess,
    connectionsReady: connectionsQuery.isSuccess,
    runnerReady,
    modelReady,
    membersReady,
  });

  const items = rawChecklist.items.filter((item) => !hiddenRows.has(item.id));
  const trackedItems = items.filter((item) => item.tracked);
  const openCount = trackedItems.filter((item) => item.status === 'open').length;

  return {
    baseSettled,
    completionReady,
    checklist: {
      items,
      openCount,
      trackedCount: trackedItems.length,
      complete: completionReady && openCount === 0,
    },
  };
}

function hiddenChecklistRows(readiness: {
  providersReady: boolean;
  connectionsReady: boolean;
  runnerReady: boolean;
  modelReady: boolean;
  membersReady: boolean;
}): Set<SetupChecklistItemId> {
  const hiddenRows = new Set<SetupChecklistItemId>();
  if (!readiness.providersReady || !readiness.connectionsReady) hiddenRows.add('tools');
  if (!readiness.runnerReady) hiddenRows.add('runner');
  if (!readiness.modelReady) hiddenRows.add('model-provider');
  if (!readiness.membersReady) hiddenRows.add('teammates');
  return hiddenRows;
}

function hasInstallationProvider(
  catalog: {managedProviderId: string | null; instanceDefaultProviderId: string | null} | undefined,
): boolean {
  if (catalog === undefined) return false;
  return catalog.managedProviderId !== null || catalog.instanceDefaultProviderId !== null;
}

function allChecklistQueriesReady(readiness: {
  providersReady: boolean;
  connectionsReady: boolean;
  runnerSettled: boolean;
  modelSettled: boolean;
  membersSettled: boolean;
}): boolean {
  return (
    readiness.providersReady &&
    readiness.connectionsReady &&
    readiness.runnerSettled &&
    readiness.modelSettled &&
    readiness.membersSettled
  );
}

function installationProviderReadiness(
  catalogReady: boolean,
  installationProvided: boolean,
): boolean {
  if (!catalogReady) return true;
  return installationProvided;
}

function isSettled(query: {isError: boolean; isSuccess: boolean}) {
  return query.isSuccess || query.isError;
}

function shouldEnableChecklistQueries(subscribed: boolean, workspaceId: string): boolean {
  return subscribed && Boolean(workspaceId);
}
