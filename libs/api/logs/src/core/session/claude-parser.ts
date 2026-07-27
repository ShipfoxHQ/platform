import type {SessionViewRow} from '@shipfox/api-logs-dto';
import {z} from 'zod';
import {
  assistantRows,
  PURE_PROGRESS_CLAUDE_SYSTEM_SUBTYPES,
  resultRow,
  systemRow,
  userRows,
} from './claude/rows.js';
import {rawRecordRow} from './rows.js';
import type {AgentSessionRecord} from './session-record.js';

const claudeMessageSchema = z
  .object({
    type: z.string().min(1),
  })
  .catchall(z.unknown());

export function parseClaudeSessionRecord(record: AgentSessionRecord): readonly SessionViewRow[] {
  let json: unknown;
  try {
    json = JSON.parse(record.data);
  } catch {
    return [rawRecordRow(record, 'Malformed session entry')];
  }

  const parsed = claudeMessageSchema.safeParse(json);
  if (!parsed.success) return [rawRecordRow(record, 'Unsupported Claude message')];

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
    case 'init':
      return [systemRow(record.ts, message)];
    case 'assistant':
      return assistantRows(record.ts, message);
    case 'user':
      return userRows(record.ts, message);
    case 'result':
      return [resultRow(record.ts, message)];
    default:
      return [rawRecordRow(record, `Unknown Claude message: ${message.type}`)];
  }
}
