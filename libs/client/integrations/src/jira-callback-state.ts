import {createSingleFlight} from '@shipfox/client-ui';
import type {IntegrationConnection} from '#core/models.js';
import type {JiraCallbackResult} from '#hooks/api/integrations.js';

export const JIRA_CALLBACK_CACHE_SIZE = 32;

export const jiraCallbackRequests = createSingleFlight<string, JiraCallbackResult>({
  maxTerminalResults: JIRA_CALLBACK_CACHE_SIZE,
});
export const jiraSiteSelectionRequests = createSingleFlight<string, IntegrationConnection>();
export const jiraCompletedConnections = new Map<string, IntegrationConnection>();
export const jiraToastedCallbacks = new Set<string>();

export function resetJiraCallbackState(): void {
  jiraCallbackRequests.clear();
  jiraSiteSelectionRequests.clear();
  jiraCompletedConnections.clear();
  jiraToastedCallbacks.clear();
}
