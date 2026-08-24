import {z} from 'zod';

/**
 * Read endpoint contract: `GET .../steps/:stepId/attempts/:attempt/logs?cursor=N`.
 *
 * `cursor` is an opaque chunk-sequence position, not a byte offset. Server-injected
 * control tombstones (`capped`, `runner_lost`) do not advance the runner byte axis, so
 * the read walks chunks by insertion `seq` to keep every record in stream order. The
 * same `seq` walk backs compaction, so the inline `ndjson` is byte-identical to the
 * decompressed compacted object. Start at 0 and echo back `next_cursor` to page forward.
 */
export const readLogsQuerySchema = z.object({
  cursor: z.coerce
    .number()
    .int()
    .min(0)
    .default(0)
    .describe(
      'Opaque chunk-sequence cursor. Start at 0; echo back the previous response next_cursor to page forward. Not a byte offset.',
    ),
});

export type ReadLogsQueryDto = z.infer<typeof readLogsQuerySchema>;

/**
 * Inline shape: stored NDJSON bytes from `cursor`, parsed client-side with
 * `parseLogRecordLine`. Served while the stream is open or closed but not yet compacted.
 * The bytes carry every record of every type for the `(step, attempt)`; the client
 * filters by record type for display.
 */
const readLogsInlineSchema = z.object({
  mode: z.literal('inline'),
  ndjson: z
    .string()
    .describe('Stored NDJSON: every record for this (step, attempt) from cursor, in stream order.'),
  next_cursor: z
    .number()
    .int()
    .min(0)
    .describe('Cursor to pass on the next poll to fetch records after this page.'),
  has_more: z
    .boolean()
    .describe(
      'True when more buffered records remain past this page; re-poll immediately to drain before tailing at the refresh interval.',
    ),
  state: z
    .enum(['open', 'closed'])
    .describe('Stream lifecycle: open still accepts appends, closed is terminal.'),
  truncated: z
    .boolean()
    .describe('True when the stream was force-closed because the runner stopped reporting.'),
});

/**
 * Presigned shape: a short-lived GET URL to the compacted object, fetched directly by
 * the browser (API egress bypassed). Served once the stream is compacted (`object_key`
 * set). The object is the same NDJSON the inline shape streams, gzip-compressed.
 */
const readLogsPresignedSchema = z.object({
  mode: z.literal('presigned'),
  url: z.string().url().describe('Presigned GET URL for the compacted NDJSON object.'),
  state: z
    .literal('closed')
    .describe('Compacted streams are closed before they are served by URL.'),
  expires_at: z
    .string()
    .datetime({offset: true})
    .describe('ISO 8601 instant after which the presigned URL stops working.'),
  total_bytes: z
    .number()
    .int()
    .min(0)
    .describe(
      'Committed append byte position for the attempt. This is the active writer CAS axis.',
    ),
  truncated: z
    .boolean()
    .describe('True when the stream was force-closed because the runner stopped reporting.'),
});

export const readLogsResponseSchema = z.discriminatedUnion('mode', [
  readLogsInlineSchema,
  readLogsPresignedSchema,
]);

export type ReadLogsResponseDto = z.infer<typeof readLogsResponseSchema>;
