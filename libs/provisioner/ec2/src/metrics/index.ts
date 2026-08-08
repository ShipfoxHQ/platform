export {
  type Ec2Architecture,
  type Ec2DurationLabels,
  type Ec2DurationObservation,
  type Ec2LaunchOutcome,
  type Ec2TerminationReason,
  recordEc2Launch,
  recordEc2LaunchDuration,
  recordEc2PendingDuration,
  recordEc2ReconcileAbsent,
  recordEc2Termination,
} from './instance.js';
export {
  type RegisterEc2ServiceMetricsOptions,
  registerEc2ServiceMetrics,
} from './service.js';
