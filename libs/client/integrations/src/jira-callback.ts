import type {JiraCallbackQueryDto} from '@shipfox/api-integration-jira-dto';
import {
  type BrowserStorage,
  type BrowserStorageKey,
  createTypedBrowserStorage,
} from '@shipfox/client-ui';

export const JIRA_INSTALL_WORKSPACE_KEY = 'shipfox.jira-install.workspace-id';

type WorkspaceStorage = BrowserStorage | undefined;

const jiraInstallWorkspaceStorageKey = {
  key: JIRA_INSTALL_WORKSPACE_KEY,
  lifetime: 'session',
  // This is a one-shot navigation hint, not private workspace state. It must
  // remain readable on an OAuth callback before workspace hydration completes;
  // the signed callback state and returned connection are authoritative.
  principalScope: 'global',
  serialize: (workspaceId: string) => workspaceId,
  parse: (value: string) => value || undefined,
} satisfies BrowserStorageKey<string>;

export function saveJiraInstallWorkspace(storage: WorkspaceStorage, workspaceId: string): void {
  installWorkspaceStorage(storage).write(workspaceId);
}

export function readJiraInstallWorkspace(storage: WorkspaceStorage): string | undefined {
  return installWorkspaceStorage(storage).read();
}

export function clearJiraInstallWorkspace(storage: WorkspaceStorage): void {
  installWorkspaceStorage(storage).remove();
}

function installWorkspaceStorage(storage: WorkspaceStorage) {
  return createTypedBrowserStorage(() => storage, jiraInstallWorkspaceStorageKey);
}

export function parseJiraCallbackQuery(
  search: Record<string, unknown>,
): JiraCallbackQueryDto | undefined {
  const state = stringParam(search.state);
  if (!state) return undefined;

  const code = stringParam(search.code);
  if (code) return {code, state};

  const error = stringParam(search.error);
  if (!error) return undefined;
  const errorDescription = stringParam(search.error_description);
  return errorDescription ? {error, error_description: errorDescription, state} : {error, state};
}

export function serializeJiraCallbackQuery(query: JiraCallbackQueryDto): string {
  const params = new URLSearchParams();
  if ('code' in query) params.set('code', query.code);
  else {
    params.set('error', query.error);
    if (query.error_description) params.set('error_description', query.error_description);
  }
  params.set('state', query.state);
  return params.toString();
}

function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
