import type {RunnerToolCapabilitiesDto} from '@shipfox/api-runners-dto';
import {afterEach, vi} from '@shipfox/vitest/vi';
import {eq, inArray} from 'drizzle-orm';
import {db} from '#db/db.js';
import {provisionerTokens} from '#db/schema/provisioner-tokens.js';
import {reservations} from '#db/schema/reservations.js';
import {runnerActivationTokens} from '#db/schema/runner-activation-tokens.js';
import {runnerControlSessions} from '#db/schema/runner-control-sessions.js';
import {providerRunners} from '#db/schema/runner-instances.js';
import {
  type RunnerReservationPromotionFailureReason,
  runnerReservationPromotionFailureCount,
} from '#metrics/instance.js';
import {enrollRunnerControlSession} from './runner-control-sessions.js';

const createdReservationIds = new Set<string>();
const createdProvisionerTokenIds = new Set<string>();
const createdRunnerInstanceIds = new Set<string>();

afterEach(async () => {
  const runnerInstanceIds = [...createdRunnerInstanceIds];
  const reservationIds = [...createdReservationIds];

  if (runnerInstanceIds.length > 0) {
    await db()
      .delete(runnerActivationTokens)
      .where(inArray(runnerActivationTokens.runnerInstanceId, runnerInstanceIds));
    await db()
      .delete(runnerControlSessions)
      .where(inArray(runnerControlSessions.runnerInstanceId, runnerInstanceIds));
    await db().delete(providerRunners).where(inArray(providerRunners.id, runnerInstanceIds));
  }
  if (reservationIds.length > 0)
    await db().delete(reservations).where(inArray(reservations.id, reservationIds));
  if (createdProvisionerTokenIds.size > 0)
    await db()
      .delete(provisionerTokens)
      .where(inArray(provisionerTokens.id, [...createdProvisionerTokenIds]));

  createdRunnerInstanceIds.clear();
  createdReservationIds.clear();
  createdProvisionerTokenIds.clear();
});

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

  it('preserves committed assignment metadata during a later enrollment', async () => {
    const provisionerId = crypto.randomUUID();
    const reservation = await createReservation({provisionerId});
    const committedCapabilities: RunnerToolCapabilitiesDto = {
      harnesses: {pi: {tools: ['read']}},
    };
    const runnerInstanceId = await createRunner({
      provisionerId,
      intendedReservationId: reservation.id,
      reservationId: reservation.id,
      workspaceId: reservation.workspaceId,
      assignedAt: new Date(),
      labels: ['linux'],
      providerKind: 'ec2',
      protocolVersion: '1',
      capabilities: committedCapabilities,
    });

    const activationToken = await enrollRunnerControlSession({
      runnerInstanceId,
      provisionerId,
      labels: ['gpu'],
      capabilities: {harnesses: {claude: {tools: ['bash']}}},
      providerKind: 'docker',
      protocolVersion: '2',
    });
    const [runner] = await db()
      .select({
        reservationId: providerRunners.reservationId,
        labels: providerRunners.labels,
        providerKind: providerRunners.providerKind,
        protocolVersion: providerRunners.protocolVersion,
        capabilities: providerRunners.capabilities,
        state: providerRunners.state,
      })
      .from(providerRunners)
      .where(eq(providerRunners.id, runnerInstanceId));

    expect(activationToken).toEqual(expect.any(String));
    expect(runner).toEqual({
      reservationId: reservation.id,
      labels: ['linux'],
      providerKind: 'ec2',
      protocolVersion: '1',
      capabilities: committedCapabilities,
      state: 'running',
    });
  });

  it('repairs assignment metadata when a provider report precedes assignment commit', async () => {
    const provisionerId = crypto.randomUUID();
    const reservation = await createReservation({provisionerId});
    const capabilities: RunnerToolCapabilitiesDto = {
      harnesses: {pi: {tools: ['read']}},
    };
    const runnerInstanceId = await createRunner({
      provisionerId,
      intendedReservationId: reservation.id,
      reservationId: reservation.id,
      assignedAt: null,
    });

    const activationToken = await enrollRunnerControlSession({
      runnerInstanceId,
      provisionerId,
      labels: ['linux'],
      capabilities,
      providerKind: 'ec2',
      protocolVersion: '1',
    });
    const [runner] = await db()
      .select({
        workspaceId: providerRunners.workspaceId,
        reservationId: providerRunners.reservationId,
        assignedAt: providerRunners.assignedAt,
        intendedReservationId: providerRunners.intendedReservationId,
        labels: providerRunners.labels,
        providerKind: providerRunners.providerKind,
        protocolVersion: providerRunners.protocolVersion,
        capabilities: providerRunners.capabilities,
        state: providerRunners.state,
      })
      .from(providerRunners)
      .where(eq(providerRunners.id, runnerInstanceId));

    expect(activationToken).toEqual(expect.any(String));
    expect(runner).toEqual({
      workspaceId: reservation.workspaceId,
      reservationId: reservation.id,
      assignedAt: expect.any(Date),
      intendedReservationId: null,
      labels: ['linux'],
      providerKind: 'ec2',
      protocolVersion: '1',
      capabilities,
      state: 'running',
    });
  });

  it('updates metadata during enrollment for an unassigned runner', async () => {
    const provisionerId = crypto.randomUUID();
    const capabilities: RunnerToolCapabilitiesDto = {
      harnesses: {pi: {tools: ['read']}},
    };
    const runnerInstanceId = await createRunner({provisionerId});

    const activationToken = await enrollRunnerControlSession({
      runnerInstanceId,
      provisionerId,
      labels: ['linux'],
      capabilities,
      providerKind: 'docker',
      protocolVersion: '1',
    });
    const [runner] = await db()
      .select({
        reservationId: providerRunners.reservationId,
        labels: providerRunners.labels,
        providerKind: providerRunners.providerKind,
        protocolVersion: providerRunners.protocolVersion,
        capabilities: providerRunners.capabilities,
        state: providerRunners.state,
      })
      .from(providerRunners)
      .where(eq(providerRunners.id, runnerInstanceId));

    expect(activationToken).toBeNull();
    expect(runner).toEqual({
      reservationId: null,
      labels: ['linux'],
      providerKind: 'docker',
      protocolVersion: '1',
      capabilities,
      state: 'running',
    });
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
  createdReservationIds.add(reservation.id);
  return reservation;
}

async function createRunner(params: {
  provisionerId: string;
  intendedReservationId?: string | null;
  reservationId?: string | null;
  workspaceId?: string | null;
  labels?: string[];
  providerKind?: string | null;
  protocolVersion?: string | null;
  capabilities?: RunnerToolCapabilitiesDto | null;
  assignedAt?: Date | null;
}): Promise<string> {
  const defaultAssignedAt = params.reservationId ? new Date() : null;

  if (!createdProvisionerTokenIds.has(params.provisionerId)) {
    await db().insert(provisionerTokens).values({
      id: params.provisionerId,
      scope: 'installation',
      workspaceId: null,
      hashedToken: crypto.randomUUID(),
      prefix: 'test',
      createdByUserId: crypto.randomUUID(),
    });
    createdProvisionerTokenIds.add(params.provisionerId);
  }

  const [runner] = await db()
    .insert(providerRunners)
    .values({
      provisionerId: params.provisionerId,
      intendedReservationId: params.intendedReservationId ?? null,
      reservationId: params.reservationId ?? null,
      workspaceId: params.workspaceId ?? null,
      providerRunnerId: crypto.randomUUID(),
      labels: params.labels ?? [],
      providerKind: params.providerKind ?? null,
      protocolVersion: params.protocolVersion ?? null,
      capabilities: params.capabilities ?? null,
      assignedAt: params.assignedAt === undefined ? defaultAssignedAt : params.assignedAt,
      state: 'starting',
      reportedAt: new Date(),
    })
    .returning({id: providerRunners.id});
  if (!runner) throw new Error('Expected runner instance');
  createdRunnerInstanceIds.add(runner.id);

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
