import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {ModuleWorker} from '@shipfox/node-module';
import {Context} from '@temporalio/activity';
import type {JiraApiClient} from '#api/client.js';
import type {JiraTokenStore} from '#core/tokens.js';
import {createJiraMaintenanceActivities} from '#temporal/activities/index.js';
import {JIRA_MAINTENANCE_TASK_QUEUE} from '#temporal/constants.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workflowsPath = resolve(packageRoot, 'dist/temporal/workflows/index.js');

export interface CreateJiraMaintenanceWorkerOptions {
  tokenStore: Pick<JiraTokenStore, 'getAccessToken'>;
  jira: Pick<
    JiraApiClient,
    'refreshDynamicWebhooks' | 'registerDynamicWebhook' | 'deleteDynamicWebhook'
  >;
  webhookUrlForConnection: (connectionId: string) => string;
  resolveConnection(
    connectionId: string,
  ): Promise<Pick<IntegrationConnection, 'lifecycleStatus'> | undefined>;
}

export function createJiraMaintenanceWorker(
  options: CreateJiraMaintenanceWorkerOptions,
): ModuleWorker {
  return {
    taskQueue: JIRA_MAINTENANCE_TASK_QUEUE,
    workflowsPath,
    activities: () =>
      createJiraMaintenanceActivities({
        ...options,
        heartbeat: () => Context.current().heartbeat(),
      }),
    workflows: [
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
    ],
  };
}
