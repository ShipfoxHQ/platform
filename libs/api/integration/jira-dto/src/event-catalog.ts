import type {IntegrationEventCatalog} from '@shipfox/api-integration-core-dto';
import {jiraWebhookEventNames} from './schemas/index.js';

const eventDetails = {
  'jira:issue_created': {
    summary: 'A Jira issue is created.',
    emittedWhen: 'Jira sends an issue-created webhook.',
  },
  'jira:issue_updated': {
    summary: 'A Jira issue changes.',
    emittedWhen: 'Jira sends an issue-updated webhook.',
  },
  'jira:issue_deleted': {
    summary: 'A Jira issue is deleted.',
    emittedWhen: 'Jira sends an issue-deleted webhook.',
  },
  comment_created: {
    summary: 'A comment is added to a Jira issue.',
    emittedWhen: 'Jira sends a comment-created webhook.',
  },
  comment_updated: {
    summary: 'A comment on a Jira issue changes.',
    emittedWhen: 'Jira sends a comment-updated webhook.',
  },
  comment_deleted: {
    summary: 'A comment is deleted from a Jira issue.',
    emittedWhen: 'Jira sends a comment-deleted webhook.',
  },
} as const satisfies Record<
  (typeof jiraWebhookEventNames)[number],
  {
    summary: string;
    emittedWhen: string;
  }
>;

export const jiraEventCatalog = {
  provider: 'Jira',
  events: jiraWebhookEventNames.map((name) => ({
    name,
    ...eventDetails[name],
    payloadKind: 'shipfox-normalized' as const,
  })),
} as const satisfies IntegrationEventCatalog;
