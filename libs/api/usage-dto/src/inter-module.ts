import {defineInterModuleContract, type InterModuleClient} from '@shipfox/inter-module';
import {z} from 'zod';
import {
  inferenceSegmentInputSchema,
  inferenceSegmentUsageSchema,
  jobExecutionUsageSchema,
  MAX_INFERENCE_SEGMENTS_BATCH_SIZE,
  MAX_USAGE_REPLAY_LIMIT,
} from './schemas/usage.js';

const idSchema = z.string().uuid();
const dateTimeSchema = z.string().datetime();

export const jobExecutionUsageCursorSchema = z.object({
  recordedAt: dateTimeSchema,
  jobExecutionId: idSchema,
});
export type JobExecutionUsageCursor = z.infer<typeof jobExecutionUsageCursorSchema>;

export const inferenceSegmentUsageCursorSchema = z.object({
  recordedAt: dateTimeSchema,
  id: idSchema,
});
export type InferenceSegmentUsageCursor = z.infer<typeof inferenceSegmentUsageCursorSchema>;

export const usageInterModuleContract = defineInterModuleContract({
  module: 'usage',
  methods: {
    recordInferenceSegments: {
      input: z.object({
        segments: z.array(inferenceSegmentInputSchema).max(MAX_INFERENCE_SEGMENTS_BATCH_SIZE),
      }),
      output: z.object({
        recorded: z.number().int().nonnegative(),
        duplicates: z.number().int().nonnegative(),
      }),
    },
    listJobExecutionUsage: {
      input: z.object({
        workspaceId: idSchema.optional(),
        since: dateTimeSchema.optional(),
        cursor: jobExecutionUsageCursorSchema.optional(),
        limit: z.number().int().min(1).max(MAX_USAGE_REPLAY_LIMIT).default(MAX_USAGE_REPLAY_LIMIT),
      }),
      output: z.object({
        jobExecutions: z.array(jobExecutionUsageSchema),
        nextCursor: jobExecutionUsageCursorSchema.nullable(),
      }),
    },
    listInferenceSegments: {
      input: z.object({
        workspaceId: idSchema.optional(),
        since: dateTimeSchema.optional(),
        cursor: inferenceSegmentUsageCursorSchema.optional(),
        limit: z.number().int().min(1).max(MAX_USAGE_REPLAY_LIMIT).default(MAX_USAGE_REPLAY_LIMIT),
      }),
      output: z.object({
        segments: z.array(inferenceSegmentUsageSchema),
        nextCursor: inferenceSegmentUsageCursorSchema.nullable(),
      }),
    },
  },
});

export type UsageModuleClient = InterModuleClient<typeof usageInterModuleContract>;
