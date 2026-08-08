import {instanceMetrics} from '@shipfox/node-opentelemetry';

const meter = instanceMetrics.getMeter('provisioner-ec2');

export type Ec2Architecture = 'i386' | 'x86_64' | 'arm64' | 'unknown';

export interface Ec2DurationLabels {
  templateKey: string;
  market: 'spot' | 'on-demand';
  architecture: Ec2Architecture;
  availabilityZone: string;
}

export interface Ec2DurationObservation extends Ec2DurationLabels {
  durationMs: number;
}

const ec2DurationAdvice = {
  explicitBucketBoundaries: [
    100, 250, 500, 1_000, 5_000, 10_000, 15_000, 20_000, 30_000, 45_000, 60_000, 90_000, 120_000,
    300_000,
  ],
};

const launchCount = meter.createCounter<{
  market: 'spot' | 'on-demand';
  outcome: 'launched' | 'capacity' | 'throttled' | 'error';
}>('ec2_provisioner_launch', {
  description: 'EC2 runner launch attempts by market and outcome',
});

const terminateCount = meter.createCounter<{
  reason:
    | 'backend-terminate'
    | 'registration-deadline'
    | 'spot-interruption'
    | 'observed-terminated';
}>('ec2_provisioner_terminate', {
  description: 'EC2 runner instance terminations by reason',
});

const reconcileAbsentCount = meter.createCounter<Record<string, never>>(
  'ec2_provisioner_reconcile_absent',
  {description: 'EC2 runner instances the backend or AWS reported absent during reconciliation'},
);

const launchDuration = meter.createHistogram<{
  template_key: string;
  market: 'spot' | 'on-demand';
  architecture: Ec2Architecture;
  availability_zone: string;
}>('ec2_provisioner_launch_duration', {
  description:
    'EC2 RunInstances call duration by template, market, architecture, and availability zone',
  unit: 'ms',
  advice: ec2DurationAdvice,
});

const pendingDuration = meter.createHistogram<{
  template_key: string;
  market: 'spot' | 'on-demand';
  architecture: Ec2Architecture;
  availability_zone: string;
}>('ec2_provisioner_pending_duration', {
  description:
    'EC2 instance launch return to first observed running state duration by template, market, architecture, and availability zone',
  unit: 'ms',
  advice: ec2DurationAdvice,
});

export type Ec2LaunchOutcome = 'launched' | 'capacity' | 'throttled' | 'error';
export type Ec2TerminationReason =
  | 'backend-terminate'
  | 'registration-deadline'
  | 'spot-interruption'
  | 'observed-terminated';

export function recordEc2Launch(market: 'spot' | 'on-demand', outcome: Ec2LaunchOutcome): void {
  launchCount.add(1, {market, outcome});
}

export function recordEc2Termination(reason: Ec2TerminationReason): void {
  terminateCount.add(1, {reason});
}

export function recordEc2ReconcileAbsent(count: number): void {
  reconcileAbsentCount.add(count);
}

export function recordEc2LaunchDuration(params: Ec2DurationObservation): void {
  if (params.durationMs < 0) return;
  launchDuration.record(params.durationMs, toMetricLabels(params));
}

export function recordEc2PendingDuration(params: Ec2DurationObservation): void {
  if (params.durationMs < 0) return;
  pendingDuration.record(params.durationMs, toMetricLabels(params));
}

function toMetricLabels(params: Ec2DurationLabels): {
  template_key: string;
  market: 'spot' | 'on-demand';
  architecture: Ec2Architecture;
  availability_zone: string;
} {
  return {
    template_key: params.templateKey,
    market: params.market,
    architecture: params.architecture,
    availability_zone: params.availabilityZone,
  };
}
