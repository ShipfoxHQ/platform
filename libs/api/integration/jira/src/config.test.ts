const jiraEnvNames = [
  'JIRA_OAUTH_CLIENT_ID',
  'JIRA_OAUTH_CLIENT_SECRET',
  'JIRA_OAUTH_REDIRECT_URL',
  'JIRA_WEBHOOK_BASE_URL',
] as const;

describe('jira config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('exports validated Jira config with the default API and auth URLs', async () => {
    vi.stubEnv('JIRA_API_BASE_URL', undefined);
    vi.stubEnv('JIRA_AUTH_BASE_URL', undefined);
    vi.resetModules();

    const {config} = await import('#index.js');

    for (const name of jiraEnvNames) expect(config[name]).toBe(process.env[name]);
    expect(config.JIRA_API_BASE_URL).toBe('https://api.atlassian.com');
    expect(config.JIRA_AUTH_BASE_URL).toBe('https://auth.atlassian.com');
  });

  it('accepts compatible Jira API and auth URL overrides', async () => {
    vi.stubEnv('JIRA_API_BASE_URL', 'https://jira-api.example.test');
    vi.stubEnv('JIRA_AUTH_BASE_URL', 'https://jira-auth.example.test');
    vi.resetModules();

    const {config} = await import('#index.js');

    expect(config.JIRA_API_BASE_URL).toBe('https://jira-api.example.test');
    expect(config.JIRA_AUTH_BASE_URL).toBe('https://jira-auth.example.test');
  });
});
