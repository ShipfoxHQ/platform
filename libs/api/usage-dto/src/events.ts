import {z} from 'zod';
import {inferenceSegmentUsageSchema, recordedJobExecutionUsageSchema} from './schemas/usage.js';

export const USAGE_JOB_EXECUTION_RECORDED = 'usage.job_execution.recorded' as const;
export const USAGE_INFERENCE_SEGMENT_RECORDED = 'usage.inference_segment.recorded' as const;

export const usageJobExecutionRecordedEventSchema = recordedJobExecutionUsageSchema;
export type UsageJobExecutionRecordedEvent = z.infer<typeof usageJobExecutionRecordedEventSchema>;

export const usageInferenceSegmentRecordedEventSchema = inferenceSegmentUsageSchema
  .extend({version: z.literal(1)})
  .strict();
export type UsageInferenceSegmentRecordedEvent = z.infer<
  typeof usageInferenceSegmentRecordedEventSchema
>;

export interface UsageEventMap {
  [USAGE_JOB_EXECUTION_RECORDED]: UsageJobExecutionRecordedEvent;
  [USAGE_INFERENCE_SEGMENT_RECORDED]: UsageInferenceSegmentRecordedEvent;
}

export const usageEventSchemas = {
  [USAGE_JOB_EXECUTION_RECORDED]: usageJobExecutionRecordedEventSchema,
  [USAGE_INFERENCE_SEGMENT_RECORDED]: usageInferenceSegmentRecordedEventSchema,
} satisfies Record<keyof UsageEventMap, z.ZodType>;
