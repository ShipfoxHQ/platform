import type {LinearCallbackQueryDto} from '@shipfox/api-integration-linear-dto';
import {ApiError} from '@shipfox/client-api';
import {
  type BrowserStorage,
  type BrowserStorageKey,
  createTypedBrowserStorage,
} from '@shipfox/client-ui';

export const LINEAR_INSTALL_WORKSPACE_KEY = 'shipfox.linear-install.workspace-id';

type WorkspaceStorage = BrowserStorage | undefined;

const linearInstallWorkspaceStorageKey = {
  key: LINEAR_INSTALL_WORKSPACE_KEY,
  lifetime: 'session',
  // This is a one-shot navigation hint, not private workspace state. It must
  // remain readable on an OAuth callback before workspace hydration completes;
  // the callback state and returned connection are the authoritative checks.
  principalScope: 'global',
  serialize: (workspaceId: string) => workspaceId,
  parse: (value: string) => value || undefined,
} satisfies BrowserStorageKey<string>;

export function saveLinearInstallWorkspace(storage: WorkspaceStorage, workspaceId: string): void {
  installWorkspaceStorage(storage).write(workspaceId);
}

export function readLinearInstallWorkspace(storage: WorkspaceStorage): string | undefined {
  return installWorkspaceStorage(storage).read();
}

export function clearLinearInstallWorkspace(storage: WorkspaceStorage): void {
  installWorkspaceStorage(storage).remove();
}

function installWorkspaceStorage(storage: WorkspaceStorage) {
  return createTypedBrowserStorage(() => storage, linearInstallWorkspaceStorageKey);
}

export function parseLinearCallbackQuery(
  search: Record<string, unknown>,
): LinearCallbackQueryDto | undefined {
  const state = stringParam(search.state);
  if (!state) return undefined;

  const code = stringParam(search.code);
  if (code) return {code, state};

  const error = stringParam(search.error);
  if (!error) return undefined;
  const errorDescription = stringParam(search.error_description);
  return errorDescription ? {error, error_description: errorDescription, state} : {error, state};
}

export function serializeLinearCallbackQuery(query: LinearCallbackQueryDto): string {
  const params = new URLSearchParams();
  if ('code' in query) params.set('code', query.code);
  else {
    params.set('error', query.error);
    if (query.error_description) params.set('error_description', query.error_description);
  }
  params.set('state', query.state);
  return params.toString();
}

export type LinearCallbackFailure = {
  title?: string;
  message: string;
  startOver: boolean;
  signIn: boolean;
};

export function classifyLinearCallbackError(error: unknown): LinearCallbackFailure {
  if (error instanceof ApiError) return classifyLinearApiError(error);
  return {
    message: 'Could not complete the Linear install. Start again from workspace settings.',
    startOver: true,
    signIn: false,
  };
}

function classifyLinearApiError(error: ApiError): LinearCallbackFailure {
  switch (error.code) {
    case 'invalid-linear-install-state':
      return {
        title: 'Linear install link expired',
        message: 'Linear install link expired. Start again from workspace settings.',
        startOver: true,
        signIn: false,
      };
    case 'linear-install-state-actor-mismatch':
    case 'unauthorized':
      return {
        title: 'Different Shipfox account',
        message: 'Different Shipfox account. Sign in with the account that started this install.',
        startOver: true,
        signIn: true,
      };
    case 'linear-installation-already-linked':
    case 'linear-connection-already-linked':
      return {
        title: 'Linear already linked',
        message: 'This Linear organization is already linked to another workspace.',
        startOver: false,
        signIn: false,
      };
    case 'linear-authorization-scope-mismatch':
    case 'linear-oauth-callback-error':
      return {
        title: 'Linear permissions needed',
        message:
          'Linear did not authorize the permissions Shipfox needs. Review the Linear consent and start again.',
        startOver: true,
        signIn: false,
      };
    case 'network-error':
      return {
        message: 'Could not reach Shipfox. Check your connection and start again.',
        startOver: true,
        signIn: false,
      };
    case 'provider-unavailable':
    case 'timeout':
    case 'rate-limited':
      return {
        message: 'Linear is temporarily unavailable. Start a new install when it is available.',
        startOver: true,
        signIn: false,
      };
  }
  if (error.status === 0) {
    return {
      message: 'Could not reach Shipfox. Check your connection and start again.',
      startOver: true,
      signIn: false,
    };
  }
  if (error.status >= 500 || error.status === 429) {
    return {
      message: 'Linear is temporarily unavailable. Start a new install when it is available.',
      startOver: true,
      signIn: false,
    };
  }
  return {
    message: 'Could not complete the Linear install. Start again from workspace settings.',
    startOver: true,
    signIn: false,
  };
}

function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
