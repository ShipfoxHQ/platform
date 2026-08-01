import {
  isModelProviderOnboardingDismissed,
  modelProviderConfigsQueryOptions,
} from '@shipfox/client-agent';
import {
  type IntegrationConnection,
  sourceConnectionsQueryOptions,
} from '@shipfox/client-integrations';
import {projectExistenceQueryOptions} from '@shipfox/client-projects';
import {
  userWorkspacesQueryOptions,
  WorkspaceSetupLoadError,
  type WorkspaceSetupState,
} from '@shipfox/client-shell/runtime';
import type {QueryClient} from '@tanstack/react-query';
import {redirect} from '@tanstack/react-router';

const TRAILING_SLASHES_RE = /\/+$/u;

export interface WorkspaceSetupRouteOptions {
  queryClient: QueryClient;
  workspaceId: string;
  workspaceSlug: string;
  pathname: string;
}

export async function loadWorkspaceSetupRoute({
  queryClient,
  workspaceId,
  workspaceSlug,
  pathname,
}: WorkspaceSetupRouteOptions): Promise<WorkspaceSetupState> {
  const workspace = await fetchWorkspaceSummary(queryClient, workspaceId);
  const workspaceStatus = workspace?.status;
  switch (workspaceStatus) {
    case undefined:
    case 'active':
      break;
    case 'suspended':
    case 'deleted':
      return {hideProjectNavigation: true, unavailable: true};
    default:
      return assertNever(workspaceStatus);
  }

  const projects = await fetchWorkspaceProjectExistence(queryClient, workspaceId);
  const normalizedPathname = normalizePath(pathname);

  if (projects.projects.length > 0) {
    if (isIntegrationsIndexPath(normalizedPathname, workspaceSlug)) {
      throw redirect({
        to: '/w/$workspaceSlug/settings/integrations',
        params: {workspaceSlug},
        replace: true,
      });
    }

    return {hideProjectNavigation: false};
  }

  const sourceConnections = await fetchWorkspaceSourceConnections(queryClient, workspaceId);
  const hasSourceConnection = sourceConnections.length > 0;

  if (!hasSourceConnection) {
    if (isIntegrationSetupPath(normalizedPathname, workspaceSlug)) {
      return {hideProjectNavigation: true};
    }

    throw redirect({
      to: '/w/$workspaceSlug/integrations',
      params: {workspaceSlug},
      replace: true,
    });
  }

  if (isAgentSettingsPath(normalizedPathname, workspaceSlug)) {
    return {hideProjectNavigation: true};
  }

  const providerHandled = await hasHandledModelProviderOnboarding(queryClient, workspaceId);
  if (!providerHandled) {
    if (isModelProviderOnboardingPath(normalizedPathname, workspaceSlug)) {
      return {hideProjectNavigation: true};
    }

    throw redirect({
      to: '/w/$workspaceSlug/model-provider',
      params: {workspaceSlug},
      replace: true,
    });
  }

  if (isProjectCreationPath(normalizedPathname, workspaceSlug)) {
    return {hideProjectNavigation: true};
  }

  throw redirect({
    to: '/w/$workspaceSlug/projects/new',
    params: {workspaceSlug},
    replace: true,
  });
}

function assertNever(value: never): never {
  throw new Error(`Unhandled workspace status: ${JSON.stringify(value)}`);
}

async function fetchWorkspaceSummary(queryClient: QueryClient, workspaceId: string) {
  try {
    const result = await queryClient.fetchQuery(userWorkspacesQueryOptions());
    return result.memberships.find((workspace) => workspace.id === workspaceId);
  } catch (error) {
    throw new WorkspaceSetupLoadError(error);
  }
}

async function fetchWorkspaceProjectExistence(queryClient: QueryClient, workspaceId: string) {
  const options = projectExistenceQueryOptions(workspaceId);

  try {
    return await queryClient.fetchQuery(options);
  } catch (error) {
    const cached = queryClient.getQueryData<{projects: unknown[]}>(options.queryKey);
    if (cached !== undefined) return cached;
    throw new WorkspaceSetupLoadError(error);
  }
}

async function fetchWorkspaceSourceConnections(queryClient: QueryClient, workspaceId: string) {
  const options = sourceConnectionsQueryOptions(workspaceId);

  try {
    return await queryClient.fetchQuery(options);
  } catch (error) {
    const cached = queryClient.getQueryData<IntegrationConnection[]>(options.queryKey);
    if (cached !== undefined) return cached;
    throw new WorkspaceSetupLoadError(error);
  }
}

async function hasHandledModelProviderOnboarding(
  queryClient: QueryClient,
  workspaceId: string,
): Promise<boolean> {
  if (isModelProviderOnboardingDismissed(workspaceId)) return true;

  const options = modelProviderConfigsQueryOptions(workspaceId);
  try {
    const configs = await queryClient.fetchQuery(options);
    return configs.configs.length > 0;
  } catch {
    const cached = queryClient.getQueryData<{configs: unknown[]}>(options.queryKey);
    return cached?.configs.length !== 0;
  }
}

function normalizePath(pathname: string) {
  if (pathname === '/') return pathname;
  return pathname.replace(TRAILING_SLASHES_RE, '');
}

function workspacePath(workspaceSlug: string, suffix: string) {
  return `/w/${workspaceSlug}${suffix}`;
}

function isIntegrationsIndexPath(pathname: string, workspaceSlug: string) {
  return pathname === workspacePath(workspaceSlug, '/integrations');
}

function isIntegrationSetupPath(pathname: string, workspaceSlug: string) {
  const basePath = workspacePath(workspaceSlug, '/integrations');
  return (
    pathname === basePath ||
    pathname.startsWith(`${basePath}/`) ||
    pathname === workspacePath(workspaceSlug, '/settings/integrations')
  );
}

function isProjectCreationPath(pathname: string, workspaceSlug: string) {
  return pathname === workspacePath(workspaceSlug, '/projects/new');
}

function isModelProviderOnboardingPath(pathname: string, workspaceSlug: string) {
  return pathname === workspacePath(workspaceSlug, '/model-provider');
}

function isAgentSettingsPath(pathname: string, workspaceSlug: string) {
  return pathname === workspacePath(workspaceSlug, '/settings/agents');
}
