import type {
  SessionViewLifecycleRow,
  SessionViewRow,
  SessionViewRowMeta,
  SessionViewToolCallRow,
  SessionViewToolResultRow,
} from '@shipfox/api-logs-dto';
import {asLooseObject} from '../entry-schema.js';
import {
  booleanField,
  field,
  formatNumber,
  isMeta,
  metaItem,
  stringField,
  stringifyValue,
  toJson,
} from '../object.js';
import {lifecycleRow, messageRow, thinkingRow} from '../rows.js';

export const PURE_PROGRESS_CLAUDE_SYSTEM_SUBTYPES = new Set<string>([
  'thinking_tokens',
  'status',
  'session_state_changed',
  'task_progress',
  'hook_progress',
  'hook_started',
  'commands_changed',
  'files_persisted',
  'memory_recall',
  'local_command_output',
  'plugin_install',
]);

export function systemRow(
  timestamp: number,
  message: Record<string, unknown>,
): SessionViewLifecycleRow {
  const subtype = stringField(message, 'subtype');
  const label = subtype === 'init' || message.type === 'init' ? 'Session started' : 'Session event';
  const detail = stringField(message, 'session_id') ?? stringField(message, 'sessionId') ?? null;
  const meta = [
    metaItem('cwd', stringField(message, 'cwd'), false),
    metaItem('model', stringField(message, 'model')),
    metaItem(
      'permission',
      stringField(message, 'permissionMode') ?? stringField(message, 'permission_mode'),
    ),
  ].filter(isMeta);

  return lifecycleRow(timestamp, label, detail, 'default', false, meta);
}

export function assistantRows(
  timestamp: number,
  message: Record<string, unknown>,
): readonly SessionViewRow[] {
  const sdkMessage = asLooseObject(message.message) ?? message;
  const rows: SessionViewRow[] = [];
  const textParts: string[] = [];
  const thinkingParts: string[] = [];

  const pushText = () => {
    if (textParts.length === 0) return;
    rows.push(messageRow(timestamp, 'assistant', 'assistant', textParts.join('\n\n'), false));
    textParts.length = 0;
  };
  const pushThinking = () => {
    if (thinkingParts.length === 0) return;
    rows.push(thinkingRow(timestamp, thinkingParts.join('\n\n')));
    thinkingParts.length = 0;
  };

  for (const block of contentBlocks(sdkMessage)) {
    const type = stringField(block, 'type');
    if (type === 'tool_use' || type === 'tool-use' || type === 'toolCall') {
      pushText();
      pushThinking();
      rows.push(toolCallRow(timestamp, block));
      continue;
    }

    if (type === 'thinking' || type === 'reasoning') {
      pushText();
      const text = blockText(block);
      if (text) thinkingParts.push(text);
      continue;
    }

    pushThinking();
    const text = blockText(block);
    if (text) textParts.push(text);
  }

  pushText();
  pushThinking();

  if (rows.length > 0) return rows;

  const text = stringField(sdkMessage, 'content') ?? stringField(message, 'result');
  return [messageRow(timestamp, 'assistant', 'assistant', text ?? toJson(message), false)];
}

export function userRows(
  timestamp: number,
  message: Record<string, unknown>,
): readonly SessionViewRow[] {
  const sdkMessage = asLooseObject(message.message) ?? message;
  const rows: SessionViewRow[] = [];
  const textParts: string[] = [];
  const pushText = () => {
    if (textParts.length === 0) return;
    rows.push(messageRow(timestamp, 'user', 'user', textParts.join('\n\n'), false));
    textParts.length = 0;
  };

  for (const block of contentBlocks(sdkMessage)) {
    const type = stringField(block, 'type');
    if (type === 'tool_result' || type === 'tool-result') {
      pushText();
      rows.push(toolResultRow(timestamp, block));
      continue;
    }

    const text = blockText(block);
    if (text) textParts.push(text);
  }

  pushText();

  if (rows.length > 0) return rows;

  const content = stringField(sdkMessage, 'content');
  return [messageRow(timestamp, 'user', 'user', content ?? toJson(message), false)];
}

export function resultRow(
  timestamp: number,
  message: Record<string, unknown>,
): SessionViewLifecycleRow {
  const isError = booleanField(message, 'is_error') || booleanField(message, 'isError');
  const subtype = stringField(message, 'subtype');
  const terminalFailure = isError || subtype === 'error';
  const detail =
    stringField(message, 'result') ??
    stringField(message, 'error') ??
    stringField(message, 'message') ??
    null;
  const meta = [
    numberMeta(message, 'duration_ms', 'duration', 'ms'),
    numberMeta(message, 'duration_api_ms', 'api duration', 'ms'),
    numberMeta(message, 'num_turns', 'turns'),
    costMeta(message),
  ].filter(isMeta);

  return lifecycleRow(
    timestamp,
    terminalFailure ? 'Session failed' : 'Session completed',
    detail,
    terminalFailure ? 'error' : 'default',
    terminalFailure,
    meta,
  );
}

function contentBlocks(message: Record<string, unknown>): Record<string, unknown>[] {
  const content = message.content;
  if (!Array.isArray(content)) return [];

  return content.flatMap((block) => {
    const object = asLooseObject(block);
    return object ? [object] : [];
  });
}

function toolCallRow(timestamp: number, block: Record<string, unknown>): SessionViewToolCallRow {
  return {
    kind: 'tool-call',
    timestamp,
    id: stringField(block, 'id') ?? null,
    name: stringField(block, 'name') ?? 'tool',
    input: stringifyValue(field(block, 'input') ?? {}),
  };
}

function toolResultRow(
  timestamp: number,
  block: Record<string, unknown>,
): SessionViewToolResultRow {
  return {
    kind: 'tool-result',
    timestamp,
    toolCallId: stringField(block, 'tool_use_id') ?? stringField(block, 'toolUseId') ?? null,
    toolName: stringField(block, 'name') ?? 'tool',
    output: blockText(block) || stringifyValue(field(block, 'content') ?? ''),
    isError: booleanField(block, 'is_error') || booleanField(block, 'isError'),
  };
}

function blockText(block: Record<string, unknown>): string {
  const content = field(block, 'content');
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        const object = asLooseObject(item);
        return object ? blockText(object) : typeof item === 'string' ? item : '';
      })
      .filter(Boolean)
      .join('\n\n');
  }

  return (
    stringField(block, 'text') ??
    stringField(block, 'thinking') ??
    (typeof content === 'string' ? content : '') ??
    ''
  );
}

function numberMeta(
  value: unknown,
  key: string,
  label: string,
  unit?: string,
): SessionViewRowMeta | null {
  const raw = field(value, key);
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;

  return metaItem(label, unit ? `${formatNumber(raw)} ${unit}` : formatNumber(raw));
}

function costMeta(message: Record<string, unknown>): SessionViewRowMeta | null {
  const value = field(message, 'total_cost_usd') ?? field(message, 'totalCostUsd');
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;

  return metaItem('cost', `$${value.toFixed(value < 0.01 ? 4 : 2)}`);
}
