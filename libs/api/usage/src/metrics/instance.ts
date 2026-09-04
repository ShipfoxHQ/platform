import {instanceMetrics, logger} from '@shipfox/node-opentelemetry';

export type UsageRecordOutcome = 'recorded' | 'duplicate';

export function addUsageMetric(
  counter: {add: (value: number, attributes: {outcome: UsageRecordOutcome}) => void},
  value: number,
  outcome: UsageRecordOutcome,
): void {
  try {
    counter.add(value, {outcome});
  } catch {
    logger().debug({outcome, value}, 'Usage metric emission failed after durable commit');
  }
}

const meter = instanceMetrics.getMeter('usage');

export const usageJobExecutionRecorded = meter.createCounter<{outcome: UsageRecordOutcome}>(
  'usage_job_execution_recorded',
  {description: 'Usage job execution publication attempts by outcome'},
);

export const usageInferenceSegmentRecorded = meter.createCounter<{outcome: UsageRecordOutcome}>(
  'usage_inference_segment_recorded',
  {description: 'Usage inference segment capture attempts by outcome'},
);
