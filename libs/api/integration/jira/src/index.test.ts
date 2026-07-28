import {createJiraIntegrationProvider} from '#index.js';

describe('createJiraIntegrationProvider', () => {
  it('creates the Jira provider', () => {
    const provider = createJiraIntegrationProvider();

    expect(provider).toMatchObject({
      provider: 'jira',
      displayName: 'Jira',
      adapters: {},
      routes: [],
    });
  });

  it('rejects incomplete receiver wiring instead of mounting registration without a receiver', () => {
    expect(() =>
      createJiraIntegrationProvider({
        routes: {tokenStore: {} as never} as never,
      }),
    ).toThrow('requires all webhook receiver dependencies');
  });
});
