import {
  linearAgentSessionWebhookEventNames,
  linearWebhookActions,
  linearWebhookResourceTypes,
} from '@shipfox/api-integration-linear-dto';

const linearWebhookDocsUrl = 'https://linear.app/developers/webhooks';
const linearAgentInteractionDocsUrl = 'https://linear.app/developers/agent-interaction';

const resourceLabels = {
  Issue: 'issue',
  Comment: 'comment',
  IssueLabel: 'issue label',
  Project: 'project',
  Cycle: 'cycle',
};

const dataEvents = linearWebhookResourceTypes.flatMap((type) =>
  linearWebhookActions.map((action) => ({
    name: `${type}.${action}`,
    summary: dataEventSummary(resourceLabels[type], action),
    emittedWhen: `Linear sends a webhook for ${type} with the ${action} action.`,
    payloadKind: 'raw-provider',
    payloadDocUrl: linearWebhookDocsUrl,
  })),
);

const agentSessionDetails = {
  'agentSession.created': {
    summary: 'A Linear agent session is created.',
    emittedWhen: 'Linear creates an agent session after a user mentions or delegates to the app.',
  },
  'agentSession.prompted': {
    summary: 'A user adds a prompt to a Linear agent session.',
    emittedWhen: 'Linear sends an AgentSessionEvent webhook with the prompted action.',
  },
};

export const linearEventCatalog = {
  provider: 'Linear',
  events: [
    ...dataEvents,
    ...linearAgentSessionWebhookEventNames.map((name) => ({
      name,
      ...agentSessionDetails[name],
      payloadKind: 'raw-provider',
      payloadDocUrl: linearAgentInteractionDocsUrl,
    })),
  ],
};

function dataEventSummary(resource, action) {
  if (action === 'create') return `A Linear ${resource} is created.`;
  if (action === 'update') return `A Linear ${resource} changes.`;
  return `A Linear ${resource} is removed.`;
}
