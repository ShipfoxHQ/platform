import {ApiError} from '@shipfox/client-api';
import {
  type BrowserStorage,
  type BrowserStorageKey,
  createTypedBrowserStorage,
} from '@shipfox/client-ui';

export const SENTRY_INSTALL_WORKSPACE_KEY = 'shipfox.sentry-install.workspace-id';

type WorkspaceStorage = BrowserStorage | undefined;

const sentryInstallWorkspaceStorageKey = {
  key: SENTRY_INSTALL_WORKSPACE_KEY,
  lifetime: 'session',
  // This is a one-shot navigation hint, not private workspace state. The
  // callback validates it against the authenticated workspace list before use.
  principalScope: 'global',
  serialize: (workspaceId: string) => workspaceId,
  parse: (value: string) => value || undefined,
} satisfies BrowserStorageKey<string>;

// Storage helpers swallow failures (quota, private mode, disabled storage):
// the handoff is an optimization, never a requirement: the callback always
// asks for explicit confirmation and only uses the stored id to pre-select.
export function saveSentryInstallWorkspace(storage: WorkspaceStorage, workspaceId: string): void {
  installWorkspaceStorage(storage).write(workspaceId);
}

export function readSentryInstallWorkspace(storage: WorkspaceStorage): string | undefined {
  return installWorkspaceStorage(storage).read();
}

export function clearSentryInstallWorkspace(storage: WorkspaceStorage): void {
  installWorkspaceStorage(storage).remove();
}

function installWorkspaceStorage(storage: WorkspaceStorage) {
  return createTypedBrowserStorage(() => storage, sentryInstallWorkspaceStorageKey);
}

export interface SentryCallbackParams {
  code: string;
  installationId: string;
  /** Display-only: rendered in the confirm copy, never sent to the API. */
  orgSlug?: string | undefined;
}

export function parseSentryCallbackParams(
  search: Record<string, unknown>,
): SentryCallbackParams | undefined {
  const code = stringParam(search.code);
  // Sentry documents camelCase params; accept snake_case defensively.
  const installationId = stringParam(search.installationId) ?? stringParam(search.installation_id);
  if (!code || !installationId) return undefined;

  const orgSlug = stringParam(search.orgSlug) ?? stringParam(search.org_slug);
  return {code, installationId, orgSlug};
}

export interface SentryWorkspaceOption {
  id: string;
  name: string;
}

export type SentryWorkspacePreselection =
  | {kind: 'pick'; preselectedId: string | undefined}
  | {kind: 'none'};

// Sentry's redirect carries no state token, so the callback can never prove it
// belongs to an install the user started. Installation always requires an
// explicit click. The stored id (and a sole workspace) only pre-select.
export function preselectSentryWorkspace(
  storedId: string | undefined,
  workspaces: SentryWorkspaceOption[],
): SentryWorkspacePreselection {
  if (workspaces.length === 0) return {kind: 'none'};
  if (storedId && workspaces.some((workspace) => workspace.id === storedId)) {
    return {kind: 'pick', preselectedId: storedId};
  }
  if (workspaces.length === 1) return {kind: 'pick', preselectedId: workspaces[0]?.id};
  return {kind: 'pick', preselectedId: undefined};
}

export type SentryConnectFailure =
  | {kind: 'retryable'; message: string; retryAfterSeconds?: number | undefined}
  | {kind: 'terminal'; message: string; startOver: boolean};

export function classifySentryConnectError(error: unknown): SentryConnectFailure {
  if (error instanceof ApiError) {
    if (error.code === 'sentry-installation-already-linked') {
      return {
        kind: 'terminal',
        message: 'This Sentry org is already installed in another workspace.',
        // Retrying or starting over would fail identically.
        startOver: false,
      };
    }
    if (error.code === 'sentry-verification-in-progress') {
      // A concurrent signed webhook is still verifying the install. The grant code
      // is untouched, so the existing backoff re-calls and finds the verified row.
      return {
        kind: 'retryable',
        message: 'Finishing Sentry verification. This only takes a moment.',
        retryAfterSeconds: retryAfterSeconds(error.details),
      };
    }
    if (error.code === 'rate-limited') {
      return {
        kind: 'retryable',
        message: 'Sentry is rate limiting requests. Try again in a moment.',
        retryAfterSeconds: retryAfterSeconds(error.details),
      };
    }
    if (error.code === 'timeout' || error.code === 'provider-unavailable') {
      return {kind: 'retryable', message: 'Sentry is unreachable. Try again.'};
    }
    if (error.status === 0 || error.code === 'network-error') {
      // A network failure (the client transport reports status 0) never reached the
      // server, so the grant code is untouched and a plain Retry can recover.
      // Must precede the status < 500 branch, which would otherwise treat it as
      // a spent code and force a full restart.
      return {
        kind: 'retryable',
        message: 'Could not reach Shipfox. Check your connection and try again.',
      };
    }
    if (error.status < 500) {
      return {
        kind: 'terminal',
        message:
          'Sentry did not accept this install. Start the install again from workspace settings.',
        startOver: true,
      };
    }
  }
  return {kind: 'retryable', message: 'Could not install Sentry. Try again.'};
}

function retryAfterSeconds(details: unknown): number | undefined {
  // client-api's toApiError stores the whole response body as ApiError.details,
  // so the structured payload lives one level deeper at details.details (mirrors
  // project-error.ts apiDetails()).
  if (typeof details !== 'object' || details === null) return undefined;
  const inner = (details as Record<string, unknown>).details;
  if (typeof inner !== 'object' || inner === null) return undefined;
  const value = (inner as Record<string, unknown>).retry_after_seconds;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
