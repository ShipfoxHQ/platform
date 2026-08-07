export type RunnerInstanceState =
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'failed'
  | 'terminated';

export interface RunnerInstance {
  id: string;
  workspaceId: string | null;
  provisionerId: string;
  providerRunnerId: string;
  intendedReservationId: string | null;
  reservationId: string | null;
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
  reservationReleasedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
