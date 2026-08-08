import {instanceMetrics} from '@shipfox/node-opentelemetry';

const meter = instanceMetrics.getMeter('provisioner-ec2');

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
