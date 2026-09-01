import {Buffer} from 'node:buffer';
import {
  type LogRecord,
  MAX_STEP_LOG_TAIL_LINES,
  parseLogRecordLine,
  type SessionViewLifecycleRow,
  type SessionViewMessageRow,
  type SessionViewRow,
  type SessionViewRowMeta,
  type SessionViewThinkingRow,
  type SessionViewToolCallRow,
  type SessionViewToolResultRow,
} from '@shipfox/api-logs-dto';

export {DEFAULT_STEP_LOG_TAIL_LINES, MAX_STEP_LOG_TAIL_LINES} from '@shipfox/api-logs-dto';

export const MAX_STEP_LOG_TAIL_BYTES = 256 * 1024;
export const MAX_STEP_LOG_LINE_BYTES = 8 * 1024;
export const STEP_LOG_TRUNCATION_MARKER = '...[TRUNCATED]';

const MAX_DATE_TIMESTAMP_MS = 8_640_000_000_000_000;
const MAX_TAIL_RECORD_BYTES = 32 * 1024;
const MAX_SESSION_META_ITEMS = 8;
const MAX_SESSION_META_LABEL_BYTES = 256;
const MAX_SESSION_META_VALUE_BYTES = 1_024;
const MAX_SESSION_FIELD_BYTES = 8 * 1024;

export interface TailLine {
  record: LogRecord;
  serialized: Buffer;
  rendered: string;
}

export interface TailResult {
  content: string;
  ndjson: Buffer;
  totalLines: number;
  retainedLines: number;
}

/**
 * Truncates by UTF-8 bytes and leaves the resulting string at a code-point boundary. The
 * marker is part of the limit, so callers can use this for both stored record fields and the
 * final rendered line without allowing a multibyte character to turn into U+FFFD.
 */
export function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length <= maxBytes) return value;
  if (maxBytes <= 0) return '';

  const marker = Buffer.from(STEP_LOG_TRUNCATION_MARKER, 'utf8');
  if (marker.length >= maxBytes) return marker.subarray(0, maxBytes).toString('utf8');

  let end = maxBytes - marker.length;
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
  return `${bytes.subarray(0, end).toString('utf8')}${STEP_LOG_TRUNCATION_MARKER}`;
}

function truncateSessionMeta(meta: readonly SessionViewRowMeta[]): SessionViewRowMeta[] {
  return meta.slice(0, MAX_SESSION_META_ITEMS).map((item) => ({
    label: truncateUtf8(item.label, MAX_SESSION_META_LABEL_BYTES),
    value: truncateUtf8(item.value, MAX_SESSION_META_VALUE_BYTES),
    ...(item.inline === undefined ? {} : {inline: item.inline}),
  }));
}

function truncateSessionRow(row: SessionViewRow): SessionViewRow {
  switch (row.kind) {
    case 'message':
      return {
        ...row,
        role: truncateUtf8(row.role, MAX_SESSION_META_LABEL_BYTES),
        label: truncateUtf8(row.label, MAX_SESSION_META_LABEL_BYTES),
        meta: truncateSessionMeta(row.meta),
        text: truncateUtf8(row.text, MAX_SESSION_FIELD_BYTES),
      } satisfies SessionViewMessageRow;
    case 'thinking':
      return {
        ...row,
        text: truncateUtf8(row.text, MAX_SESSION_FIELD_BYTES),
      } satisfies SessionViewThinkingRow;
    case 'tool-call':
      return {
        ...row,
        id: row.id === null ? null : truncateUtf8(row.id, MAX_SESSION_META_LABEL_BYTES),
        name: truncateUtf8(row.name, MAX_SESSION_META_LABEL_BYTES),
        input: truncateUtf8(row.input, MAX_SESSION_FIELD_BYTES),
        ...(row.summary === undefined
          ? {}
          : {summary: truncateUtf8(row.summary, MAX_SESSION_FIELD_BYTES)}),
      } satisfies SessionViewToolCallRow;
    case 'tool-result':
      return {
        ...row,
        toolCallId:
          row.toolCallId === null
            ? null
            : truncateUtf8(row.toolCallId, MAX_SESSION_META_LABEL_BYTES),
        toolName: truncateUtf8(row.toolName, MAX_SESSION_META_LABEL_BYTES),
        output: truncateUtf8(row.output, MAX_SESSION_FIELD_BYTES),
      } satisfies SessionViewToolResultRow;
    case 'lifecycle':
      return {
        ...row,
        label: truncateUtf8(row.label, MAX_SESSION_META_LABEL_BYTES),
        detail: row.detail === null ? null : truncateUtf8(row.detail, MAX_SESSION_FIELD_BYTES),
        meta: truncateSessionMeta(row.meta),
      } satisfies SessionViewLifecycleRow;
    case 'raw':
      return {
        ...row,
        label: truncateUtf8(row.label, MAX_SESSION_META_LABEL_BYTES),
        raw: truncateUtf8(row.raw, MAX_SESSION_FIELD_BYTES),
      };
  }
}

/** Produces the bounded record that is stored in the cold tail artifact. */
export function prepareTailRecord(record: LogRecord): LogRecord {
  let prepared: LogRecord;
  switch (record.type) {
    case 'output':
      prepared = {...record, data: truncateUtf8(record.data, MAX_SESSION_FIELD_BYTES)};
      break;
    case 'group_start':
      prepared = {...record, name: truncateUtf8(record.name, MAX_SESSION_FIELD_BYTES)};
      break;
    case 'agent_session':
      prepared = {...record, row: truncateSessionRow(record.row)};
      break;
    default:
      prepared = record;
  }

  const serializedBytes = Buffer.byteLength(`${JSON.stringify(prepared)}\n`, 'utf8');
  if (serializedBytes <= MAX_TAIL_RECORD_BYTES) return prepared;

  // A session row can contain an unbounded metadata array or otherwise unusual data from an
  // older writer. Keep the artifact line valid and useful even in that case; the normal path
  // above preserves the original record shape.
  return {
    v: 1,
    ts: record.ts,
    type: 'output',
    stream: record.type === 'output' ? record.stream : 'stdout',
    data: truncateUtf8(formatRecordText(prepared), MAX_SESSION_FIELD_BYTES),
  };
}

function stripLineEnding(value: string): string {
  let end = value.length;
  if (end > 0 && value[end - 1] === '\n') end--;
  if (end > 0 && value[end - 1] === '\r') end--;
  return value.slice(0, end);
}

function formatSessionRow(row: SessionViewRow): string {
  switch (row.kind) {
    case 'message':
      return `${row.role} ${row.label}: ${row.text}`;
    case 'thinking':
      return `thinking: ${row.text}`;
    case 'tool-call':
      return `tool ${row.name}: ${row.input}${row.summary ? ` (${row.summary})` : ''}`;
    case 'tool-result':
      return `tool result ${row.toolName}: ${row.output}`;
    case 'lifecycle':
      return row.detail ? `${row.label}: ${row.detail}` : row.label;
    case 'raw':
      return `${row.label}: ${row.raw}`;
  }
}

function formatRecordText(record: LogRecord): string {
  switch (record.type) {
    case 'output':
      return stripLineEnding(record.data);
    case 'group_start':
      return `group start ${record.name}`;
    case 'group_end':
      return `group end ${record.group_id}`;
    case 'end':
      return `end (${record.total_bytes} bytes)`;
    case 'gap':
      return `gap (${record.dropped_bytes} bytes dropped)`;
    case 'agent_session':
      return formatSessionRow(record.row);
    case 'capped':
      return 'log capped';
    case 'runner_lost':
      return 'runner lost';
  }
}

function recordChannel(record: LogRecord): string {
  if (record.type === 'output') return record.stream;
  if (record.type === 'agent_session') return 'agent';
  return 'system';
}

function formatTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return 'unknown-time';
  return new Date(Math.min(MAX_DATE_TIMESTAMP_MS, Math.max(0, timestamp))).toISOString();
}

function renderPreparedRecord(record: LogRecord): string {
  return truncateUtf8(
    `${formatTimestamp(record.ts)} ${recordChannel(record)}: ${formatRecordText(record)}`,
    MAX_STEP_LOG_LINE_BYTES,
  );
}

function invalidRecordLine(line: string): LogRecord {
  return {
    v: 1,
    ts: 0,
    type: 'output',
    stream: 'stdout',
    data: truncateUtf8(line || '[invalid log record]', MAX_SESSION_FIELD_BYTES),
  };
}

export function tailLineFromText(line: string): TailLine {
  let record: LogRecord;
  try {
    record = parseLogRecordLine(line);
  } catch {
    record = invalidRecordLine(line);
  }
  const prepared = prepareTailRecord(record);
  const serialized = Buffer.from(`${JSON.stringify(prepared)}\n`, 'utf8');
  return {record: prepared, serialized, rendered: renderPreparedRecord(prepared)};
}

export function tailLineFromRecord(record: LogRecord): TailLine {
  const prepared = prepareTailRecord(record);
  return {
    record: prepared,
    serialized: Buffer.from(`${JSON.stringify(prepared)}\n`, 'utf8'),
    rendered: renderPreparedRecord(prepared),
  };
}

class TailRing {
  #lines: TailLine[] = [];
  #bytes = 0;
  #totalLines = 0;

  constructor(
    private readonly maxLines: number,
    private readonly maxBytes: number,
  ) {}

  addForward(line: TailLine): void {
    this.#totalLines++;
    if (line.serialized.length > this.maxBytes) {
      this.#lines = [];
      this.#bytes = 0;
      return;
    }
    this.#lines.push(line);
    this.#bytes += line.serialized.length;
    while (this.#lines.length > this.maxLines || this.#bytes > this.maxBytes) {
      const removed = this.#lines.shift();
      if (!removed) break;
      this.#bytes -= removed.serialized.length;
    }
  }

  addReverse(line: TailLine): boolean {
    if (this.#lines.length >= this.maxLines) return false;
    if (line.serialized.length > this.maxBytes) return false;
    if (this.#lines.length > 0 && this.#bytes + line.serialized.length > this.maxBytes)
      return false;
    this.#totalLines++;
    this.#lines.unshift(line);
    this.#bytes += line.serialized.length;
    return true;
  }

  result(): TailResult {
    return {
      content: this.#lines.map((line) => line.rendered).join('\n'),
      ndjson: Buffer.concat(this.#lines.map((line) => line.serialized)),
      totalLines: this.#totalLines,
      retainedLines: this.#lines.length,
    };
  }
}

export class ForwardLogTail {
  readonly #ring: TailRing;
  #pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  #finished = false;

  constructor(
    maxLines: number = MAX_STEP_LOG_TAIL_LINES,
    maxBytes: number = MAX_STEP_LOG_TAIL_BYTES,
  ) {
    this.#ring = new TailRing(maxLines, maxBytes);
  }

  addChunk(chunk: Buffer): void {
    if (this.#finished || chunk.length === 0) return;
    const bytes = this.#pending.length > 0 ? Buffer.concat([this.#pending, chunk]) : chunk;
    let start = 0;
    while (true) {
      const newline = bytes.indexOf(0x0a, start);
      if (newline < 0) break;
      this.#ring.addForward(tailLineFromText(bytes.subarray(start, newline).toString('utf8')));
      start = newline + 1;
    }
    this.#pending = bytes.subarray(start);
  }

  finish(): TailResult {
    this.#finished = true;
    // Log chunks and objects are newline-terminated by the append contract. Deliberately drop
    // a trailing partial record so the operation only returns complete lines.
    this.#pending = Buffer.alloc(0);
    return this.#ring.result();
  }
}

/**
 * Reverse reader for hot chunks. Log append chunks contain complete NDJSON records, so each
 * chunk can be walked from its final newline without materializing the stream. A partial final
 * fragment from legacy data is omitted because the operation promises complete lines.
 */
export class ReverseLogTail {
  readonly #ring: TailRing;
  #stopped = false;

  constructor(
    maxLines: number = MAX_STEP_LOG_TAIL_LINES,
    maxBytes: number = MAX_STEP_LOG_TAIL_BYTES,
  ) {
    this.#ring = new TailRing(maxLines, maxBytes);
  }

  addChunk(chunk: Buffer): boolean {
    if (this.#stopped || chunk.length === 0) return false;

    let delimiter = chunk.length - 1;
    if (chunk[delimiter] !== 0x0a) {
      delimiter = chunk.lastIndexOf(0x0a);
      // Append chunks are whole NDJSON lines. A legacy partial suffix is not a complete line,
      // so leave it out and continue walking older complete records.
    }

    while (delimiter >= 0) {
      const previous = chunk.lastIndexOf(0x0a, delimiter - 1);
      const line = chunk.subarray(previous + 1, delimiter);
      if (line.length > 0 && !this.#ring.addReverse(tailLineFromText(line.toString('utf8')))) {
        this.#stopped = true;
        return false;
      }
      delimiter = previous;
    }
    return true;
  }

  finish(): TailResult {
    return this.#ring.result();
  }
}
