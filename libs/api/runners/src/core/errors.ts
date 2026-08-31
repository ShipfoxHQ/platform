export class RunningJobExecutionNotFoundError extends Error {
  constructor(jobExecutionId: string) {
    super(`Running job execution not found: ${jobExecutionId}`);
    this.name = 'RunningJobExecutionNotFoundError';
  }
}

export class ManualRegistrationTokenNotFoundError extends Error {
  constructor(tokenId: string) {
    super(`Manual registration token not found: ${tokenId}`);
    this.name = 'ManualRegistrationTokenNotFoundError';
  }
}

export class ProvisionerTokenNotFoundError extends Error {
  constructor(tokenId: string) {
    super(`Provisioner token not found: ${tokenId}`);
    this.name = 'ProvisionerTokenNotFoundError';
  }
}

export class ProvisionerAdminIdempotencyKeyReuseError extends Error {
  constructor() {
    super('Idempotency-Key was already used for a different provisioner token command');
    this.name = 'ProvisionerAdminIdempotencyKeyReuseError';
  }
}

export class ProvisionerAdminIdempotencyReplayUnavailableError extends Error {
  constructor() {
    super('Idempotency-Key replay cannot reproduce the original provisioner token');
    this.name = 'ProvisionerAdminIdempotencyReplayUnavailableError';
  }
}

export class EmptyRunnerLabelsError extends Error {
  constructor() {
    super('Runner labels cannot be empty');
    this.name = 'EmptyRunnerLabelsError';
  }
}

export class RunnerLabelsReservedError extends Error {
  constructor(public readonly labels: string[]) {
    super(
      `All supplied runner labels are reserved for installation-scope provisioners: ${labels.join(', ')}`,
    );
    this.name = 'RunnerLabelsReservedError';
  }
}

export class EmptyRequiredLabelsError extends Error {
  constructor() {
    super('Required labels cannot be empty');
    this.name = 'EmptyRequiredLabelsError';
  }
}

export class ReservationNotFoundError extends Error {
  constructor(public readonly reservationId: string) {
    super(`Reservation not found: ${reservationId}`);
    this.name = 'ReservationNotFoundError';
  }
}

export class ReservationExpiredError extends Error {
  constructor(public readonly reservationId: string) {
    super(`Reservation has expired: ${reservationId}`);
    this.name = 'ReservationExpiredError';
  }
}

export type RunnerInstanceNotAssignableReason =
  | 'runner-not-found'
  | 'runner-not-running'
  | 'provider-identity-missing'
  | 'control-session-not-active'
  | 'labels-mismatch'
  | 'capacity-exhausted';

export type RunnerAssignmentRejectionReason =
  | 'reservation-not-found'
  | 'reservation-expired'
  | 'already-assigned'
  | RunnerInstanceNotAssignableReason;

export class RunnerInstanceNotAssignableError extends Error {
  constructor(
    public readonly runnerInstanceId: string,
    public readonly reason: RunnerInstanceNotAssignableReason,
  ) {
    super(`Runner instance cannot be assigned: ${runnerInstanceId}`);
    this.name = 'RunnerInstanceNotAssignableError';
  }
}

export class RunnerInstanceAlreadyAssignedError extends Error {
  constructor(public readonly runnerInstanceId: string) {
    super(`Runner instance is already assigned: ${runnerInstanceId}`);
    this.name = 'RunnerInstanceAlreadyAssignedError';
  }
}

export function getRunnerAssignmentRejectionReason(
  error: unknown,
): RunnerAssignmentRejectionReason | null {
  if (error instanceof ReservationNotFoundError) return 'reservation-not-found';
  if (error instanceof ReservationExpiredError) return 'reservation-expired';
  if (error instanceof RunnerInstanceAlreadyAssignedError) return 'already-assigned';
  if (error instanceof RunnerInstanceNotAssignableError) return error.reason;
  return null;
}

export class ReservationAlreadyAssignedError extends Error {
  constructor(public readonly reservationId: string) {
    super(`Reservation is already assigned: ${reservationId}`);
    this.name = 'ReservationAlreadyAssignedError';
  }
}

export class RunnerActivationTokenInvalidError extends Error {
  constructor() {
    super('Runner activation token is invalid, expired, or has already been used');
    this.name = 'RunnerActivationTokenInvalidError';
  }
}

export class RunnerSessionExhaustedError extends Error {
  constructor(public readonly runnerSessionId: string) {
    super(`Runner session claim limit exhausted: ${runnerSessionId}`);
    this.name = 'RunnerSessionExhaustedError';
  }
}
