import type {
  AgentToolCatalogEntry,
  AgentToolJsonSchema,
  AgentToolSelectionCatalog,
  AgentToolSelector,
} from '@shipfox/api-integration-spi';
import type {SlackWebApiResponse} from '#api/client.js';

export type SlackAgentToolRequiredScope = 'read' | 'write';
export type SlackAgentToolCatalogEntry = AgentToolCatalogEntry<SlackAgentToolRequiredScope>;

interface SlackAgentToolCatalogInput {
  id: string;
  description: string;
  sensitivity: 'read' | 'write';
  sensitive: boolean;
  requiredScope: SlackAgentToolRequiredScope;
  inputSchema: AgentToolJsonSchema;
}

const whitespacePattern = /\s+/;

// Slack caps the cumulative text across all Markdown blocks in one payload at 12,000 characters;
// content over that limit is rejected with invalid_blocks rather than truncated. Each tool here
// sends exactly one Markdown block, so the cap applies to that single block's text.
const SLACK_MARKDOWN_BLOCK_MAX_LENGTH = 12_000;

// Only the chat.* methods resolve a user ID into a direct message; conversations.* and reactions.*
// need the conversation ID itself, so the two targets are described separately.
const conversationIdSchema = stringSchema(
  'Channel, private group, or direct message conversation ID, such as C0ABC12345 or D0ABC12345. A user ID is not accepted here',
);
const messageTargetSchema = stringSchema(
  'Channel, private group, or direct message conversation ID. Pass a user ID to open a direct message with that user',
);
const cursorSchema = stringSchema('Pagination cursor from a previous request');
const messageSchema = {
  ...stringSchema('Message content, written as standard Markdown'),
  maxLength: SLACK_MARKDOWN_BLOCK_MAX_LENGTH,
};
const threadTsSchema = stringSchema('Timestamp of the parent message to reply in its thread');
const replyBroadcastSchema = booleanSchema('Also send the thread reply to the channel');

export const slackAgentToolCatalog = [
  tool({
    id: 'read_channel',
    description:
      'Read messages from a Slack channel in reverse chronological order (newest first). Reading direct message history needs the ID of that conversation, not the ID of the user on the other side.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {
        channel_id: conversationIdSchema,
        oldest: stringSchema('Start of the time range, as a Slack timestamp'),
        latest: stringSchema('End of the time range, as a Slack timestamp'),
        limit: integerSchema('Messages to return, 1 to 100 (default 100)'),
        cursor: cursorSchema,
      },
      ['channel_id'],
    ),
  }),
  tool({
    id: 'read_thread',
    description:
      'Read a Slack thread: the parent message and all of its replies. Requires the channel ID and the timestamp of the parent message.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {
        channel_id: conversationIdSchema,
        message_ts: stringSchema('Timestamp of the parent message, such as 1234567890.123456'),
        oldest: stringSchema('Start of the time range, as a Slack timestamp'),
        latest: stringSchema('End of the time range, as a Slack timestamp'),
        limit: integerSchema('Messages to return, 1 to 1000 (default 100)'),
        cursor: cursorSchema,
      },
      ['channel_id', 'message_ts'],
    ),
  }),
  tool({
    id: 'read_channel_info',
    description:
      'Retrieve metadata for a single Slack channel by ID: name, topic, purpose, privacy, and archive status. Use this to learn what a channel is for before reading or posting. To read its messages, use read_channel instead.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {
        channel_id: conversationIdSchema,
        include_num_members: booleanSchema('Include the channel member count (default false)'),
      },
      ['channel_id'],
    ),
  }),
  tool({
    id: 'read_channel_members',
    description:
      'List the user IDs of the members of a Slack channel. Pair it with read_user_profile to resolve a member to a name.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {
        channel_id: conversationIdSchema,
        limit: integerSchema('Members to return per page (default 100)'),
        cursor: cursorSchema,
      },
      ['channel_id'],
    ),
  }),
  tool({
    id: 'read_user_profile',
    description:
      'Retrieve profile information for a Slack user, including contact details, status, timezone, and role.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {
        user_id: stringSchema('Slack user ID, such as U0ABC12345'),
        include_locale: booleanSchema("Include the user's locale information (default false)"),
      },
      ['user_id'],
    ),
  }),
  tool({
    id: 'search_channels',
    description:
      'Search the channels this integration can see, by name, topic, or purpose. Returns channel names, IDs, topics, purposes, and archive status. Names are typically lowercase with hyphens. Space-separated terms all have to match. Only the requested page is searched, so page through with the returned cursor when a channel is missing.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {
        query: stringSchema('Search query for finding channels'),
        channel_types: stringSchema(
          'Comma-separated channel types: public_channel, private_channel. Defaults to public_channel',
        ),
        include_archived: booleanSchema('Include archived channels in the results'),
        limit: integerSchema('Channels to scan per page (default 100)'),
        cursor: cursorSchema,
      },
      ['query'],
    ),
  }),
  tool({
    id: 'send_message',
    description:
      'Send a message to a Slack channel or user. To send a direct message, pass the user ID as the channel ID. Supports standard Markdown: bold, italic, strikethrough, links, lists, blockquotes, inline code, and code blocks. Returns the posted message timestamp.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        channel_id: messageTargetSchema,
        message: messageSchema,
        thread_ts: threadTsSchema,
        reply_broadcast: replyBroadcastSchema,
      },
      ['channel_id', 'message'],
    ),
  }),
  tool({
    id: 'schedule_message',
    description:
      'Schedule a message for future delivery to a Slack channel. Does not send immediately. post_at has to be at least 2 minutes in the future and at most 120 days out. Once scheduled, the message cannot be edited.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        channel_id: messageTargetSchema,
        message: messageSchema,
        post_at: integerSchema('Unix timestamp at which to send the message'),
        thread_ts: threadTsSchema,
        reply_broadcast: replyBroadcastSchema,
      },
      ['channel_id', 'message', 'post_at'],
    ),
  }),
  tool({
    id: 'update_message',
    description:
      'Update an already posted Slack message, replacing its content. Supports the same standard Markdown as send_message.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        channel_id: conversationIdSchema,
        message_ts: stringSchema('Timestamp of the message to update'),
        message: messageSchema,
      },
      ['channel_id', 'message_ts', 'message'],
    ),
  }),
  tool({
    id: 'add_reaction',
    description: 'Add an emoji reaction to a Slack message.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        channel_id: conversationIdSchema,
        message_ts: stringSchema('Timestamp of the message to react to'),
        emoji: stringSchema('Emoji name without the surrounding colons, such as white_check_mark'),
      },
      ['channel_id', 'message_ts', 'emoji'],
    ),
  }),
  tool({
    id: 'create_canvas',
    description:
      'Create a standalone Slack canvas from Markdown and return its ID. Not available on free teams.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        title: stringSchema('Concise, descriptive canvas name. Do not repeat it in the content'),
        content: stringSchema('Canvas body, written as standard Markdown'),
      },
      ['title', 'content'],
    ),
  }),
] as const satisfies readonly SlackAgentToolCatalogEntry[];

export type SlackAgentToolId = (typeof slackAgentToolCatalog)[number]['id'];

export interface SlackToolOperation {
  method: string;
  mapArguments: (args: Record<string, unknown>) => Record<string, unknown>;
  mapOutput?: (body: SlackWebApiResponse, args: Record<string, unknown>) => SlackWebApiResponse;
  validate?: (args: Record<string, unknown>) => SlackToolValidationError | undefined;
}

export interface SlackToolValidationError {
  message: string;
  code?: string | undefined;
}

// Tool inputs follow the Slack MCP server's naming so agent prompts port across both, which means
// every call is translated to the Web API's own parameter names before it is sent.
export const SLACK_TOOL_OPERATIONS = {
  read_channel: {
    method: 'conversations.history',
    mapArguments: ({channel_id, oldest, latest, limit, cursor}) => ({
      channel: channel_id,
      oldest,
      latest,
      limit,
      cursor,
    }),
  },
  read_thread: {
    method: 'conversations.replies',
    mapArguments: ({channel_id, message_ts, oldest, latest, limit, cursor}) => ({
      channel: channel_id,
      ts: message_ts,
      oldest,
      latest,
      limit,
      cursor,
    }),
  },
  read_channel_info: {
    method: 'conversations.info',
    mapArguments: ({channel_id, include_num_members}) => ({
      channel: channel_id,
      include_num_members,
    }),
  },
  read_channel_members: {
    method: 'conversations.members',
    mapArguments: ({channel_id, limit, cursor}) => ({channel: channel_id, limit, cursor}),
  },
  read_user_profile: {
    method: 'users.info',
    mapArguments: ({user_id, include_locale}) => ({user: user_id, include_locale}),
  },
  search_channels: {
    method: 'conversations.list',
    mapArguments: ({channel_types, include_archived, limit, cursor}) => ({
      types: channel_types,
      exclude_archived: include_archived !== true,
      limit,
      cursor,
    }),
    mapOutput: matchingChannels,
  },
  send_message: {
    method: 'chat.postMessage',
    mapArguments: ({channel_id, message, thread_ts, reply_broadcast}) => ({
      channel: channel_id,
      ...markdownMessage(message),
      thread_ts,
      reply_broadcast,
    }),
    validate: validateMessageLength,
  },
  schedule_message: {
    method: 'chat.scheduleMessage',
    mapArguments: ({channel_id, message, post_at, thread_ts, reply_broadcast}) => ({
      channel: channel_id,
      ...markdownMessage(message),
      post_at,
      thread_ts,
      reply_broadcast,
    }),
    validate: validateMessageLength,
  },
  update_message: {
    method: 'chat.update',
    mapArguments: ({channel_id, message_ts, message}) => ({
      channel: channel_id,
      ts: message_ts,
      ...markdownMessage(message),
    }),
    validate: validateMessageLength,
  },
  add_reaction: {
    method: 'reactions.add',
    mapArguments: ({channel_id, message_ts, emoji}) => ({
      channel: channel_id,
      timestamp: message_ts,
      name: emoji,
    }),
  },
  create_canvas: {
    method: 'canvases.create',
    mapArguments: ({title, content}) => ({
      title,
      document_content: {type: 'markdown', markdown: content},
    }),
  },
} as const satisfies Record<SlackAgentToolId, SlackToolOperation>;

export const slackAgentToolSelectionCatalog =
  buildSlackAgentToolSelectionCatalog(slackAgentToolCatalog);

// A Markdown block renders standard Markdown, which the plain text field does not; text is kept as
// the notification fallback, so its Markdown syntax is stripped rather than shown literally.
function markdownMessage(message: unknown): Record<string, unknown> {
  if (typeof message !== 'string') return {};
  return {text: stripMarkdownForFallback(message), blocks: [{type: 'markdown', text: message}]};
}

const codeBlockPattern = /```[^\n]*\n?([\s\S]*?)\n?```/g;
const inlineCodePattern = /`([^`]+)`/g;
const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
const boldPattern = /\*\*([^*]+)\*\*|__([^_]+)__/g;
const strikethroughPattern = /~~([^~]+)~~/g;
const italicPattern = /\*([^*]+)\*|_([^_]+)_/g;
const blockquotePattern = /^>\s?/gm;
// Reserved code spans are wrapped in a delimiter built at runtime (String.fromCharCode) rather than
// a literal escape in source, and one that can't occur in a real chat message, so it can't collide
// with the message's own content the way a plain space or digit could.
const codePlaceholderDelimiter = String.fromCharCode(0);
const codePlaceholderPattern = new RegExp(
  `${codePlaceholderDelimiter}(\\d+)${codePlaceholderDelimiter}`,
  'g',
);

// Best-effort plain-text rendering of the Markdown syntax the tool description promises (bold,
// italic, strikethrough, links, lists, blockquotes, inline code, code blocks); lists are left as-is
// since "- item" and "1. item" already read fine as plain text. Code spans are pulled out behind a
// placeholder first so their own *, _, ~, and [] characters survive the other replacements intact.
function stripMarkdownForFallback(message: string): string {
  const codeSpans: string[] = [];
  const reserveCodeSpan = (_match: string, code: string): string =>
    `${codePlaceholderDelimiter}${codeSpans.push(code) - 1}${codePlaceholderDelimiter}`;

  return message
    .replace(codeBlockPattern, reserveCodeSpan)
    .replace(inlineCodePattern, reserveCodeSpan)
    .replace(linkPattern, (_match, text: string, url: string) => `${text} (${url})`)
    .replace(
      boldPattern,
      (_match, asterisk?: string, underscore?: string) => asterisk ?? underscore ?? '',
    )
    .replace(strikethroughPattern, (_match, text: string) => text)
    .replace(
      italicPattern,
      (_match, asterisk?: string, underscore?: string) => asterisk ?? underscore ?? '',
    )
    .replace(blockquotePattern, '')
    .replace(codePlaceholderPattern, (_match, index: string) => codeSpans[Number(index)] ?? '');
}

function validateMessageLength(
  args: Record<string, unknown>,
): SlackToolValidationError | undefined {
  const {message} = args;
  if (typeof message !== 'string') return undefined;
  // .length counts UTF-16 code units, so astral-plane characters (most emoji) count twice and
  // would reject messages the 12,000-character schema limit still allows; the spread operator
  // iterates by Unicode code point instead.
  const length = [...message].length;
  if (length > SLACK_MARKDOWN_BLOCK_MAX_LENGTH) {
    return {
      message: `Message is ${length.toLocaleString('en-US')} characters, which exceeds Slack's ${SLACK_MARKDOWN_BLOCK_MAX_LENGTH.toLocaleString('en-US')}-character Markdown block limit. Shorten it or split it into multiple messages.`,
      code: 'content-too-large',
    };
  }
  return undefined;
}

// Slack has no channel search method for bot tokens, so the requested page is matched locally.
function matchingChannels(
  body: SlackWebApiResponse,
  args: Record<string, unknown>,
): SlackWebApiResponse {
  const {query} = args;
  const {channels} = body;
  if (typeof query !== 'string' || !Array.isArray(channels)) return body;
  const terms = query.toLowerCase().split(whitespacePattern).filter(Boolean);
  if (terms.length === 0) return body;
  return {...body, channels: channels.filter((channel) => matchesTerms(channel, terms))};
}

function matchesTerms(channel: unknown, terms: string[]): boolean {
  if (typeof channel !== 'object' || channel === null) return false;
  const {name, topic, purpose} = channel as Record<string, unknown>;
  const haystack = [name, textValue(topic), textValue(purpose)]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function textValue(field: unknown): unknown {
  if (typeof field !== 'object' || field === null) return undefined;
  return (field as Record<string, unknown>).value;
}

function buildSlackAgentToolSelectionCatalog(
  catalog: readonly SlackAgentToolCatalogEntry[],
): AgentToolSelectionCatalog {
  return {
    selectors: catalog.map(
      (entry): AgentToolSelector => ({
        token: entry.id,
        kind: 'standalone',
        sensitivity: entry.sensitivity,
        sensitive: entry.sensitive,
      }),
    ),
  };
}

function tool<const Entry extends SlackAgentToolCatalogInput>(input: Entry): Entry {
  return input;
}

function objectSchema(
  properties: Record<string, AgentToolJsonSchema>,
  required: string[] = [],
): AgentToolJsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length > 0 ? {required} : {}),
  };
}

function stringSchema(description?: string): AgentToolJsonSchema {
  return {type: 'string', ...(description ? {description} : {})};
}

function integerSchema(description: string): AgentToolJsonSchema {
  return {type: 'integer', description};
}

function booleanSchema(description: string): AgentToolJsonSchema {
  return {type: 'boolean', description};
}
