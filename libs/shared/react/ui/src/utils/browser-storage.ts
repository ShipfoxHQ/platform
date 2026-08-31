export interface BrowserStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BrowserStorageKey<T> {
  /** Stable browser-storage key. */
  key: string;
  /** How long this value may remain useful: session or persistent. */
  lifetime: 'session' | 'persistent';
  /** Who may reuse it: global, workspace, or authenticated principal. */
  principalScope: 'global' | 'workspace' | 'principal';
  serialize(value: T): string;
  parse(value: string): T | undefined;
}

/** The validated identity used to derive a non-global browser-storage key. */
export type BrowserStorageScope = {principalId: string} | {workspaceId: string};

export type BrowserStorageScopeProvider<Scope extends BrowserStorageScope = BrowserStorageScope> =
  () => Scope | undefined;

const BROWSER_STORAGE_SCOPE_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u;

export interface TypedBrowserStorage<T> {
  read(): T | undefined;
  write(value: T): void;
  remove(): void;
}

export function createTypedBrowserStorage<T>(
  getStorage: () => BrowserStorage | undefined,
  definition: BrowserStorageKey<T> & {principalScope: 'global'},
): TypedBrowserStorage<T>;
export function createTypedBrowserStorage<T>(
  getStorage: () => BrowserStorage | undefined,
  definition: BrowserStorageKey<T> & {principalScope: 'workspace'},
  scope: {workspaceId: string} | BrowserStorageScopeProvider<{workspaceId: string}>,
): TypedBrowserStorage<T>;
export function createTypedBrowserStorage<T>(
  getStorage: () => BrowserStorage | undefined,
  definition: BrowserStorageKey<T> & {principalScope: 'principal'},
  scope: {principalId: string} | BrowserStorageScopeProvider<{principalId: string}>,
): TypedBrowserStorage<T>;

/**
 * Best-effort storage for non-authoritative browser preferences and recovery hints.
 * Reads validate untrusted persisted text, and every storage exception degrades to
 * an absent value so privacy mode, quota failures, and missing scopes never
 * interrupt user flows. Non-global keys are derived from their validated scope.
 */
export function createTypedBrowserStorage<T>(
  getStorage: () => BrowserStorage | undefined,
  definition: BrowserStorageKey<T>,
  scope?: BrowserStorageScope | BrowserStorageScopeProvider,
): TypedBrowserStorage<T> {
  const resolveKey = () => resolveBrowserStorageKey(definition, scope);

  return {
    read() {
      try {
        const key = resolveKey();
        if (!key) return undefined;
        const raw = getStorage()?.getItem(key);
        return raw === null || raw === undefined ? undefined : definition.parse(raw);
      } catch {
        return undefined;
      }
    },
    write(value) {
      try {
        const key = resolveKey();
        if (!key) return;
        getStorage()?.setItem(key, definition.serialize(value));
      } catch {
        // Persistence is intentionally non-authoritative.
      }
    },
    remove() {
      try {
        const key = resolveKey();
        if (!key) return;
        getStorage()?.removeItem(key);
      } catch {
        // Persistence is intentionally non-authoritative.
      }
    },
  };
}

function resolveBrowserStorageKey<T>(
  definition: BrowserStorageKey<T>,
  scope: BrowserStorageScope | BrowserStorageScopeProvider | undefined,
): string | undefined {
  if (definition.principalScope === 'global') return definition.key;

  const resolvedScope = typeof scope === 'function' ? scope() : scope;
  let scopeId: string | undefined;
  if (definition.principalScope === 'principal') {
    if (resolvedScope && 'principalId' in resolvedScope) scopeId = resolvedScope.principalId;
  } else if (resolvedScope && 'workspaceId' in resolvedScope) scopeId = resolvedScope.workspaceId;

  if (!isValidBrowserStorageScopeId(scopeId)) return undefined;
  return `${definition.key}.${definition.principalScope}.${encodeURIComponent(scopeId)}`;
}

function isValidBrowserStorageScopeId(value: string | undefined): value is string {
  return value !== undefined && BROWSER_STORAGE_SCOPE_ID.test(value);
}

export function localStorageOrUndefined(): BrowserStorage | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function sessionStorageOrUndefined(): BrowserStorage | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}
