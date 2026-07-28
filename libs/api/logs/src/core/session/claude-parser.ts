import type {SessionViewRow, SessionViewToolCallRow} from '@shipfox/api-logs-dto';
import {z} from 'zod';
import {
  assistantRows,
  authStatusRow,
  flushPendingToolRows,
  PURE_PROGRESS_CLAUDE_SYSTEM_SUBTYPES,
  rateLimitRow,
  resultRow,
  systemRow,
  toolUseSummary,
  userRows,
} from './claude/rows.js';
import {stringField} from './object.js';
import {rawRecordRow} from './rows.js';
import type {AgentSessionRecord} from './session-record.js';

const claudeMessageSchema = z
  .object({
    type: z.string().min(1),
  })
  .catchall(z.unknown());

export interface ClaudeParseContext {
  hasInit: boolean;
  sessionId: string | null;
  turn: number;
  pendingToolRows: SessionViewRow[];
  toolCallRows: Map<string, SessionViewToolCallRow>;
}

export function createClaudeParseContext(
  pendingToolRows: readonly SessionViewRow[] = [],
  state: Pick<ClaudeParseContext, 'hasInit' | 'sessionId' | 'turn'> = {
    hasInit: false,
    sessionId: null,
    turn: 0,
  },
): ClaudeParseContext {
  const rows = [...pendingToolRows];
  const toolCallRows = new Map<string, SessionViewToolCallRow>();
  for (const row of rows) {
    if (row.kind === 'tool-call' && row.id !== null) toolCallRows.set(row.id, row);
  }

  return {...state, pendingToolRows: rows, toolCallRows};
}

export function claudeInitSessionId(record: AgentSessionRecord): string | undefined {
  let json: unknown;
  try {
    json = JSON.parse(record.data);
  } catch {
    return undefined;
  }

  const parsed = claudeMessageSchema.safeParse(json);
  if (!parsed.success) return undefined;

  const message = parsed.data;
  if (
    message.type !== 'init' &&
    !(message.type === 'system' && stringField(message, 'subtype') === 'init')
  ) {
    return undefined;
  }

  return stringField(message, 'session_id') ?? stringField(message, 'sessionId');
}

export function parseClaudeSessionRecord(
  record: AgentSessionRecord,
  context: ClaudeParseContext = createClaudeParseContext(),
  isFinalResult = true,
): readonly SessionViewRow[] {
  let json: unknown;
  try {
    json = JSON.parse(record.data);
  } catch {
    return [...flushPendingToolRows(context), rawRecordRow(record, 'Malformed session entry')];
  }

  const parsed = claudeMessageSchema.safeParse(json);
  if (!parsed.success) {
    return [...flushPendingToolRows(context), rawRecordRow(record, 'Unsupported Claude message')];
  }

  const message = parsed.data;
  if (
    message.type === 'system' &&
    typeof message.subtype === 'string' &&
    PURE_PROGRESS_CLAUDE_SYSTEM_SUBTYPES.has(message.subtype)
  ) {
    return [];
  }

  switch (message.type) {
    case 'system':
      return stringField(message, 'subtype') === 'init'
        ? [...flushPendingToolRows(context), systemRow(record.ts, message, context)]
        : [systemRow(record.ts, message, context)];
    case 'init':
      return [...flushPendingToolRows(context), systemRow(record.ts, message, context)];
    case 'tool_progress':
    case 'prompt_suggestion':
      // These messages describe an already-emitted tool call or an interactive client state.
      // They have no standalone row representation and must not look like parser failures.
      return [];
    case 'tool_use_summary':
      return toolUseSummary(message, context) ? flushPendingToolRows(context) : [];
    case 'auth_status':
      return [authStatusRow(record.ts, message)];
    case 'rate_limit_event':
      return [rateLimitRow(record.ts, message)];
    case 'assistant':
      return [...flushPendingToolRows(context), ...assistantRows(record.ts, message, context)];
    case 'user':
      return userRows(record.ts, message, context);
    case 'result':
      return [
        ...flushPendingToolRows(context),
        resultRow(record.ts, message, context.turn, isFinalResult),
      ];
    default:
      return [
        ...flushPendingToolRows(context),
        rawRecordRow(record, `Unknown Claude message: ${message.type}`),
      ];
  }
}
