import {config} from '#config.js';

export const JIRA_WEBHOOK_ROUTE_PREFIX = '/webhooks/integrations/jira';

const TRAILING_SLASHES_RE = /\/+$/;

export function jiraWebhookUrl(connectionId: string): string {
  return `${config.JIRA_WEBHOOK_BASE_URL.replace(TRAILING_SLASHES_RE, '')}${JIRA_WEBHOOK_ROUTE_PREFIX}/${connectionId}`;
}
