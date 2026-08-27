export type RunnerInstanceState =
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'failed'
  | 'terminated';

export type RunnerInstanceLaunchKind = 'demand' | 'warm' | 'manual';

export type RunnerTerminationReason =
  | 'registration-deadline'
  | 'activation-timeout'
  | 'runner-unresponsive'
  | 'lease-expired'
  | 'session-exhausted'
  | 'stopping-timeout'
  | 'provider-health-failed'
  | 'job-cancelled'
  | 'job-timeout'
  | 'terminal-state';

export interface RunnerInstance {
  id: string;
  workspaceId: string | null;
  provisionerId: string;
  providerRunnerId: string;
  intendedReservationId: string | null;
  reservationId: string | null;
  launchKind: RunnerInstanceLaunchKind;
  assignedAt?: Date | null;
  templateKey: string | null;
  labels: string[];
  state: RunnerInstanceState;
  reason: string | null;
  runnerSessionId: string | null;
  providerKind: string | null;
  reportedAt: Date;
  startedAt: Date | null;
  stoppingAt: Date | null;
  stoppedAt: Date | null;
  failedAt: Date | null;
  terminatedAt: Date | null;
  terminationAuthorizedAt?: Date | null;
  terminationReason?: RunnerTerminationReason | null;
  reservationReleasedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
