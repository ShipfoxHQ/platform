import {vi} from '@shipfox/vitest/vi';
import {db} from '#db/db.js';
import {reservations} from '#db/schema/reservations.js';
import {runnerControlSessions} from '#db/schema/runner-control-sessions.js';
import {providerRunners} from '#db/schema/runner-instances.js';
import {
  type RunnerReservationPromotionFailureReason,
  runnerReservationPromotionFailureCount,
} from '#metrics/instance.js';
import {enrollRunnerControlSession} from './runner-control-sessions.js';

describe('enrollRunnerControlSession', () => {
  it('counts expired reservation promotion failures', async () => {
    const provisionerId = crypto.randomUUID();
    const reservation = await createReservation({
      provisionerId,
      expiresAt: new Date(Date.now() - 1_000),
    });

    await expectPromotionFailure({
      provisionerId,
      intendedReservationId: reservation.id,
      reason: 'reservation-expired',
    });
  });

  it('counts missing reservation promotion failures', async () => {
    await expectPromotionFailure({
      provisionerId: crypto.randomUUID(),
      intendedReservationId: crypto.randomUUID(),
      reason: 'reservation-not-found',
    });
  });

  it('counts already-assigned reservation promotion failures', async () => {
    const provisionerId = crypto.randomUUID();
    const intendedReservation = await createReservation({provisionerId});
    const assignedReservation = await createReservation({provisionerId});

    await expectPromotionFailure({
      provisionerId,
      intendedReservationId: intendedReservation.id,
      reservationId: assignedReservation.id,
      reason: 'already-assigned',
    });
  });

  it('counts not-assignable reservation promotion failures', async () => {
    const provisionerId = crypto.randomUUID();
    const reservation = await createReservation({
      provisionerId,
      requiredLabels: ['gpu'],
    });

    await expectPromotionFailure({
      provisionerId,
      intendedReservationId: reservation.id,
      labels: ['linux'],
      reason: 'not-assignable',
    });
  });

  it('does not count successful reservation promotion', async () => {
    const provisionerId = crypto.randomUUID();
    const reservation = await createReservation({provisionerId});
    const runnerInstanceId = await createRunner({
      provisionerId,
      intendedReservationId: reservation.id,
    });
    const addSpy = vi.spyOn(runnerReservationPromotionFailureCount, 'add');

    try {
      const activationToken = await enrollRunnerControlSession({
        runnerInstanceId,
        provisionerId,
        labels: ['linux'],
        providerKind: 'docker',
        protocolVersion: '1',
      });

      expect(activationToken).toEqual(expect.any(String));
      expect(addSpy).not.toHaveBeenCalled();
    } finally {
      addSpy.mockRestore();
    }
  });

  it('keeps unexpected promotion failures on the error-log path', async () => {
    const provisionerId = crypto.randomUUID();
    const reservation = await createReservation({provisionerId});
    const runnerInstanceId = await createRunner({
      provisionerId,
      intendedReservationId: reservation.id,
    });
    const unexpectedError = new Error('database unavailable');
    const debugLog = vi.fn();
    const errorLog = vi.fn();

    vi.resetModules();
    vi.doMock('@shipfox/node-opentelemetry', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@shipfox/node-opentelemetry')>()),
      logger: () => ({debug: debugLog, error: errorLog}),
    }));
    vi.doMock('#db/runner-assignments.js', async (importOriginal) => ({
      ...(await importOriginal<typeof import('#db/runner-assignments.js')>()),
      assignRunnerInstancesTx: vi.fn().mockRejectedValue(unexpectedError),
    }));

    const {closePostgresClient, createPostgresClient} = await import('@shipfox/node-postgres');
    createPostgresClient();

    try {
      const {enrollRunnerControlSession: enroll} = await import('./runner-control-sessions.js');
      const result = await enroll({
        runnerInstanceId,
        provisionerId,
        labels: ['linux'],
        providerKind: 'docker',
        protocolVersion: '1',
      });

      expect(result).toBeNull();
      expect(debugLog).not.toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledWith(
        expect.objectContaining({err: unexpectedError}),
        'Unexpected failure promoting runner reservation during enrollment',
      );
    } finally {
      await closePostgresClient();
      vi.doUnmock('@shipfox/node-opentelemetry');
      vi.doUnmock('#db/runner-assignments.js');
      vi.resetModules();
    }
  });
});

async function expectPromotionFailure(params: {
  provisionerId: string;
  intendedReservationId: string;
  reservationId?: string;
  labels?: string[];
  reason: RunnerReservationPromotionFailureReason;
}): Promise<void> {
  const runnerInstanceId = await createRunner(params);
  const addSpy = vi.spyOn(runnerReservationPromotionFailureCount, 'add');

  try {
    const result = await enrollRunnerControlSession({
      runnerInstanceId,
      provisionerId: params.provisionerId,
      labels: params.labels ?? ['linux'],
      providerKind: 'docker',
      protocolVersion: '1',
    });

    expect(result).toBeNull();
    expect(addSpy).toHaveBeenCalledWith(1, {reason: params.reason});
  } finally {
    addSpy.mockRestore();
  }
}

async function createReservation(params: {
  provisionerId: string;
  requiredLabels?: string[];
  expiresAt?: Date;
}) {
  const [reservation] = await db()
    .insert(reservations)
    .values({
      workspaceId: crypto.randomUUID(),
      provisionerId: params.provisionerId,
      requiredLabels: params.requiredLabels ?? ['linux'],
      count: 1,
      expiresAt: params.expiresAt ?? new Date(Date.now() + 60_000),
    })
    .returning();
  if (!reservation) throw new Error('Expected reservation');
  return reservation;
}

async function createRunner(params: {
  provisionerId: string;
  intendedReservationId: string;
  reservationId?: string;
  labels?: string[];
}): Promise<string> {
  const [runner] = await db()
    .insert(providerRunners)
    .values({
      provisionerId: params.provisionerId,
      intendedReservationId: params.intendedReservationId,
      reservationId: params.reservationId ?? null,
      providerRunnerId: crypto.randomUUID(),
      labels: params.labels ?? [],
      state: 'starting',
      reportedAt: new Date(),
    })
    .returning({id: providerRunners.id});
  if (!runner) throw new Error('Expected runner instance');

  await db()
    .insert(runnerControlSessions)
    .values({
      runnerInstanceId: runner.id,
      provisionerId: params.provisionerId,
      hashedToken: crypto.randomUUID(),
      prefix: 'test',
      expiresAt: new Date(Date.now() + 60_000),
    });
  return runner.id;
}
