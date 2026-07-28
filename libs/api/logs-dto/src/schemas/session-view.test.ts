import {
  SESSION_VIEW_VERSION,
  type SessionViewRow,
  sessionViewRawRowSchema,
  sessionViewRowSchema,
  sessionViewSchema,
} from './session-view.js';

const timestamp = 1_765_531_200_123;

const rowsByKind: SessionViewRow[] = [
  {
    kind: 'message',
    timestamp,
    role: 'assistant',
    label: 'assistant',
    meta: [{label: 'model', value: 'anthropic/claude-opus-4'}],
    text: 'Implemented the change.',
    terminalFailure: false,
  },
  {kind: 'thinking', timestamp, text: 'Inspect the existing parser first.'},
  {
    kind: 'tool-call',
    timestamp,
    id: 'call-1',
    name: 'read_file',
    input: '{"path":"src/index.ts"}',
    summary: 'Read the source file.',
  },
  {
    kind: 'tool-result',
    timestamp,
    toolCallId: 'call-1',
    toolName: 'read_file',
    output: 'file contents',
    isError: false,
  },
  {
    kind: 'lifecycle',
    timestamp,
    label: 'Session started',
    detail: 'session-1',
    meta: [],
    tone: 'default',
    terminalFailure: false,
  },
  {
    kind: 'raw',
    timestamp,
    label: 'Unknown session entry',
    raw: '{"type":"future_entry","payload":{"value":true}}',
  },
];

describe('sessionViewRowSchema', () => {
  it.each(rowsByKind)('parses the $kind row', (row) => {
    const parsed = sessionViewRowSchema.parse(row);

    expect(parsed).toEqual(row);
  });

  it('rejects an unsupported row kind', () => {
    const parse = () => sessionViewRowSchema.parse({kind: 'harness-specific', timestamp});

    expect(parse).toThrow();
  });

  it('keeps the raw fallback variant harness-neutral', () => {
    const parsed = sessionViewRawRowSchema.parse({
      kind: 'raw',
      timestamp,
      label: 'Malformed session entry',
      raw: '{not json',
    });

    expect(parsed).toEqual({
      kind: 'raw',
      timestamp,
      label: 'Malformed session entry',
      raw: '{not json',
    });
  });
});

describe('sessionViewSchema', () => {
  it('parses the versioned session view envelope', () => {
    const parsed = sessionViewSchema.parse({v: SESSION_VIEW_VERSION, rows: rowsByKind});

    expect(parsed.rows).toHaveLength(rowsByKind.length);
  });

  it('rejects an unsupported session view version', () => {
    const parse = () => sessionViewSchema.parse({v: 2, rows: []});

    expect(parse).toThrow();
  });
});
