import type {LogRecord} from '@shipfox/api-logs-dto';
import {instanceMetrics} from '@shipfox/node-opentelemetry';

const meter = instanceMetrics.getMeter('logs');

export type LogRecordMetricKind = LogRecord['type'];

export const recordAppendedCount = meter.createCounter<{kind: LogRecordMetricKind}>(
  'logs_record_appended',
  {description: 'Log records appended to durable stream storage by record type'},
);

export const streamOpenedCount = meter.createCounter<Record<string, never>>('logs_stream_opened', {
  description: 'Log streams opened by first append',
});

// Byte-volume counters use the OpenTelemetry byte unit so Prometheus appends `_bytes` to the
// metric name. The two ingest axes MUST stay distinct:
//
//   raw ingested (CAS axis)      normalized stored (read axis)
//   append body bytes accepted   durable chunk bytes written after ingest
//   by the offset-CAS, before    normalization (agent_session records are parsed
//   normalization                into view rows), excluding server tombstones
//
// `logs_bytes_ingested` counts what the protocol accepted: every in-order CAS extension,
// including cap-crossing appends and post-cap accept-and-drop stragglers (their
// `committed_length` advances, so they are accepted even though nothing is stored).
// Retries, gaps, closed-stream appends, and empty heartbeats never extend the CAS and are
// never counted, so the same bytes are never double-counted. Runner and server-origin
// appends share the axis; the server-origin append derives its offset from the stream tail.
//
// `logs_bytes_stored` counts only normalized bodies durably written as chunk rows, so a
// capped job's dropped straggler and server-injected `capped`/`runner_lost` tombstones do
// not inflate it. ingested - stored is the normalization delta plus cap/close drops.
export const bytesIngestedCount = meter.createCounter<Record<string, never>>(
  'logs_bytes_ingested',
  {
    description:
      'Append body bytes accepted after offset validation (in-order CAS extension; retries, gaps, closed-stream and cap-dropped bodies excluded)',
    unit: 'By',
  },
);

export const bytesStoredCount = meter.createCounter<Record<string, never>>('logs_bytes_stored', {
  description:
    'Normalized durable bytes written to log chunks from runner and server appends (server tombstones and cap-dropped bodies excluded)',
  unit: 'By',
});

export const streamClosedCount = meter.createCounter<{reason: 'declared' | 'timeout'}>(
  'logs_stream_closed',
  {description: 'Log streams closed by reason'},
);

export type CompactionMetricOutcome =
  | 'already-compacted'
  | 'compacted'
  | 'failed'
  | 'gone'
  | 'retention-raced'
  | 'superseded';

export const compactionCount = meter.createCounter<{outcome: CompactionMetricOutcome}>(
  'logs_compaction',
  {description: 'Log stream compaction attempts by outcome'},
);

// Uncompressed NDJSON log bytes (not the gzip object size), matching the byte axis of the
// ingest/storage counters and the `uncompressed_bytes` object metadata. Recorded only once
// per stream on the single-winner publish, so an idempotent re-run (`already-compacted`) or
// a failed attempt never double-counts.
export const compactedBytesCount = meter.createCounter<Record<string, never>>(
  'logs_compacted_bytes',
  {
    description: 'Uncompressed log bytes successfully compacted to object storage',
    unit: 'By',
  },
);
