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

  it('rejects incomplete receiver wiring instead of mounting registration without a receiver', () => {
    expect(() =>
      createJiraIntegrationProvider({
        routes: {tokenStore: {} as never} as never,
      }),
    ).toThrow('requires all webhook receiver dependencies');
  });
});

describe('createJiraMaintenanceWorker', () => {
  it('describes the Jira proactive token refresh worker', () => {
    const worker = createJiraMaintenanceWorker({
      tokenStore: {getAccessToken: vi.fn()},
      resolveConnection: vi.fn(),
    });

    expect(worker.taskQueue).toBe('integrations-jira-maintenance');
    expect(worker.workflowsPath.endsWith('dist/temporal/workflows/index.js')).toBe(true);
    expect(Object.keys(worker.activities({outboxRegistry: createOutboxRegistry()}))).toContain(
      'refreshJiraTokensActivity',
    );
    expect(worker.workflows).toEqual([
      {
        name: 'refreshJiraTokensCron',
        id: 'jira-refresh-tokens',
        cronSchedule: '0 */6 * * *',
      },
    ]);
  });
});
