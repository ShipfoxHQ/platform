import type {IntegrationEventCatalog} from '@shipfox/api-integration-core-dto';
import {
  linearAgentSessionWebhookEventNames,
  linearWebhookActions,
  linearWebhookResourceTypes,
} from './schemas/index.js';

const linearWebhookDocsUrl = 'https://linear.app/developers/webhooks';
const linearAgentInteractionDocsUrl = 'https://linear.app/developers/agent-interaction';

const resourceLabels = {
  Issue: 'issue',
  Comment: 'comment',
  IssueLabel: 'issue label',
  Project: 'project',
  Cycle: 'cycle',
} as const satisfies Record<(typeof linearWebhookResourceTypes)[number], string>;

const agentSessionDetails = {
  'agentSession.created': {
    summary: 'A Linear agent session is created.',
    emittedWhen: 'Linear creates an agent session after a user mentions or delegates to the app.',
  },
  'agentSession.prompted': {
    summary: 'A user adds a prompt to a Linear agent session.',
    emittedWhen: 'Linear sends an AgentSessionEvent webhook with the prompted action.',
  },
} as const satisfies Record<
  (typeof linearAgentSessionWebhookEventNames)[number],
  {
    summary: string;
    emittedWhen: string;
  }
>;

export const linearEventCatalog = {
  provider: 'Linear',
  events: [
    ...linearWebhookResourceTypes.flatMap((type) =>
      linearWebhookActions.map((action) => ({
        name: `${type}.${action}`,
        summary: dataEventSummary(resourceLabels[type], action),
        emittedWhen: `Linear sends a webhook for ${type} with the ${action} action.`,
        payloadKind: 'raw-provider' as const,
        payloadDocUrl: linearWebhookDocsUrl,
      })),
    ),
    ...linearAgentSessionWebhookEventNames.map((name) => ({
      name,
      ...agentSessionDetails[name],
      payloadKind: 'raw-provider' as const,
      payloadDocUrl: linearAgentInteractionDocsUrl,
    })),
  ],
} as const satisfies IntegrationEventCatalog;

function dataEventSummary(resource: string, action: string): string {
  if (action === 'create') return `A Linear ${resource} is created.`;
  if (action === 'update') return `A Linear ${resource} changes.`;
  return `A Linear ${resource} is removed.`;
}
