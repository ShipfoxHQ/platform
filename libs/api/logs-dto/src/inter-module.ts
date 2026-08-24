import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';
import {logRecordSchema} from './schemas/index.js';

const idSchema = z.string().uuid();

/**
 * Producer-owned Logs commands used by synchronous callers. The only method
 * today is the server-origin append for server-executed steps (the tool step
 * executor): it writes already-normalized stored records through the same
 * offset-CAS and budget pipeline as the lease-bound runner route, but with
 * chunk `origin` `server` and a tail-derived CAS offset (the caller owns no
 * spool cursor).
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
         * Already-normalized stored records (the read union), serialized to
         * whole newline-terminated NDJSON lines on ingest. Server-origin
         * records skip the raw-to-stored normalization the runner path
         * applies: they are stored verbatim.
         */
        records: z.array(logRecordSchema),
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
    },
  },
});

export type LogsModuleClient = InterModuleClient<typeof logsInterModuleContract>;
