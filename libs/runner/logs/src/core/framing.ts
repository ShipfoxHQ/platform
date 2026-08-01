import {Buffer} from 'node:buffer';
import {
  MAX_RECORD_DATA_BYTES,
  MAX_RECORD_NAME_BYTES,
  type RawLogRecord,
} from '@shipfox/api-logs-dto';

export type OutputSource = 'stdout' | 'stderr';

export const PIPES: readonly OutputSource[] = ['stdout', 'stderr'];

// Record builders. The DTO owns the schema and validation; the runner is the only
// component that frames records, so the constructors live here at the framing layer. The
// envelope is `{v, ts}` (no `src`); the pipe rides on `stream` for output, and group/end/gap
// are flat `type` records. Group ids are assigned by the caller's nesting stack.
function outputRecord(args: {ts: number; stream: OutputSource; data: string}): RawLogRecord {
  return {v: 1, ts: args.ts, type: 'output', stream: args.stream, data: args.data};
}

function groupStartRecord(args: {
  ts: number;
  groupId: string;
  parentGroupId: string | null;
  name: string;
}): RawLogRecord {
  return {
    v: 1,
    ts: args.ts,
    type: 'group_start',
    group_id: args.groupId,
    parent_group_id: args.parentGroupId,
    name: args.name,
  };
}

function groupEndRecord(args: {ts: number; groupId: string}): RawLogRecord {
  return {v: 1, ts: args.ts, type: 'group_end', group_id: args.groupId};
}

function gapRecord(args: {ts: number; droppedBytes: number}): RawLogRecord {
  return {v: 1, ts: args.ts, type: 'gap', dropped_bytes: args.droppedBytes};
}

function endRecord(args: {ts: number; totalBytes: number}): RawLogRecord {
  return {v: 1, ts: args.ts, type: 'end', total_bytes: args.totalBytes};
}

function agentSessionRecord(args: {ts: number; data: string}): RawLogRecord {
  return {v: 1, ts: args.ts, type: 'agent_session', data: args.data};
}

export interface FramedOutput {
  /** NDJSON line bytes (zero or more records), ready to append to the spool. */
  bytes: Buffer;
  /** `data` payload bytes across the produced records (budget/total accounting). */
  payloadBytes: number;
}

const EMPTY_FRAME: FramedOutput = {bytes: Buffer.alloc(0), payloadBytes: 0};

function encodeRecord(record: RawLogRecord): Buffer {
  return Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');
}

function utf8Length(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

/**
 * Split a (well-formed) string into pieces each at most `maxBytes` UTF-8 bytes,
 * cutting only on code-point boundaries so a multi-byte character is never torn.
 * A single code point is at most 4 bytes, so it always fits.
 */
export function splitByUtf8Bytes(text: string, maxBytes: number): string[] {
  // Fast path for the dominant case (a chunk well under the cap): one native byte
  // count instead of an O(n) per-code-point scan, with an identical single-part result.
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return [text];

  const parts: string[] = [];
  let start = 0;
  let bytes = 0;
  for (let i = 0; i < text.length; ) {
    const codePoint = text.codePointAt(i) ?? 0;
    const units = codePoint > 0xffff ? 2 : 1;
    const cpBytes = utf8Length(codePoint);
    if (bytes + cpBytes > maxBytes && bytes > 0) {
      parts.push(text.slice(start, i));
      start = i;
      bytes = 0;
    }
    bytes += cpBytes;
    i += units;
  }
  parts.push(text.slice(start));
  return parts;
}

/**
 * Encodes already-decoded, already-masked text and control markers into NDJSON records.
 * Decoding and masking happen upstream in the transform; this layer only frames: it splits
 * long output into <= 16KB records (so a single entry's size is bounded), stamps `ts` at
 * frame time, and emits the system control records. `data` is reconstructed by concatenating
 * output records, so callers keep newlines in the text they pass. Group ids/parents are
 * resolved by the caller's nesting stack and passed in.
 */
export class StreamFramer {
  constructor(private readonly now: () => number = Date.now) {}

  frameOutputText(text: string, source: OutputSource): FramedOutput {
    if (text.length === 0) return EMPTY_FRAME;
    const parts = splitByUtf8Bytes(text, MAX_RECORD_DATA_BYTES);
    const buffers: Buffer[] = [];
    let payloadBytes = 0;
    const ts = this.now();
    for (const part of parts) {
      buffers.push(encodeRecord(outputRecord({ts, stream: source, data: part})));
      payloadBytes += Buffer.byteLength(part, 'utf8');
    }
    return {bytes: Buffer.concat(buffers), payloadBytes};
  }

  // The group name is masked upstream; here it is byte-truncated to the DTO cap (which
  // measures UTF-8 bytes, not string length) so framing never emits a record the schema
  // rejects. splitByUtf8Bytes cuts on a code-point boundary, so the truncation never tears
  // a multi-byte character.
  frameGroupStart(name: string, groupId: string, parentGroupId: string | null): Buffer {
    const [truncated = ''] = splitByUtf8Bytes(name, MAX_RECORD_NAME_BYTES);
    return encodeRecord(
      groupStartRecord({ts: this.now(), groupId, parentGroupId, name: truncated}),
    );
  }

  frameGroupEnd(groupId: string): Buffer {
    return encodeRecord(groupEndRecord({ts: this.now(), groupId}));
  }

  frameGap(droppedBytes: number): Buffer {
    return encodeRecord(gapRecord({ts: this.now(), droppedBytes}));
  }

  frameEnd(totalBytes: number): Buffer {
    return encodeRecord(endRecord({ts: this.now(), totalBytes}));
  }

  // One verbatim agent session entry per record: never split (splitting would break the
  // entry's JSON). The caller drops an over-cap line before this runs. payloadBytes counts
  // the entry's bytes toward the stream's end total, like output `data`. An empty line frames
  // nothing (the DTO requires `data` non-empty), so it is never emitted as a record.
  frameAgentSession(line: string): FramedOutput {
    if (line.length === 0) return EMPTY_FRAME;
    return {
      bytes: encodeRecord(agentSessionRecord({ts: this.now(), data: line})),
      payloadBytes: Buffer.byteLength(line, 'utf8'),
    };
  }
}
