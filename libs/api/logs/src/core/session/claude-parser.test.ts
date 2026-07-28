import {
  readClaudeSessionFixture,
  readClaudeSystemSubtypeFixture,
  readInstalledClaudeSdkVersion,
  readInstalledClaudeSystemSubtypes,
} from '#test/fixtures/claude-session.js';
import {
  flushPendingToolRows,
  PURE_PROGRESS_CLAUDE_SYSTEM_SUBTYPES,
  SYSTEM_EVENT_MAPPINGS,
} from './claude/rows.js';
import {createClaudeParseContext, parseClaudeSessionRecord} from './claude-parser.js';

const record = (data: unknown, ts = 1) => ({
  ts,
  data: typeof data === 'string' ? data : JSON.stringify(data),
});
const meta = (label: string, value: string, inline?: boolean) =>
  inline == null ? {label, value} : {label, value, inline};

const namedSystemEvents = [
  {
    subtype: 'permission_denied',
    data: {tool_name: 'mcp__shipfox_outputs__set_output', decision_reason: 'Permission mode'},
    expected: {
      label: 'Permission denied',
      detail: 'mcp__shipfox_outputs__set_output',
      meta: [meta('reason', 'Permission mode')],
      tone: 'error',
    },
  },
  {
    subtype: 'api_retry',
    data: {attempt: 2, max_retries: 3, error_status: 429, retry_delay_ms: 1_500},
    expected: {
      label: 'API retry',
      detail: 'attempt 2/3',
      meta: [meta('status', '429'), meta('retry delay', '1,500 ms')],
      tone: 'warning',
    },
  },
  {
    subtype: 'informational',
    data: {level: 'warning', content: 'The hook blocked continuation.'},
    expected: {
      label: 'Warning',
      detail: 'The hook blocked continuation.',
      meta: [],
      tone: 'warning',
    },
  },
  {
    subtype: 'compact_boundary',
    data: {
      compact_metadata: {trigger: 'auto', pre_tokens: 12_000, post_tokens: 4_000, duration_ms: 250},
    },
    expected: {
      label: 'Context compacted',
      detail: null,
      meta: [
        meta('trigger', 'auto'),
        meta('tokens before', '12K tokens'),
        meta('tokens after', '4,000 tokens'),
        meta('duration', '250 ms'),
      ],
      tone: 'default',
    },
  },
  {
    subtype: 'hook_response',
    data: {hook_name: 'PreToolUse', outcome: 'success', output: 'Hook completed', exit_code: 0},
    expected: {
      label: 'Hook completed',
      detail: 'Hook completed',
      meta: [meta('hook', 'PreToolUse'), meta('exit code', '0')],
      tone: 'default',
    },
  },
  {
    subtype: 'hook_response',
    data: {hook_name: 'PreToolUse', outcome: 'error', stderr: 'command not found', exit_code: 127},
    expected: {
      label: 'Hook failed',
      detail: 'command not found',
      meta: [meta('hook', 'PreToolUse'), meta('exit code', '127')],
      tone: 'error',
    },
  },
  {
    subtype: 'hook_response',
    data: {hook_name: 'PostToolUse', outcome: 'cancelled'},
    expected: {
      label: 'Hook cancelled',
      detail: null,
      meta: [meta('hook', 'PostToolUse')],
      tone: 'warning',
    },
  },
  {
    subtype: 'model_refusal_fallback',
    data: {},
    expected: {
      label: 'Model refused, fell back',
      detail: null,
      meta: [],
      tone: 'warning',
    },
  },
  {
    subtype: 'model_refusal_no_fallback',
    data: {},
    expected: {
      label: 'Model refused',
      detail: null,
      meta: [],
      tone: 'error',
    },
  },
  {
    subtype: 'mirror_error',
    data: {error: 'Session store unavailable'},
    expected: {
      label: 'Session mirror failed',
      detail: 'Session store unavailable',
      meta: [],
      tone: 'error',
    },
  },
  {
    subtype: 'worker_shutting_down',
    data: {},
    expected: {
      label: 'Worker shutting down',
      detail: null,
      meta: [],
      tone: 'warning',
    },
  },
  {
    subtype: 'elicitation_complete',
    data: {},
    expected: {
      label: 'Elicitation complete',
      detail: null,
      meta: [],
      tone: 'default',
    },
  },
  {
    subtype: 'notification',
    data: {},
    expected: {
      label: 'Notification',
      detail: null,
      meta: [],
      tone: 'default',
    },
  },
  {
    subtype: 'task_started',
    data: {},
    expected: {
      label: 'Task started',
      detail: null,
      meta: [],
      tone: 'default',
    },
  },
  {
    subtype: 'task_updated',
    data: {},
    expected: {
      label: 'Task updated',
      detail: null,
      meta: [],
      tone: 'default',
    },
  },
  {
    subtype: 'task_notification',
    data: {},
    expected: {
      label: 'Task notification',
      detail: null,
      meta: [],
      tone: 'default',
    },
  },
] as const;

describe('parseClaudeSessionRecord', () => {
  it('covers every system subtype in the installed Claude SDK union', () => {
    const fixture = readClaudeSystemSubtypeFixture();
    const installedVersion = readInstalledClaudeSdkVersion();
    const installedSubtypes = readInstalledClaudeSystemSubtypes();
    const parserSubtypes = [
      'init',
      ...PURE_PROGRESS_CLAUDE_SYSTEM_SUBTYPES,
      ...Object.keys(SYSTEM_EVENT_MAPPINGS),
    ].sort();

    expect(
      fixture.version,
      `The checked-in SDK subtype fixture targets ${fixture.version}, but the installed SDK is ${installedVersion}`,
    ).toBe(installedVersion);
    expect(
      fixture.subtypes,
      `The checked-in SDK subtype fixture is stale; update it for: ${installedSubtypes
        .filter((subtype) => !fixture.subtypes.includes(subtype))
        .join(', ')}`,
    ).toEqual(installedSubtypes);
    expect(
      parserSubtypes,
      `The parser does not classify these installed SDK system subtypes: ${installedSubtypes
        .filter((subtype) => !parserSubtypes.includes(subtype))
        .join(', ')}`,
    ).toEqual(fixture.subtypes);
  });

  it('parses a captured Claude agent step with tools, signal events, and a re-prompt', () => {
    const context = createClaudeParseContext();
    const records = readClaudeSessionFixture('agent-step.jsonl');
    let sawResult = false;
    const rows = records.flatMap((sessionRecord) => {
      const message = JSON.parse(sessionRecord.data) as {type?: string};
      const isFinalResult = message.type !== 'result' || sawResult;
      if (message.type === 'result') sawResult = true;
      return parseClaudeSessionRecord(sessionRecord, context, isFinalResult);
    });
    const allRows = [...rows, ...flushPendingToolRows(context)];
    const lifecycleRows = allRows.filter((row) => row.kind === 'lifecycle');
    const toolCall = allRows.find((row) => row.kind === 'tool-call');
    const toolResult = allRows.find((row) => row.kind === 'tool-result');

    expect(lifecycleRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({label: 'Session started'}),
        expect.objectContaining({
          label: 'Permission denied',
          detail: 'mcp__shipfox_outputs__set_output',
          tone: 'error',
        }),
        expect.objectContaining({label: 'API retry', detail: 'attempt 2/3', tone: 'warning'}),
        expect.objectContaining({label: 'Hook completed', detail: 'Hook completed'}),
        expect.objectContaining({label: 'Context compacted'}),
        expect.objectContaining({label: 'Turn 1 completed'}),
        expect.objectContaining({label: 'Turn 2 started'}),
        expect.objectContaining({label: 'Session completed'}),
      ]),
    );
    expect(allRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'message',
          role: 'platform',
          text: expect.stringContaining('required workflow outputs'),
        }),
      ]),
    );
    expect(toolCall).toEqual(
      expect.objectContaining({kind: 'tool-call', id: 'toolu-1', name: 'Read'}),
    );
    expect(toolResult).toEqual(
      expect.objectContaining({
        kind: 'tool-result',
        toolCallId: 'toolu-1',
        toolName: expect.any(String),
        output: expect.stringContaining('# Shipfox'),
      }),
    );
    if (toolCall?.kind !== 'tool-call' || toolResult?.kind !== 'tool-result') {
      throw new Error('The captured tool call and result must both be parsed');
    }
    expect(toolResult.toolCallId).toBe(toolCall.id);
  });

  it('returns a raw row for malformed JSON', () => {
    const rows = parseClaudeSessionRecord(record('{not json'));

    expect(rows).toEqual([
      {kind: 'raw', timestamp: 1, label: 'Malformed session entry', raw: '{not json'},
    ]);
  });

  it('returns a raw row for an unknown message type', () => {
    const rows = parseClaudeSessionRecord(record({type: 'future_event', value: 1}));

    expect(rows).toEqual([
      {
        kind: 'raw',
        timestamp: 1,
        label: 'Unknown Claude message: future_event',
        raw: '{"type":"future_event","value":1}',
      },
    ]);
  });

  it('maps the init message to a lifecycle row', () => {
    const rows = parseClaudeSessionRecord(
      record({
        type: 'system',
        subtype: 'init',
        session_id: 'session-1',
        cwd: '/workspace',
        model: 'claude-opus-4-8',
      }),
    );

    expect(rows).toEqual([
      {
        kind: 'lifecycle',
        timestamp: 1,
        label: 'Session started',
        detail: null,
        meta: [
          {label: 'session', value: 'session-1'},
          {label: 'cwd', value: '/workspace', inline: false},
          {label: 'model', value: 'claude-opus-4-8'},
        ],
        tone: 'default',
        terminalFailure: false,
      },
    ]);
  });

  it.each([
    ...PURE_PROGRESS_CLAUDE_SYSTEM_SUBTYPES,
  ])('drops pure-progress system subtype %s', (subtype) => {
    const rows = parseClaudeSessionRecord(record({type: 'system', subtype}));

    expect(rows).toEqual([]);
  });

  it.each([
    ['tool_progress', {type: 'tool_progress'}],
    ['prompt_suggestion', {type: 'prompt_suggestion'}],
    [
      'tool_use_summary',
      {
        type: 'tool_use_summary',
        tool_use_id: 'tool-1',
        summary: 'The tool completed successfully.',
      },
    ],
  ] as const)('does not store companion message type %s as a row', (_type, message) => {
    const rows = parseClaudeSessionRecord(record(message));

    expect(rows).toEqual([]);
  });

  it('folds a tool-use summary into the last matching tool-call row', () => {
    const context = createClaudeParseContext();
    expect(
      parseClaudeSessionRecord(
        record({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {type: 'tool_use', id: 'tool-1', name: 'Read', input: {file_path: 'src/a.ts'}},
              {type: 'tool_use', id: 'tool-2', name: 'Read', input: {file_path: 'src/b.ts'}},
            ],
          },
        }),
        context,
      ),
    ).toEqual([]);

    expect(
      parseClaudeSessionRecord(
        record({
          type: 'tool_use_summary',
          summary: 'Read both source files.',
          preceding_tool_use_ids: ['tool-1', 'tool-2'],
        }),
        context,
      ),
    ).toEqual([
      {
        kind: 'tool-call',
        timestamp: 1,
        id: 'tool-1',
        name: 'Read',
        input: '{\n  "file_path": "src/a.ts"\n}',
      },
      {
        kind: 'tool-call',
        timestamp: 1,
        id: 'tool-2',
        name: 'Read',
        input: '{\n  "file_path": "src/b.ts"\n}',
        summary: 'Read both source files.',
      },
    ]);
  });

  it('supports the legacy single tool-use id summary shape', () => {
    const context = createClaudeParseContext();
    expect(
      parseClaudeSessionRecord(
        record({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {type: 'tool_use', id: 'tool-1', name: 'Read', input: {file_path: 'src/a.ts'}},
            ],
          },
        }),
        context,
      ),
    ).toEqual([]);

    expect(
      parseClaudeSessionRecord(
        record({
          type: 'tool_use_summary',
          tool_use_id: 'tool-1',
          summary: 'Read the source file.',
        }),
        context,
      ),
    ).toEqual([expect.objectContaining({summary: 'Read the source file.'})]);
  });

  it.each([
    [
      'signed in',
      {type: 'auth_status', isAuthenticating: false, output: ['Signed in']},
      {label: 'Authentication complete', detail: 'Signed in', tone: 'default'},
    ],
    [
      'authenticating',
      {type: 'auth_status', isAuthenticating: true, output: []},
      {label: 'Authenticating', detail: null, tone: 'default'},
    ],
    [
      'failed',
      {type: 'auth_status', isAuthenticating: false, output: [], error: 'Invalid credentials'},
      {label: 'Authentication failed', detail: 'Invalid credentials', tone: 'error'},
    ],
  ] as const)('maps auth status messages to lifecycle rows (%s)', (_name, message, expected) => {
    const rows = parseClaudeSessionRecord(record(message));

    expect(rows).toEqual([
      {kind: 'lifecycle', timestamp: 1, meta: [], terminalFailure: false, ...expected},
    ]);
  });

  it.each([
    [
      'warning',
      {status: 'allowed_warning', rateLimitType: 'five_hour', utilization: 0.42},
      {
        label: 'Rate limit warning',
        detail: 'Five hour',
        meta: [{label: 'utilization', value: '42%'}],
        tone: 'warning',
      },
    ],
    [
      'rejected',
      {status: 'rejected', rateLimitType: 'five_hour', utilization: 1},
      {
        label: 'Rate limit exceeded',
        detail: 'Five hour',
        meta: [{label: 'utilization', value: '100%'}],
        tone: 'error',
      },
    ],
    [
      'allowed',
      {status: 'allowed'},
      {label: 'Rate limit available', detail: null, meta: [], tone: 'default'},
    ],
    [
      'unrecognized',
      {status: 'some_future_status'},
      {
        label: 'Rate limit updated',
        detail: null,
        meta: [{label: 'status', value: 'some_future_status'}],
        tone: 'warning',
      },
    ],
  ] as const)('maps rate-limit events to lifecycle rows (%s)', (_name, rateLimitInfo, expected) => {
    const rows = parseClaudeSessionRecord(
      record({type: 'rate_limit_event', rate_limit_info: rateLimitInfo}),
    );

    expect(rows).toEqual([{kind: 'lifecycle', timestamp: 1, terminalFailure: false, ...expected}]);
  });

  it.each(namedSystemEvents)('names and tones $subtype system events', ({
    subtype,
    data,
    expected,
  }) => {
    const rows = parseClaudeSessionRecord(record({type: 'system', subtype, ...data}));

    expect(rows).toEqual([
      {
        kind: 'lifecycle',
        timestamp: 1,
        ...expected,
        terminalFailure: false,
      },
    ]);
  });

  it('reports repeated init and result records as turns within one session', () => {
    const context = createClaudeParseContext();
    const rows = [
      ...parseClaudeSessionRecord(
        record({type: 'system', subtype: 'init', session_id: 'session-1'}),
        context,
      ),
      ...parseClaudeSessionRecord(
        record({type: 'result', subtype: 'success', result: 'first response'}),
        context,
        false,
      ),
      ...parseClaudeSessionRecord(
        record({type: 'system', subtype: 'init', session_id: 'session-1'}),
        context,
      ),
      ...parseClaudeSessionRecord(
        record({type: 'result', subtype: 'success', result: 'final response'}),
        context,
      ),
    ];

    expect(rows).toEqual([
      {
        kind: 'lifecycle',
        timestamp: 1,
        label: 'Session started',
        detail: null,
        meta: [meta('session', 'session-1')],
        tone: 'default',
        terminalFailure: false,
      },
      {
        kind: 'lifecycle',
        timestamp: 1,
        label: 'Turn 1 completed',
        detail: 'first response',
        meta: [{label: 'turn', value: '1'}],
        tone: 'default',
        terminalFailure: false,
      },
      {
        kind: 'lifecycle',
        timestamp: 1,
        label: 'Turn 2 started',
        detail: null,
        meta: [{label: 'turn', value: '2'}],
        tone: 'default',
        terminalFailure: false,
      },
      {
        kind: 'lifecycle',
        timestamp: 1,
        label: 'Session completed',
        detail: 'final response',
        meta: [],
        tone: 'default',
        terminalFailure: false,
      },
    ]);
  });

  it('qualifies unmapped system events instead of using a bare generic label', () => {
    const rows = parseClaudeSessionRecord(
      record({type: 'system', subtype: 'custom_event', session_id: 'session-1'}),
    );

    expect(rows).toEqual([
      {
        kind: 'lifecycle',
        timestamp: 1,
        label: 'Session event (custom_event)',
        detail: null,
        meta: [],
        tone: 'default',
        terminalFailure: false,
      },
    ]);
  });

  it('labels workflow-output re-prompts as platform messages', () => {
    const rows = parseClaudeSessionRecord(
      record({
        type: 'user',
        message: {
          role: 'user',
          content:
            'The previous turn ended without setting required workflow outputs: answer. ' +
            'Call set_output for each missing key, then provide your final response.',
        },
      }),
    );

    expect(rows).toEqual([
      {
        kind: 'message',
        timestamp: 1,
        role: 'platform',
        label: 'platform',
        meta: [],
        text:
          'The previous turn ended without setting required workflow outputs: answer. ' +
          'Call set_output for each missing key, then provide your final response.',
        terminalFailure: false,
      },
    ]);
  });

  it('expands assistant text, thinking, and tool-use blocks in order', () => {
    const context = createClaudeParseContext();
    const rows = parseClaudeSessionRecord(
      record({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {type: 'text', text: 'I will inspect the repo.'},
            {type: 'thinking', thinking: 'Need the failing file first.'},
            {type: 'tool_use', id: 'tool-1', name: 'Read', input: {file_path: 'src/a.ts'}},
          ],
        },
      }),
      context,
    );

    expect([...rows, ...flushPendingToolRows(context)]).toEqual([
      {
        kind: 'message',
        timestamp: 1,
        role: 'assistant',
        label: 'assistant',
        meta: [],
        text: 'I will inspect the repo.',
        terminalFailure: false,
      },
      {kind: 'thinking', timestamp: 1, text: 'Need the failing file first.'},
      {
        kind: 'tool-call',
        timestamp: 1,
        id: 'tool-1',
        name: 'Read',
        input: '{\n  "file_path": "src/a.ts"\n}',
      },
    ]);
  });

  it('keeps assistant content after an identified tool call in order', () => {
    const context = createClaudeParseContext();
    const rows = parseClaudeSessionRecord(
      record({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {type: 'text', text: 'Before the tool.'},
            {type: 'tool_use', id: 'tool-1', name: 'Read', input: {file_path: 'src/a.ts'}},
            {type: 'text', text: 'After the tool.'},
          ],
        },
      }),
      context,
    );

    expect(rows).toEqual([
      {
        kind: 'message',
        timestamp: 1,
        role: 'assistant',
        label: 'assistant',
        meta: [],
        text: 'Before the tool.',
        terminalFailure: false,
      },
    ]);
    expect(flushPendingToolRows(context)).toEqual([
      {
        kind: 'tool-call',
        timestamp: 1,
        id: 'tool-1',
        name: 'Read',
        input: '{\n  "file_path": "src/a.ts"\n}',
      },
      {
        kind: 'message',
        timestamp: 1,
        role: 'assistant',
        label: 'assistant',
        meta: [],
        text: 'After the tool.',
        terminalFailure: false,
      },
    ]);
  });

  it('keeps mixed user tool-result and text rows in order', () => {
    const context = createClaudeParseContext();
    expect(
      parseClaudeSessionRecord(
        record({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {type: 'tool_use', id: 'tool-1', name: 'Read', input: {file_path: 'src/a.ts'}},
            ],
          },
        }),
        context,
      ),
    ).toEqual([]);

    expect(
      parseClaudeSessionRecord(
        record({
          type: 'user',
          message: {
            role: 'user',
            content: [
              {type: 'tool_result', tool_use_id: 'tool-1', content: 'file contents'},
              {type: 'text', text: 'The file was read.'},
            ],
          },
        }),
        context,
      ),
    ).toEqual([]);
    expect(flushPendingToolRows(context)).toEqual([
      {
        kind: 'tool-call',
        timestamp: 1,
        id: 'tool-1',
        name: 'Read',
        input: '{\n  "file_path": "src/a.ts"\n}',
      },
      {
        kind: 'tool-result',
        timestamp: 1,
        toolCallId: 'tool-1',
        toolName: expect.any(String),
        output: 'file contents',
        isError: false,
      },
      {
        kind: 'message',
        timestamp: 1,
        role: 'user',
        label: 'user',
        meta: [],
        text: 'The file was read.',
        terminalFailure: false,
      },
    ]);
  });

  it('keeps lifecycle rows behind a pending tool call until its summary arrives', () => {
    const context = createClaudeParseContext();
    expect(
      parseClaudeSessionRecord(
        record({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {type: 'tool_use', id: 'tool-1', name: 'Read', input: {file_path: 'src/a.ts'}},
            ],
          },
        }),
        context,
      ),
    ).toEqual([]);

    expect(
      parseClaudeSessionRecord(
        record({type: 'auth_status', isAuthenticating: true, output: []}),
        context,
      ),
    ).toEqual([]);

    expect(
      parseClaudeSessionRecord(
        record({
          type: 'tool_use_summary',
          preceding_tool_use_ids: ['tool-1'],
          summary: 'Read the source file.',
        }),
        context,
      ),
    ).toEqual([
      {
        kind: 'tool-call',
        timestamp: 1,
        id: 'tool-1',
        name: 'Read',
        input: '{\n  "file_path": "src/a.ts"\n}',
        summary: 'Read the source file.',
      },
      {
        kind: 'lifecycle',
        timestamp: 1,
        label: 'Authenticating',
        detail: null,
        meta: [],
        tone: 'default',
        terminalFailure: false,
      },
    ]);
  });

  it('maps user tool results to tool-result rows', () => {
    const rows = parseClaudeSessionRecord(
      record({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-1',
              content: [{type: 'text', text: 'file contents'}],
              is_error: true,
            },
          ],
        },
      }),
    );

    expect(rows).toEqual([
      {
        kind: 'tool-result',
        timestamp: 1,
        toolCallId: 'tool-1',
        toolName: expect.any(String),
        output: 'file contents',
        isError: true,
      },
    ]);
  });

  it('preserves mixed user text and tool-result block order', () => {
    const rows = parseClaudeSessionRecord(
      record({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {type: 'text', text: 'before'},
            {
              type: 'tool_result',
              tool_use_id: 'tool-1',
              content: [{type: 'text', text: 'tool output'}],
            },
            {type: 'text', text: 'after'},
          ],
        },
      }),
    );

    expect(rows).toEqual([
      {
        kind: 'message',
        timestamp: 1,
        role: 'user',
        label: 'user',
        meta: [],
        text: 'before',
        terminalFailure: false,
      },
      {
        kind: 'tool-result',
        timestamp: 1,
        toolCallId: 'tool-1',
        toolName: expect.any(String),
        output: 'tool output',
        isError: false,
      },
      {
        kind: 'message',
        timestamp: 1,
        role: 'user',
        label: 'user',
        meta: [],
        text: 'after',
        terminalFailure: false,
      },
    ]);
  });

  it('maps result messages to terminal lifecycle rows', () => {
    const rows = parseClaudeSessionRecord(
      record({
        type: 'result',
        subtype: 'error',
        is_error: true,
        result: 'Timed out',
        duration_ms: 1200,
        total_cost_usd: 0.0042,
      }),
    );

    expect(rows).toEqual([
      {
        kind: 'lifecycle',
        timestamp: 1,
        label: 'Session failed',
        detail: 'Timed out',
        meta: [
          {label: 'duration', value: '1,200 ms'},
          {label: 'cost', value: '$0.0042'},
        ],
        tone: 'error',
        terminalFailure: true,
      },
    ]);
  });
});
