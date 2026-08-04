import {
  clearJiraInstallWorkspace,
  JIRA_INSTALL_WORKSPACE_KEY,
  parseJiraCallbackQuery,
  readJiraInstallWorkspace,
  saveJiraInstallWorkspace,
  serializeJiraCallbackQuery,
} from './jira-callback.js';

describe('Jira callback helpers', () => {
  it('parses and serializes success and provider-error callback queries', () => {
    const success = parseJiraCallbackQuery({code: 'grant code', state: 'signed state'});
    const providerError = parseJiraCallbackQuery({
      error: 'access_denied',
      error_description: 'User denied access',
      state: 'signed state',
    });

    expect(success).toEqual({code: 'grant code', state: 'signed state'});
    expect(providerError).toEqual({
      error: 'access_denied',
      error_description: 'User denied access',
      state: 'signed state',
    });
    expect(success && serializeJiraCallbackQuery(success)).toBe(
      'code=grant+code&state=signed+state',
    );
    expect(providerError && serializeJiraCallbackQuery(providerError)).toBe(
      'error=access_denied&error_description=User+denied+access&state=signed+state',
    );
  });

  it('rejects malformed callback queries and prefers a grant code', () => {
    expect(parseJiraCallbackQuery({code: 'grant'})).toBeUndefined();
    expect(parseJiraCallbackQuery({state: 'signed'})).toBeUndefined();
    expect(parseJiraCallbackQuery({error: 'access_denied'})).toBeUndefined();
    expect(parseJiraCallbackQuery({state: ['a', 'b']})).toBeUndefined();
    expect(
      parseJiraCallbackQuery({
        code: 'grant',
        error: 'access_denied',
        state: 'signed',
      }),
    ).toEqual({code: 'grant', state: 'signed'});
  });

  it('round-trips workspace navigation storage and swallows storage errors', () => {
    const storage = new Map<string, string>();
    const workspaceStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    };

    saveJiraInstallWorkspace(workspaceStorage, 'workspace-1');
    expect(storage.get(JIRA_INSTALL_WORKSPACE_KEY)).toBe('workspace-1');
    expect(readJiraInstallWorkspace(workspaceStorage)).toBe('workspace-1');
    clearJiraInstallWorkspace(workspaceStorage);
    expect(readJiraInstallWorkspace(workspaceStorage)).toBeUndefined();

    const unavailableStorage = {
      getItem: () => {
        throw new Error('unavailable');
      },
      setItem: () => {
        throw new Error('unavailable');
      },
      removeItem: () => {
        throw new Error('unavailable');
      },
    };
    expect(() => saveJiraInstallWorkspace(unavailableStorage, 'workspace-1')).not.toThrow();
    expect(() => readJiraInstallWorkspace(unavailableStorage)).not.toThrow();
    expect(() => clearJiraInstallWorkspace(unavailableStorage)).not.toThrow();
  });
});
