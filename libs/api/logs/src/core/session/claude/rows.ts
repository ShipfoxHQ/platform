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
  'background_tasks_changed',
  'control_request_progress',
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

function hookResponseLabel(outcome: string | undefined): string {
  if (outcome === 'error') return 'Hook failed';
  if (outcome === 'cancelled') return 'Hook cancelled';
  if (outcome === 'success') return 'Hook completed';
  return 'Hook response';
}

function hookResponseTone(outcome: string | undefined): SessionViewLifecycleRow['tone'] {
  if (outcome === 'error') return 'error';
  if (outcome === 'cancelled') return 'warning';
  return 'default';
}

export const SYSTEM_EVENT_MAPPINGS: Record<string, SystemEventMapping> = {
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
  hook_response: {
    label: (message) => {
      const outcome = stringField(message, 'outcome');
      return hookResponseLabel(outcome);
    },
    tone: (message) => {
      const outcome = stringField(message, 'outcome');
      return hookResponseTone(outcome);
    },
    detail: (message) =>
      stringField(message, 'output') ??
      stringField(message, 'stderr') ??
      stringField(message, 'stdout') ??
      null,
    meta: (message) =>
      [
        metaItem('hook', stringField(message, 'hook_name')),
        numberMeta(message, 'exit_code', 'exit code'),
      ].filter(isMeta),
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

  if (!isInit) return systemEventRow(timestamp, message, subtype, baseMeta);

  const isNewSession = initializeClaudeSession(context, sessionId);

  const label = isNewSession ? 'Session started' : `Turn ${context.turn} started`;
  const meta = [
    metaItem('session', isNewSession ? sessionId : null),
    metaItem('turn', isNewSession ? null : String(context.turn)),
    ...baseMeta,
  ].filter(isMeta);

  return lifecycleRow(timestamp, label, null, 'default', false, meta);
}

function systemEventRow(
  timestamp: number,
  message: Record<string, unknown>,
  subtype: string | undefined,
  baseMeta: readonly SessionViewRowMeta[],
): SessionViewLifecycleRow {
  const mapping = subtype === undefined ? undefined : SYSTEM_EVENT_MAPPINGS[subtype];
  let label = `Session event (${subtype ?? 'unknown'})`;
  let tone: SessionViewLifecycleRow['tone'] = 'default';
  if (mapping !== undefined) {
    label = typeof mapping.label === 'function' ? mapping.label(message) : mapping.label;
    tone = typeof mapping.tone === 'function' ? mapping.tone(message) : mapping.tone;
  }
  return lifecycleRow(timestamp, label, mapping?.detail?.(message) ?? null, tone, false, [
    ...baseMeta,
    ...(mapping?.meta?.(message) ?? []),
  ]);
}

function initializeClaudeSession(
  context: ClaudeParseContext,
  sessionId: string | undefined,
): boolean {
  const isNewSession =
    !context.hasInit || sessionId === undefined || sessionId !== context.sessionId;
  if (isNewSession) {
    context.pendingToolRows.length = 0;
    context.toolCallRows.clear();
  }
  context.hasInit = true;
  context.sessionId = sessionId ?? null;
  context.turn = isNewSession ? 1 : context.turn + 1;
  return isNewSession;
}

export function authStatusRow(
  timestamp: number,
  message: Record<string, unknown>,
): SessionViewLifecycleRow {
  const error = stringField(message, 'error');
  const output = stringList(field(message, 'output')).join('\n');
  const isAuthenticating = booleanField(message, 'isAuthenticating');

  let label = 'Authentication complete';
  if (error) label = 'Authentication failed';
  else if (isAuthenticating) label = 'Authenticating';

  return lifecycleRow(
    timestamp,
    label,
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
  let candidateIds = precedingToolUseIds;
  if (candidateIds.length === 0 && toolUseId !== undefined) candidateIds = [toolUseId];

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
  const state: ClaudeAssistantRowState = {
    context,
    rows: [],
    textParts: [],
    thinkingParts: [],
    queueRows: context.toolCallRows.size > 0,
  };

  for (const block of contentBlocks(sdkMessage)) {
    appendClaudeAssistantBlock(timestamp, block, state);
  }

  flushClaudeAssistantText(timestamp, state);
  flushClaudeAssistantThinking(timestamp, state);

  if (state.rows.length > 0 || state.queueRows) return state.rows;

  const text = stringField(sdkMessage, 'content') ?? stringField(message, 'result');
  return [messageRow(timestamp, 'assistant', 'assistant', text ?? toJson(message), false)];
}

interface ClaudeAssistantRowState {
  readonly context: ClaudeParseContext;
  readonly rows: SessionViewRow[];
  readonly textParts: string[];
  readonly thinkingParts: string[];
  queueRows: boolean;
}

function pushClaudeAssistantRow(row: SessionViewRow, state: ClaudeAssistantRowState): void {
  if (state.queueRows) state.context.pendingToolRows.push(row);
  else state.rows.push(row);
}

function flushClaudeAssistantText(timestamp: number, state: ClaudeAssistantRowState): void {
  if (state.textParts.length === 0) return;
  pushClaudeAssistantRow(
    messageRow(timestamp, 'assistant', 'assistant', state.textParts.join('\n\n'), false),
    state,
  );
  state.textParts.length = 0;
}

function flushClaudeAssistantThinking(timestamp: number, state: ClaudeAssistantRowState): void {
  if (state.thinkingParts.length === 0) return;
  pushClaudeAssistantRow(thinkingRow(timestamp, state.thinkingParts.join('\n\n')), state);
  state.thinkingParts.length = 0;
}

function appendClaudeAssistantBlock(
  timestamp: number,
  block: Record<string, unknown>,
  state: ClaudeAssistantRowState,
): void {
  const type = stringField(block, 'type');
  if (type === 'tool_use' || type === 'tool-use' || type === 'toolCall') {
    appendClaudeToolCall(timestamp, block, state);
    return;
  }
  if (type === 'thinking' || type === 'reasoning') {
    flushClaudeAssistantText(timestamp, state);
    const text = blockText(block);
    if (text) state.thinkingParts.push(text);
    return;
  }
  flushClaudeAssistantThinking(timestamp, state);
  const text = blockText(block);
  if (text) state.textParts.push(text);
}

function appendClaudeToolCall(
  timestamp: number,
  block: Record<string, unknown>,
  state: ClaudeAssistantRowState,
): void {
  flushClaudeAssistantText(timestamp, state);
  flushClaudeAssistantThinking(timestamp, state);
  const row = toolCallRow(timestamp, block);
  if (row.id === null) {
    pushClaudeAssistantRow(row, state);
    return;
  }
  state.queueRows = true;
  state.context.pendingToolRows.push(row);
  state.context.toolCallRows.set(row.id, row);
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
  const hadPendingToolCall = context.toolCallRows.size > 0;
  let matchedToolResult = false;
  const pushText = () => {
    if (textParts.length === 0) return;
    rows.push(messageRow(timestamp, role, role, textParts.join('\n\n'), false));
    textParts.length = 0;
  };

  for (const block of contentBlocks(sdkMessage)) {
    matchedToolResult =
      appendClaudeUserBlock(timestamp, block, context, rows, textParts, pushText) ||
      matchedToolResult;
  }

  pushText();

  if (rows.length === 0) {
    const content = stringField(sdkMessage, 'content');
    rows.push(messageRow(timestamp, role, role, content ?? toJson(message), false));
  }

  if (hadPendingToolCall) return resolvePendingClaudeUserRows(context, rows, matchedToolResult);
  return rows;
}

function appendClaudeUserBlock(
  timestamp: number,
  block: Record<string, unknown>,
  context: ClaudeParseContext,
  rows: SessionViewRow[],
  textParts: string[],
  pushText: () => void,
): boolean {
  const type = stringField(block, 'type');
  if (type !== 'tool_result' && type !== 'tool-result') {
    const text = blockText(block);
    if (text) textParts.push(text);
    return false;
  }
  pushText();
  const row = toolResultRow(timestamp, block);
  rows.push(row);
  return row.toolCallId !== null && context.toolCallRows.has(row.toolCallId);
}

function resolvePendingClaudeUserRows(
  context: ClaudeParseContext,
  rows: readonly SessionViewRow[],
  matchedToolResult: boolean,
): readonly SessionViewRow[] {
  if (matchedToolResult) {
    context.pendingToolRows.push(...rows);
    return [];
  }
  return [...flushPendingToolRows(context), ...rows];
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

  let label = `Turn ${turn} completed`;
  if (terminalFailure) label = 'Session failed';
  else if (isFinalResult || turn === 0) label = 'Session completed';

  return lifecycleRow(
    timestamp,
    label,
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
        if (object) return blockText(object);
        if (typeof item === 'string') return item;
        return '';
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
