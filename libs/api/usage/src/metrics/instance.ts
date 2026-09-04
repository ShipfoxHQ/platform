import {instanceMetrics} from '@shipfox/node-opentelemetry';

export type UsageRecordOutcome = 'recorded' | 'duplicate';

export function addUsageMetric(
  counter: {add: (value: number, attributes: {outcome: UsageRecordOutcome}) => void},
  value: number,
  outcome: UsageRecordOutcome,
): void {
  try {
    counter.add(value, {outcome});
  } catch {
    // Metrics must not cause a durable event handler to retry after its commit.
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
