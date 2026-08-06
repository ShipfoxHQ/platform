import {log, proxyActivities} from '@temporalio/workflow';
import type {createJiraMaintenanceActivities} from '../activities/index.js';

const {renewJiraWebhooksActivity} = proxyActivities<
  ReturnType<typeof createJiraMaintenanceActivities>
>({
  startToCloseTimeout: '5 minutes',
  heartbeatTimeout: '1 minute',
  retry: {maximumAttempts: 1},
});

export async function renewJiraWebhooksCron(): Promise<void> {
  const result = await renewJiraWebhooksActivity();
  if (result.renewed > 0 || result.reregistered > 0 || result.failed > 0) {
    log.info('Completed Jira webhook renewal', {...result});
  }
}
