import {
  SLACK_TOOL_OPERATIONS,
  type SlackAgentToolId,
  type SlackToolOperation,
  slackAgentToolCatalog,
  slackAgentToolSelectionCatalog,
} from './agent-tools.js';

const expectedTools = [
  {id: 'read_channel', sensitivity: 'read', requiredScope: 'read'},
  {id: 'read_thread', sensitivity: 'read', requiredScope: 'read'},
  {id: 'read_channel_info', sensitivity: 'read', requiredScope: 'read'},
  {id: 'read_channel_members', sensitivity: 'read', requiredScope: 'read'},
  {id: 'read_user_profile', sensitivity: 'read', requiredScope: 'read'},
  {id: 'search_channels', sensitivity: 'read', requiredScope: 'read'},
  {id: 'send_message', sensitivity: 'write', requiredScope: 'write'},
  {id: 'schedule_message', sensitivity: 'write', requiredScope: 'write'},
  {id: 'update_message', sensitivity: 'write', requiredScope: 'write'},
  {id: 'add_reaction', sensitivity: 'write', requiredScope: 'write'},
  {id: 'create_canvas', sensitivity: 'write', requiredScope: 'write'},
] as const;

function operation(id: SlackAgentToolId): SlackToolOperation {
  return SLACK_TOOL_OPERATIONS[id];
}

function channelIdDescription(inputSchema: Record<string, unknown>): string | undefined {
  const properties = inputSchema.properties as Record<string, {description?: string}> | undefined;
  return properties?.channel_id?.description;
}

describe('slackAgentToolCatalog', () => {
  it('defines the Slack tools with their access requirements', () => {
    const tools = slackAgentToolCatalog.map(({id, sensitivity, requiredScope, sensitive}) => ({
      id,
      sensitivity,
      requiredScope,
      sensitive,
    }));

    expect(tools).toEqual(expectedTools.map((tool) => ({...tool, sensitive: false})));
  });

  it('documents every tool with an object input schema', () => {
    const schemas = slackAgentToolCatalog.map(({description, inputSchema}) => ({
      description,
      type: inputSchema.type,
    }));

    expect(schemas).toHaveLength(expectedTools.length);
    expect(
      schemas.every(({description, type}) => description.length > 0 && type === 'object'),
    ).toBe(true);
  });

  it('names message parameters the way the Slack MCP server does', () => {
    const sendMessage = slackAgentToolCatalog.find(({id}) => id === 'send_message');
    const readThread = slackAgentToolCatalog.find(({id}) => id === 'read_thread');

    expect(sendMessage?.inputSchema).toMatchObject({
      required: ['channel_id', 'message'],
      properties: {message: {type: 'string'}, thread_ts: {type: 'string'}},
    });
    expect(readThread?.inputSchema).toMatchObject({
      required: ['channel_id', 'message_ts'],
      properties: {limit: {type: 'integer'}, cursor: {type: 'string'}},
    });
  });

  it('offers user-ID targeting only on the tools whose Slack method resolves one', () => {
    const targetDescriptions = new Map(
      slackAgentToolCatalog
        .filter(({inputSchema}) => channelIdDescription(inputSchema) !== undefined)
        .map(({id, inputSchema}) => [id, channelIdDescription(inputSchema) ?? '']),
    );
    const acceptsUserId = [...targetDescriptions]
      .filter(([, description]) => description.includes('Pass a user ID'))
      .map(([id]) => id);

    expect(acceptsUserId).toEqual(['send_message', 'schedule_message']);
    expect(targetDescriptions.get('read_channel')).toContain('not accepted');
  });

  it('maps every tool id to its dotted Slack Web API method', () => {
    const methods = Object.fromEntries(
      slackAgentToolCatalog.map(({id}) => [id, operation(id).method]),
    );

    expect(methods).toEqual({
      read_channel: 'conversations.history',
      read_thread: 'conversations.replies',
      read_channel_info: 'conversations.info',
      read_channel_members: 'conversations.members',
      read_user_profile: 'users.info',
      search_channels: 'conversations.list',
      send_message: 'chat.postMessage',
      schedule_message: 'chat.scheduleMessage',
      update_message: 'chat.update',
      add_reaction: 'reactions.add',
      create_canvas: 'canvases.create',
    });
  });

  it('translates channel and message identifiers to Slack Web API parameters', () => {
    expect(
      operation('read_channel').mapArguments({channel_id: 'C123', limit: 10, cursor: 'next'}),
    ).toMatchObject({channel: 'C123', limit: 10, cursor: 'next'});
    expect(
      operation('read_thread').mapArguments({channel_id: 'C123', message_ts: '123.000'}),
    ).toMatchObject({channel: 'C123', ts: '123.000'});
    expect(operation('read_user_profile').mapArguments({user_id: 'U123'})).toMatchObject({
      user: 'U123',
    });
    expect(operation('read_channel_info').mapArguments({channel_id: 'C123'})).toMatchObject({
      channel: 'C123',
    });
    expect(
      operation('read_channel_members').mapArguments({channel_id: 'C123', cursor: 'next'}),
    ).toMatchObject({channel: 'C123', cursor: 'next'});
    expect(
      operation('add_reaction').mapArguments({
        channel_id: 'C123',
        message_ts: '123.000',
        emoji: 'tada',
      }),
    ).toMatchObject({channel: 'C123', timestamp: '123.000', name: 'tada'});
  });

  it('sends message content as a Markdown block with a plain text fallback', () => {
    const args = {channel_id: 'C123', message: '**Deployed** to production'};

    expect(operation('send_message').mapArguments(args)).toMatchObject({
      channel: 'C123',
      text: '**Deployed** to production',
      blocks: [{type: 'markdown', text: '**Deployed** to production'}],
    });
    expect(
      operation('update_message').mapArguments({...args, message_ts: '123.000'}),
    ).toMatchObject({ts: '123.000', blocks: [{type: 'markdown', text: args.message}]});
  });

  it('schedules a message with its send time and thread target', () => {
    expect(
      operation('schedule_message').mapArguments({
        channel_id: 'C123',
        message: 'Standup in 5',
        post_at: 1700000000,
        thread_ts: '123.000',
        reply_broadcast: true,
      }),
    ).toMatchObject({
      channel: 'C123',
      text: 'Standup in 5',
      blocks: [{type: 'markdown', text: 'Standup in 5'}],
      post_at: 1700000000,
      thread_ts: '123.000',
      reply_broadcast: true,
    });
  });

  it('wraps canvas content as a Markdown document', () => {
    expect(operation('create_canvas').mapArguments({title: 'Runbook', content: '# Steps'})).toEqual(
      {
        title: 'Runbook',
        document_content: {type: 'markdown', markdown: '# Steps'},
      },
    );
  });

  it('excludes archived channels unless the caller asks for them', () => {
    expect(operation('search_channels').mapArguments({query: 'deploy'})).toMatchObject({
      exclude_archived: true,
    });
    expect(
      operation('search_channels').mapArguments({query: 'deploy', include_archived: true}),
    ).toMatchObject({exclude_archived: false});
  });

  it('keeps only the channels matching every search term', () => {
    const body = {
      ok: true,
      channels: [
        {id: 'C1', name: 'deploy-prod', topic: {value: 'Release coordination'}},
        {id: 'C2', name: 'deploy-staging', topic: {value: 'Scratch'}},
        {id: 'C3', name: 'design', purpose: {value: 'Release notes'}},
      ],
    };

    const result = operation('search_channels').mapOutput?.(body, {query: 'Deploy release'});

    expect(result).toEqual({...body, channels: [body.channels[0]]});
  });

  it('returns the Slack response unchanged when the search query is empty', () => {
    const body = {ok: true, channels: [{id: 'C1', name: 'deploy-prod'}]};

    expect(operation('search_channels').mapOutput?.(body, {query: '   '})).toBe(body);
  });

  it('exposes one standalone selector per tool with matching sensitivity', () => {
    const selectors = slackAgentToolSelectionCatalog.selectors;

    expect(selectors).toEqual(
      expectedTools.map(({id, sensitivity}) => ({
        token: id,
        kind: 'standalone',
        sensitivity,
        sensitive: false,
      })),
    );
  });
});
