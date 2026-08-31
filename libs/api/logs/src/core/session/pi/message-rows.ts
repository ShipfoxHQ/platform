import type {
  SessionViewRow,
  SessionViewToolCallRow,
  SessionViewToolResultRow,
} from '@shipfox/api-logs-dto';
import {type AgentMessage, asContentBlocks, type ContentBlock} from '../entry-schema.js';
import {field, stringField, stringifyValue, toJson} from '../object.js';
import {messageRow} from '../rows.js';
import {
  assistantMeta,
  bashExecutionMeta,
  branchSummaryDetail,
  branchSummaryMeta,
  compactionDetail,
  compactionMeta,
  customEntryLabel,
  customEntryMeta,
  customEntryText,
  messageMeta,
} from './metadata.js';
import {
  bashExecutionText,
  blockText,
  isTerminalStop,
  isThinkingBlock,
  isToolCallBlock,
  isToolResultMessage,
  messageText,
  normalizeRole,
  roleLabel,
  terminalStopDetail,
} from './text.js';

export function expandMessageEntry(
  timestamp: number,
  message: AgentMessage,
): readonly SessionViewRow[] {
  const role = normalizeRole(message);

  if (isToolResultMessage(message)) return [toolResultRow(timestamp, message)];

  if (role === 'assistant') return expandAssistantMessage(timestamp, message);

  if (role === 'bash-execution') {
    return [
      messageRow(
        timestamp,
        role,
        'bash execution',
        bashExecutionText(message),
        isTerminalStop(message),
        bashExecutionMeta(message),
      ),
    ];
  }
  if (role === 'branch-summary') {
    return [
      messageRow(
        timestamp,
        role,
        'branch summary',
        branchSummaryDetail(message) ?? toJson(message),
        isTerminalStop(message),
        branchSummaryMeta(message),
      ),
    ];
  }
  if (role === 'compaction-summary') {
    return [
      messageRow(
        timestamp,
        role,
        'compaction summary',
        compactionDetail(message) ?? toJson(message),
        isTerminalStop(message),
        compactionMeta(message),
      ),
    ];
  }
  if (role === 'custom') {
    return [
      messageRow(
        timestamp,
        role,
        customEntryLabel('custom'),
        customEntryText(message) ?? toJson(message),
        isTerminalStop(message),
        customEntryMeta(message),
      ),
    ];
  }

  const text = messageText(message);
  return [
    messageRow(
      timestamp,
      role,
      roleLabel(role),
      text || toJson(message),
      isTerminalStop(message),
      messageMeta(message),
    ),
  ];
}

function expandAssistantMessage(
  timestamp: number,
  message: AgentMessage,
): readonly SessionViewRow[] {
  const blocks = asContentBlocks(message.content);
  const terminalFailure = isTerminalStop(message);
  const meta = assistantMeta(message);
  if (blocks.length === 0) {
    const text = messageText(message);
    return [
      messageRow(
        timestamp,
        'assistant',
        'assistant',
        text || terminalStopDetail(message) || toJson(message),
        terminalFailure,
        meta,
      ),
    ];
  }

  const rows: SessionViewRow[] = [];
  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  const pushTextParts = () => {
    if (textParts.length === 0) return;
    rows.push(
      messageRow(
        timestamp,
        'assistant',
        'assistant',
        textParts.join('\n\n'),
        terminalFailure,
        meta,
      ),
    );
    textParts.length = 0;
  };
  const pushThinkingParts = () => {
    if (thinkingParts.length === 0) return;
    rows.push({kind: 'thinking', timestamp, text: thinkingParts.join('\n\n')});
    thinkingParts.length = 0;
  };

  for (const block of blocks) {
    if (isToolCallBlock(block)) {
      pushTextParts();
      pushThinkingParts();
      rows.push(toolCallRow(timestamp, block));
      continue;
    }

    if (isThinkingBlock(block)) {
      pushTextParts();
      const text = blockText(block);
      if (text) thinkingParts.push(text);
      continue;
    }

    pushThinkingParts();
    const text = blockText(block);
    if (text) textParts.push(text);
  }

  pushTextParts();
  pushThinkingParts();
  appendTerminalFailureRow(timestamp, message, terminalFailure, meta, rows);
  if (rows.length === 0)
    rows.push(
      messageRow(timestamp, 'assistant', 'assistant', toJson(message), terminalFailure, meta),
    );

  return rows;
}

function appendTerminalFailureRow(
  timestamp: number,
  message: AgentMessage,
  terminalFailure: boolean,
  meta: Parameters<typeof messageRow>[5],
  rows: SessionViewRow[],
): void {
  if (!terminalFailure) return;
  if (rows.some((row) => row.kind === 'message' && row.terminalFailure)) return;
  rows.push(
    messageRow(
      timestamp,
      'assistant',
      'assistant',
      terminalStopDetail(message) || toJson(message),
      true,
      meta,
    ),
  );
}

function toolCallRow(timestamp: number, block: ContentBlock): SessionViewToolCallRow {
  const id = stringField(block, 'id') ?? stringField(block, 'toolCallId') ?? null;
  const name = stringField(block, 'name') ?? stringField(block, 'toolName') ?? 'tool';
  const args = field(block, 'arguments') ?? field(block, 'input') ?? field(block, 'args') ?? {};

  return {kind: 'tool-call', timestamp, id, name, input: stringifyValue(args)};
}

function toolResultRow(timestamp: number, message: AgentMessage): SessionViewToolResultRow {
  const output = messageText(message) || stringifyValue(message.content ?? '');

  return {
    kind: 'tool-result',
    timestamp,
    toolCallId: message.toolCallId ?? null,
    toolName: message.toolName ?? 'tool',
    output,
    isError: message.isError === true,
  };
}
