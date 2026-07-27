import type {SessionViewRow} from '@shipfox/api-logs-dto';
import type {Harness} from '@shipfox/workflow-document';
import type {ClaudeParseContext} from './claude-parser.js';
import {parseClaudeSessionRecord} from './claude-parser.js';
import {parsePiSessionRecord} from './pi-parser.js';
import type {AgentSessionRecord} from './session-record.js';

export interface SessionParseContext {
  claude?: ClaudeParseContext;
  isFinalResult?: boolean;
}

export function parseSessionRecord(
  record: AgentSessionRecord,
  harness: Harness,
  context?: SessionParseContext,
): readonly SessionViewRow[] {
  try {
    return harness === 'claude'
      ? parseClaudeSessionRecord(record, context?.claude, context?.isFinalResult ?? true)
      : parsePiSessionRecord(record);
  } catch {
    return [
      {
        kind: 'raw',
        timestamp: record.ts,
        label: 'Unsupported session entry',
        raw: record.data,
      },
    ];
  }
}
