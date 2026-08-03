import {z} from 'zod';

/**
 * Append endpoint contract: `POST .../steps/:stepId/logs?attempt=N&offset=B`.
 *
 * The body is raw NDJSON bytes (whole records, newline-terminated), not a
 * Zod-validated object: it is parsed line by line against the raw log record
 * union (`rawLogRecordSchema`). `offset` is a position in the raw
 * NDJSON spool stream; both `offset` and the returned `committed_length` are
 * bounded far below 2^53 by the accrual budget, so JavaScript `number` is safe.
 */
export const appendLogsQuerySchema = z.object({
  attempt: z.coerce
    .number()
    .int()
    .min(1)
    .max(2_147_483_647)
    .describe('Attempt number of the step this chunk belongs to.'),
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .describe(
      'Byte position of this chunk in the raw NDJSON spool. Must equal the server-held committed length: an earlier offset is acknowledged as already applied, a later offset returns 409 so the runner rewinds.',
    ),
});

export type AppendLogsQueryDto = z.infer<typeof appendLogsQuerySchema>;

export const appendLogsResponseSchema = z.object({
  committed_length: z
    .number()
    .int()
    .min(0)
    .describe('New server-held byte position after this chunk was applied.'),
  capped: z
    .boolean()
    .describe('When true, the per-job log budget is exhausted and further output is dropped.'),
});

export type AppendLogsResponseDto = z.infer<typeof appendLogsResponseSchema>;

/** Body of the 409 returned on an offset gap, so the runner rewinds its spool cursor. */
export const offsetGapResponseSchema = z.object({
  code: z.literal('offset-gap'),
  details: z.object({
    committed_length: z
      .number()
      .int()
      .min(0)
      .describe('Current server-held committed length the runner should rewind to.'),
  }),
});

export type OffsetGapResponseDto = z.infer<typeof offsetGapResponseSchema>;
