import {parseClaudeSessionRecord} from './claude-parser.js';

const record = (data: unknown, ts = 1) => ({
  ts,
  data: typeof data === 'string' ? data : JSON.stringify(data),
});

describe('parseClaudeSessionRecord', () => {
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
        detail: 'session-1',
        meta: [
          {label: 'cwd', value: '/workspace', inline: false},
          {label: 'model', value: 'claude-opus-4-8'},
        ],
        tone: 'default',
        terminalFailure: false,
      },
    ]);
  });

  it('expands assistant text, thinking, and tool-use blocks in order', () => {
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
    );

    expect(rows).toEqual([
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
        toolName: 'tool',
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
        toolName: 'tool',
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
