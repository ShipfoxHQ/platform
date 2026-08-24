import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';
import {serverLogRecordSchema} from './schemas/index.js';

const idSchema = z.string().uuid();

/**
 * Producer-owned Logs commands used by synchronous callers. The only method
 * today is the server-origin append for server-executed steps (the tool step
 * executor): it writes already-normalized stored records through the same
 * offset-CAS and budget pipeline as the lease-bound runner route, but with
 * chunk `origin` `server` and a tail-derived CAS offset (the caller owns no
 * spool cursor). This is a trusted internal boundary, not an authorization
 * boundary: the caller must derive the identity fields from its execution
 * context rather than pass through arbitrary external input.
 */
export const logsInterModuleContract = defineInterModuleContract({
  module: 'logs',
  methods: {
    appendServerRecords: {
      input: z.object({
        jobId: idSchema,
        workspaceId: idSchema,
        projectId: idSchema,
        workflowRunAttemptId: idSchema,
        stepId: idSchema,
        attempt: z
          .number()
          .int()
          .min(1)
          .max(2_147_483_647)
          .describe('Attempt number of the step this batch belongs to.'),
        /**
         * Already-normalized server-writable stored records (the read union
         * without server-only tombstones), serialized to whole newline-terminated
         * NDJSON lines on ingest. Server-origin records skip the raw-to-stored
         * normalization the runner path applies: they are stored verbatim. Callers should
         * coalesce records into batches up to (but never over) `LOG_APPEND_BODY_LIMIT_BYTES`;
         * an empty batch is reserved for a heartbeat. A server-origin writer owns its stream;
         * it cannot be mixed with a lease-bound runner writer because their byte cursors differ.
         */
        records: z.array(serverLogRecordSchema),
      }),
      output: z.object({
        committedLength: z
          .number()
          .int()
          .min(0)
          .describe(
            'New server-held byte position of the stream after this batch was applied (the tail the next call continues from).',
          ),
        capped: z
          .boolean()
          .describe(
            'When true, the per-job log budget is exhausted and further output is dropped.',
          ),
      }),
      errors: {
        'lease-stream-mismatch': z.object({}),
        'malformed-log-chunk': z.object({}),
        'append-body-too-large': z.object({maxBytes: z.number().int().positive()}),
        'runner-writer-active': z.object({}),
        'offset-gap': z.object({committedLength: z.number().int().nonnegative()}),
      },
    },
  },
});

export type LogsModuleClient = InterModuleClient<typeof logsInterModuleContract>;
