import {instanceMetrics} from '@shipfox/node-opentelemetry';

export type UsageRecordOutcome = 'recorded' | 'duplicate';

const meter = instanceMetrics.getMeter('usage');

export const usageJobExecutionRecorded = meter.createCounter<{outcome: UsageRecordOutcome}>(
  'usage_job_execution_recorded',
  {description: 'Usage job execution publication attempts by outcome'},
);

export const usageInferenceSegmentRecorded = meter.createCounter<{outcome: UsageRecordOutcome}>(
  'usage_inference_segment_recorded',
  {description: 'Usage inference segment capture attempts by outcome'},
);
