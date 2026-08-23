import type {IntegrationEventCatalog} from '@shipfox/api-integration-core-dto';
import {slackEventNames} from './schemas/index.js';

const eventDetails = {
  app_mention: {
    summary: 'A Slack message mentions the installed app.',
    emittedWhen: 'Slack sends an app_mention event to the installed app.',
    payloadDocUrl: 'https://docs.slack.dev/reference/events/app_mention/',
  },
  message: {
    summary: 'A message event arrives from a subscribed Slack conversation.',
    emittedWhen: 'Slack sends a message event to the installed app.',
    payloadDocUrl: 'https://docs.slack.dev/reference/events/message/',
  },
  reaction_added: {
    summary: 'A member adds an emoji reaction to a Slack item.',
    emittedWhen: 'Slack sends a reaction_added event to the installed app.',
    payloadDocUrl: 'https://docs.slack.dev/reference/events/reaction_added/',
  },
  slash_command: {
    summary: 'A user invokes a slash command for the installed app.',
    emittedWhen: 'Slack sends a slash-command request to the installed app.',
    payloadDocUrl: 'https://docs.slack.dev/interactivity/implementing-slash-commands/',
  },
} as const satisfies Record<
  (typeof slackEventNames)[number],
  {
    summary: string;
    emittedWhen: string;
    payloadDocUrl: string;
  }
>;

export const slackEventCatalog = {
  provider: 'Slack',
  events: slackEventNames.map((name) => ({
    name,
    ...eventDetails[name],
    payloadKind: 'shipfox-normalized' as const,
  })),
} as const satisfies IntegrationEventCatalog;
