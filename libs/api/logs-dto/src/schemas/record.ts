import {z} from 'zod';
import {sessionViewRowSchema} from './session-view.js';

/**
 * NDJSON log record contract: one JSON object per line, runner-framed.
 *
 * `offset` / `committed_length` are byte positions in the raw append NDJSON spool stream
 * (envelope included): the offset-CAS axis the runner tracks. The per-job accrual
 * budget charges the normalized NDJSON bytes the server stores, so framing and control records
 * count against it too. The per-record byte caps below bound each record so a single
 * entry's overhead is known and a runner cannot grow storage without moving the
 * budget: `data` is non-empty and <= MAX_RECORD_DATA_BYTES, the group `name` is
 * <= MAX_RECORD_NAME_BYTES, the group ids are <= MAX_RECORD_GROUP_ID_BYTES, and every
 * other field is fixed-shape.
 *
 * The envelope is `{v, ts}`, and every record is discriminated by a single flat
 * `type`. The raw/write and stored/read unions are distinct types: the server-only
 * `capped` / `runner_lost` tombstones are members of the read union only, so a forged
 * tombstone cannot pass append validation.
 *
 * The append-side `agent_session` record carries one verbatim agent session entry line
 * in `data`, forwarded opaquely by the runner. On successful ingest, the API normalizes
 * that raw entry into one or more read-side `agent_session` records whose `row` is the
 * canonical session view row. The raw and normalized records travel through the same log
 * append/read pipe; only their contract at each boundary differs.
 */

/** Largest decoded `data` payload per record. Longer lines are split by the runner. */
export const MAX_RECORD_DATA_BYTES = 16 * 1024;

/** Largest `group_start` name. Bounds the only variable-length control field. */
export const MAX_RECORD_NAME_BYTES = 1024;

/**
 * Largest `group_id` / `parent_group_id`. The runner emits short monotonic ids (`g1`,
 * `g2`, …); this only bounds a forged id from a lease-scoped writer so the ids stay a
 * fixed-shape field like every other record field.
 */
export const MAX_RECORD_GROUP_ID_BYTES = 256;

// UTF-8 byte length without node:buffer, so this shared DTO stays browser-safe (the
// client log viewer imports these types too). Identical to Buffer.byteLength(x, 'utf8').
const utf8Encoder = new TextEncoder();
const utf8ByteLength = (value: string): number => utf8Encoder.encode(value).length;

const groupId = z
  .string()
  .min(1, {message: 'group id must not be empty'})
  .refine((value) => utf8ByteLength(value) <= MAX_RECORD_GROUP_ID_BYTES, {
    message: `group id exceeds ${MAX_RECORD_GROUP_ID_BYTES} bytes`,
  });

const envelope = {
  v: z.literal(1),
  /** Epoch milliseconds, assigned by the runner at capture. */
  ts: z.number().int().nonnegative(),
};

const logOutput = z.object({
  ...envelope,
  type: z.literal('output'),
  stream: z.enum(['stdout', 'stderr']),
  data: z
    .string()
    .min(1, {message: 'output data must not be empty'})
    .refine((value) => utf8ByteLength(value) <= MAX_RECORD_DATA_BYTES, {
      message: `data exceeds ${MAX_RECORD_DATA_BYTES} payload bytes`,
    }),
});

const logGroupStart = z.object({
  ...envelope,
  type: z.literal('group_start'),
  group_id: groupId,
  parent_group_id: groupId.nullable(),
  name: z.string().refine((value) => utf8ByteLength(value) <= MAX_RECORD_NAME_BYTES, {
    message: `group name exceeds ${MAX_RECORD_NAME_BYTES} bytes`,
  }),
});

const logGroupEnd = z.object({...envelope, type: z.literal('group_end'), group_id: groupId});

const logEnd = z.object({
  ...envelope,
  type: z.literal('end'),
  total_bytes: z.number().int().nonnegative(),
});

const logGap = z.object({
  ...envelope,
  type: z.literal('gap'),
  dropped_bytes: z.number().int().nonnegative(),
});

// One verbatim agent session entry line, forwarded opaquely by the runner. `data` is
// intentionally uncapped here: the per-line byte limit is the server's configurable
// LOG_MAX_SESSION_LINE_BYTES (a Zod schema cannot read runtime config, and a static cap
// would collide with the body-limit invariant), enforced in the append write path.
const rawAgentSession = z.object({
  ...envelope,
  type: z.literal('agent_session'),
  data: z.string().min(1, {message: 'agent_session data must not be empty'}),
});

const agentSession = z.object({
  ...envelope,
  type: z.literal('agent_session'),
  row: sessionViewRowSchema,
});

// Server-only tombstones: NOT members of the raw write union.
const logCapped = z.object({...envelope, type: z.literal('capped')});
const logRunnerLost = z.object({...envelope, type: z.literal('runner_lost')});

/** Records a lease-scoped runner may append. The write path validates against this. */
export const rawLogRecordSchema = z.discriminatedUnion('type', [
  logOutput,
  logGroupStart,
  logGroupEnd,
  logEnd,
  logGap,
  rawAgentSession,
]);

/** Stored/read records: regular records, normalized agent sessions, and tombstones. */
export const logRecordSchema = z.discriminatedUnion('type', [
  logOutput,
  logGroupStart,
  logGroupEnd,
  logEnd,
  logGap,
  agentSession,
  logCapped,
  logRunnerLost,
]);

export type RawLogRecord = z.infer<typeof rawLogRecordSchema>;
export type LogRecord = z.infer<typeof logRecordSchema>;

export function parseLogRecordLine(line: string): LogRecord {
  return logRecordSchema.parse(JSON.parse(line));
}

/**
 * Parses one NDJSON line against the raw write union. A forged
 * server-only `capped` / `runner_lost` record fails here even though it is valid
 * under the read union: this is the write-path forgery guard.
 */
export function parseRawLogRecordLine(line: string): RawLogRecord {
  return rawLogRecordSchema.parse(JSON.parse(line));
}
