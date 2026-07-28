import type {
  SessionViewLifecycleRow,
  SessionViewRow,
  SessionViewRowMeta,
  SessionViewToolCallRow,
  SessionViewToolResultRow,
} from '@shipfox/api-logs-dto';
import type {ClaudeParseContext} from '../claude-parser.js';
import {asLooseObject} from '../entry-schema.js';
import {
  booleanField,
  field,
  formatNumber,
  isMeta,
  metaItem,
  numberField,
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
const OUTPUT_REPROMPT_PREFIX = 'The previous turn ended without setting required workflow outputs:';

type SystemEventMapping = {
  label: string | ((message: Record<string, unknown>) => string);
  tone:
    | SessionViewLifecycleRow['tone']
    | ((message: Record<string, unknown>) => SessionViewLifecycleRow['tone']);
  detail?: (message: Record<string, unknown>) => string | null;
  meta?: (message: Record<string, unknown>) => readonly SessionViewRowMeta[];
};

const SYSTEM_EVENT_MAPPINGS: Record<string, SystemEventMapping> = {
  permission_denied: {
    label: 'Permission denied',
    tone: 'error',
    detail: (message) => stringField(message, 'tool_name') ?? null,
    meta: (message) =>
      [
        metaItem(
          'reason',
          stringField(message, 'decision_reason') ?? stringField(message, 'message'),
        ),
      ].filter(isMeta),
  },
  api_retry: {
    label: 'API retry',
    tone: 'warning',
    detail: (message) => {
      const attempt = numberField(message, 'attempt');
      const maxRetries = numberField(message, 'max_retries');
      return attempt == null || maxRetries == null
        ? null
        : `attempt ${formatNumber(attempt)}/${formatNumber(maxRetries)}`;
    },
    meta: (message) =>
      [
        numberMeta(message, 'error_status', 'status'),
        numberMeta(message, 'retry_delay_ms', 'retry delay', 'ms'),
      ].filter(isMeta),
  },
  informational: {
    label: (message) => titleCase(stringField(message, 'level') ?? 'informational'),
    tone: (message) => (stringField(message, 'level') === 'warning' ? 'warning' : 'default'),
    detail: (message) => stringField(message, 'content') ?? null,
  },
  compact_boundary: {
    label: 'Context compacted',
    tone: 'default',
    meta: (message) => {
      const compactMetadata = asLooseObject(field(message, 'compact_metadata')) ?? {};
      return [
        metaItem('trigger', stringField(compactMetadata, 'trigger')),
        numberMeta(compactMetadata, 'pre_tokens', 'tokens before', 'tokens'),
        numberMeta(compactMetadata, 'post_tokens', 'tokens after', 'tokens'),
        numberMeta(compactMetadata, 'duration_ms', 'duration', 'ms'),
      ].filter(isMeta);
    },
  },
  model_refusal_fallback: {
    label: 'Model refused, fell back',
    tone: 'warning',
  },
  model_refusal_no_fallback: {
    label: 'Model refused',
    tone: 'error',
  },
  mirror_error: {
    label: 'Session mirror failed',
    tone: 'error',
    detail: (message) => stringField(message, 'error') ?? null,
  },
  worker_shutting_down: {
    label: 'Worker shutting down',
    tone: 'warning',
  },
  elicitation_complete: {
    label: 'Elicitation complete',
    tone: 'default',
  },
  notification: {
    label: 'Notification',
    tone: 'default',
  },
  task_started: {
    label: 'Task started',
    tone: 'default',
  },
  task_updated: {
    label: 'Task updated',
    tone: 'default',
  },
  task_notification: {
    label: 'Task notification',
    tone: 'default',
  },
};

export function systemRow(
  timestamp: number,
  message: Record<string, unknown>,
  context: ClaudeParseContext,
): SessionViewLifecycleRow {
  const subtype = stringField(message, 'subtype');
  const sessionId = stringField(message, 'session_id') ?? stringField(message, 'sessionId');
  const isInit = subtype === 'init' || message.type === 'init';
  const baseMeta = [
    metaItem('cwd', stringField(message, 'cwd'), false),
    metaItem('model', stringField(message, 'model')),
    metaItem(
      'permission',
      stringField(message, 'permissionMode') ?? stringField(message, 'permission_mode'),
    ),
  ].filter(isMeta);

  if (!isInit) {
    const mapping = subtype === undefined ? undefined : SYSTEM_EVENT_MAPPINGS[subtype];
    const label =
      mapping === undefined
        ? `Session event (${subtype ?? 'unknown'})`
        : typeof mapping.label === 'function'
          ? mapping.label(message)
          : mapping.label;
    const tone =
      mapping === undefined
        ? 'default'
        : typeof mapping.tone === 'function'
          ? mapping.tone(message)
          : mapping.tone;
    const detail = mapping?.detail?.(message) ?? null;
    const meta = [...baseMeta, ...(mapping?.meta?.(message) ?? [])];

    return lifecycleRow(timestamp, label, detail, tone, false, meta);
  }

  const isNewSession =
    !context.hasInit || sessionId === undefined || sessionId !== context.sessionId;
  if (isNewSession) {
    context.pendingToolRows.length = 0;
    context.toolCallRows.clear();
  }
  context.hasInit = true;
  context.sessionId = sessionId ?? null;
  context.turn = isNewSession ? 1 : context.turn + 1;

  const label = isNewSession ? 'Session started' : `Turn ${context.turn} started`;
  const meta = [
    metaItem('session', isNewSession ? sessionId : null),
    metaItem('turn', isNewSession ? null : String(context.turn)),
    ...baseMeta,
  ].filter(isMeta);

  return lifecycleRow(timestamp, label, null, 'default', false, meta);
}

export function authStatusRow(
  timestamp: number,
  message: Record<string, unknown>,
): SessionViewLifecycleRow {
  const error = stringField(message, 'error');
  const output = stringList(field(message, 'output')).join('\n');
  const isAuthenticating = booleanField(message, 'isAuthenticating');

  return lifecycleRow(
    timestamp,
    error
      ? 'Authentication failed'
      : isAuthenticating
        ? 'Authenticating'
        : 'Authentication complete',
    (error ?? output) || null,
    error ? 'error' : 'default',
    false,
  );
}

const RATE_LIMIT_STATUS_MAPPINGS: Record<
  string,
  {label: string; tone: SessionViewLifecycleRow['tone']}
> = {
  rejected: {label: 'Rate limit exceeded', tone: 'error'},
  allowed_warning: {label: 'Rate limit warning', tone: 'warning'},
  allowed: {label: 'Rate limit available', tone: 'default'},
};

export function rateLimitRow(
  timestamp: number,
  message: Record<string, unknown>,
): SessionViewLifecycleRow {
  const rateLimitInfo = asLooseObject(field(message, 'rate_limit_info')) ?? {};
  const status = stringField(rateLimitInfo, 'status');
  const rateLimitType = stringField(rateLimitInfo, 'rateLimitType');
  const utilization = numberField(rateLimitInfo, 'utilization');
  const mapping = status === undefined ? undefined : RATE_LIMIT_STATUS_MAPPINGS[status];
  const meta = [
    metaItem('utilization', utilization == null ? null : `${formatNumber(utilization * 100)}%`),
    mapping === undefined ? metaItem('status', status ?? null) : null,
  ].filter(isMeta);

  return lifecycleRow(
    timestamp,
    mapping?.label ?? 'Rate limit updated',
    rateLimitType == null ? null : humanizeEnumValue(rateLimitType),
    mapping?.tone ?? 'warning',
    false,
    meta,
  );
}

export function toolUseSummary(
  message: Record<string, unknown>,
  context: ClaudeParseContext,
): boolean {
  const summary = stringField(message, 'summary');
  if (summary === undefined) return false;

  const precedingToolUseIds = stringList(field(message, 'preceding_tool_use_ids'));
  const toolUseId = stringField(message, 'tool_use_id');
  const candidateIds =
    precedingToolUseIds.length > 0
      ? precedingToolUseIds
      : toolUseId === undefined
        ? []
        : [toolUseId];

  for (const id of [...candidateIds].reverse()) {
    const row = context.toolCallRows.get(id);
    if (row === undefined) continue;

    row.summary = row.summary === undefined ? summary : `${row.summary}\n\n${summary}`;
    return true;
  }

  return false;
}

export function flushPendingToolRows(context: ClaudeParseContext): readonly SessionViewRow[] {
  if (context.pendingToolRows.length === 0) return [];

  const rows = context.pendingToolRows;
  context.pendingToolRows = [];
  context.toolCallRows.clear();
  return rows;
}

function titleCase(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase()}${value.slice(1)}`;
}

function humanizeEnumValue(value: string): string {
  return titleCase(value.replaceAll('_', ' '));
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

export function assistantRows(
  timestamp: number,
  message: Record<string, unknown>,
  context: ClaudeParseContext,
): readonly SessionViewRow[] {
  const sdkMessage = asLooseObject(message.message) ?? message;
  const rows: SessionViewRow[] = [];
  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  let queuedToolCall = false;

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
      const row = toolCallRow(timestamp, block);
      if (row.id === null) {
        rows.push(row);
      } else {
        queuedToolCall = true;
        context.pendingToolRows.push(row);
        context.toolCallRows.set(row.id, row);
      }
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

  if (rows.length > 0 || queuedToolCall) return rows;

  const text = stringField(sdkMessage, 'content') ?? stringField(message, 'result');
  return [messageRow(timestamp, 'assistant', 'assistant', text ?? toJson(message), false)];
}

export function userRows(
  timestamp: number,
  message: Record<string, unknown>,
  context: ClaudeParseContext,
): readonly SessionViewRow[] {
  const sdkMessage = asLooseObject(message.message) ?? message;
  const role = isPlatformMessage(sdkMessage) ? 'platform' : 'user';
  const rows: SessionViewRow[] = [];
  const textParts: string[] = [];
  let queuedToolResult = false;
  const pushText = () => {
    if (textParts.length === 0) return;
    rows.push(messageRow(timestamp, role, role, textParts.join('\n\n'), false));
    textParts.length = 0;
  };

  for (const block of contentBlocks(sdkMessage)) {
    const type = stringField(block, 'type');
    if (type === 'tool_result' || type === 'tool-result') {
      pushText();
      const row = toolResultRow(timestamp, block);
      if (row.toolCallId !== null && context.toolCallRows.has(row.toolCallId)) {
        context.pendingToolRows.push(row);
        queuedToolResult = true;
      } else {
        rows.push(row);
      }
      continue;
    }

    const text = blockText(block);
    if (text) textParts.push(text);
  }

  pushText();

  if (queuedToolResult) return rows;
  if (rows.length > 0) return [...flushPendingToolRows(context), ...rows];

  const content = stringField(sdkMessage, 'content');
  return [
    ...flushPendingToolRows(context),
    messageRow(timestamp, role, role, content ?? toJson(message), false),
  ];
}

export function resultRow(
  timestamp: number,
  message: Record<string, unknown>,
  turn: number,
  isFinalResult: boolean,
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
    metaItem('turn', !terminalFailure && !isFinalResult && turn > 0 ? String(turn) : null),
    numberMeta(message, 'duration_ms', 'duration', 'ms'),
    numberMeta(message, 'duration_api_ms', 'api duration', 'ms'),
    numberMeta(message, 'num_turns', 'turns'),
    costMeta(message),
  ].filter(isMeta);

  return lifecycleRow(
    timestamp,
    terminalFailure
      ? 'Session failed'
      : isFinalResult || turn === 0
        ? 'Session completed'
        : `Turn ${turn} completed`,
    detail,
    terminalFailure ? 'error' : 'default',
    terminalFailure,
    meta,
  );
}

function isPlatformMessage(message: Record<string, unknown>): boolean {
  const content = field(message, 'content');
  if (typeof content === 'string') return content.startsWith(OUTPUT_REPROMPT_PREFIX);
  if (!Array.isArray(content)) return false;

  return content.some((block) => {
    const object = asLooseObject(block);
    return stringField(object, 'text')?.startsWith(OUTPUT_REPROMPT_PREFIX) === true;
  });
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
