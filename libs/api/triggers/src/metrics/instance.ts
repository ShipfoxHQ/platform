import {instanceMetrics} from '@shipfox/node-opentelemetry';
import type {TriggerEventOrigin} from '#core/entities/received-event.js';

const meter = instanceMetrics.getMeter('triggers');
type TriggerEventMetricOrigin = Exclude<TriggerEventOrigin, 'cron'>;

export const eventReceivedCount = meter.createCounter<{
  provider: string;
  origin: TriggerEventMetricOrigin;
}>('triggers_event_received', {
  description: 'Trigger events received by provider and origin',
});

export const subscriptionTriggeredCount = meter.createCounter<{
  provider: string;
  origin: TriggerEventMetricOrigin;
}>('triggers_subscription_triggered', {
  description: 'Subscriptions that resulted in a workflow run, by provider and origin',
});

export const listenerDeliveryRejectionsCount = meter.createCounter<{
  reason: 'payload_too_large';
}>('triggers_listener_delivery_rejections', {
  description: 'Listener delivery rejections by bounded reason',
});

export const eventOutcomeCount = meter.createCounter<{
  provider: string;
  origin: TriggerEventMetricOrigin;
  outcome: 'discarded' | 'routed' | 'failed' | 'errored';
}>('triggers_event_outcome', {
  description: 'Final outcomes of trigger events by provider, origin, and outcome',
});

export const cronFiredCount = meter.createCounter<{outcome: 'fired' | 'errored'}>(
  'triggers_cron_fired',
  {description: 'Cron schedule slots consumed by the tick, by fire outcome'},
);

export const devRunsCount = meter.createCounter<{
  trigger_kind: 'manual' | 'cron' | 'replay';
  outcome: 'routed' | 'errored' | 'failed' | 'filtered';
}>('triggers_dev_runs', {
  description: 'Dev runs started from POST /dev-runs by trigger kind and outcome',
});

export const diagnosticCount = meter.createCounter<{
  scope: 'decision' | 'event';
  code: string;
}>('triggers_diagnostic', {
  description: 'Classified trigger processing diagnostics by bounded code and ownership scope',
});

export const cronFireLag = meter.createHistogram<Record<string, never>>('triggers_cron_fire_lag', {
  description: 'Delay between a cron scheduled slot and when the tick actually fired it',
  unit: 'ms',
  advice: {explicitBucketBoundaries: [0, 100, 500, 1000, 5000, 15000, 60000, 300000]},
});
