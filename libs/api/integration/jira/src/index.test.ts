import {createOutboxRegistry} from '@shipfox/node-module';
import {createJiraIntegrationProvider} from '#index.js';
import {createJiraMaintenanceWorker} from '#temporal/worker.js';

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

  it('mounts the in-process agent-tools adapter and advertises its capability', () => {
    const getAccessToken = vi.fn().mockResolvedValue('access-token');
    const provider = createJiraIntegrationProvider({
      agentTools: {tokenStore: {getAccessToken}},
    });

    expect(provider.adapters.agent_tools).toBeDefined();
    expect(provider.routes).toEqual([]);
  });

  it('rejects incomplete receiver wiring instead of mounting registration without a receiver', () => {
    expect(() =>
      createJiraIntegrationProvider({
        routes: {tokenStore: {} as never} as never,
      }),
    ).toThrow('requires all webhook receiver dependencies');
  });

  it('exposes explicit connection cleanup without requiring routes', () => {
    const deleteConnectionRecords = vi.fn(() => Promise.resolve());
    const deleteConnectionRemoteResources = vi.fn(() => Promise.resolve(undefined));
    const deleteConnectionSecrets = vi.fn(() => Promise.resolve());
    const provider = createJiraIntegrationProvider({
      cleanup: {
        deleteConnectionRemoteResources,
        deleteConnectionRecords,
        deleteConnectionSecrets,
      },
    });

    expect(provider.deleteConnectionRemoteResources).toBe(deleteConnectionRemoteResources);
    expect(provider.deleteConnectionRecords).toBe(deleteConnectionRecords);
    expect(provider.deleteConnectionSecrets).toBe(deleteConnectionSecrets);
  });
});

describe('createJiraMaintenanceWorker', () => {
  it('describes the Jira proactive token refresh worker', () => {
    const worker = createJiraMaintenanceWorker({
      tokenStore: {getAccessToken: vi.fn()},
      jira: {
        refreshDynamicWebhooks: vi.fn(),
        registerDynamicWebhook: vi.fn(),
        deleteDynamicWebhook: vi.fn(),
      },
      webhookUrlForConnection: (connectionId) => `https://example.test/${connectionId}`,
      resolveConnection: vi.fn(),
    });

    expect(worker.taskQueue).toBe('integrations-jira-maintenance');
    expect(worker.workflowsPath.endsWith('dist/temporal/workflows/index.js')).toBe(true);
    expect(Object.keys(worker.activities({outboxRegistry: createOutboxRegistry()}))).toContain(
      'refreshJiraTokensActivity',
    );
    expect(Object.keys(worker.activities({outboxRegistry: createOutboxRegistry()}))).toContain(
      'renewJiraWebhooksActivity',
    );
    expect(worker.workflows).toEqual([
      {
        name: 'refreshJiraTokensCron',
        id: 'jira-refresh-tokens',
        cronSchedule: '0 */6 * * *',
      },
      {
        name: 'renewJiraWebhooksCron',
        id: 'jira-renew-webhooks',
        cronSchedule: '0 */6 * * *',
      },
    ]);
  });
});
