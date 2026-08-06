import {extractDisplayPrefix, generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {db} from '#db/db.js';
import {deleteReservationsByIds} from '#db/reservations.js';
import {reservations} from '#db/schema/reservations.js';
import {runnerControlSessions} from '#db/schema/runner-control-sessions.js';
import {providerRunners} from '#db/schema/runner-instances.js';

export interface LateRunnerEnrollmentArrangement {
  controlSessionToken: string;
  provisionerId: string;
  reservationId: string;
  runnerInstanceId: string;
  workspaceId: string;
}

export async function arrangeExpiredRunnerEnrollment(params: {
  provisionerId: string;
  workspaceId: string;
}): Promise<LateRunnerEnrollmentArrangement> {
  const reservationId = await insertReservation({
    ...params,
    expiresAt: new Date(Date.now() - 1_000),
  });

  return await createRunnerEnrollmentArrangement({...params, reservationId});
}

export async function arrangeDeletedRunnerEnrollment(params: {
  provisionerId: string;
  workspaceId: string;
}): Promise<LateRunnerEnrollmentArrangement> {
  const reservationId = await insertReservation({
    ...params,
    expiresAt: new Date(Date.now() + 60_000),
  });
  const deleted = await deleteReservationsByIds([reservationId]);
  if (deleted !== 1) throw new Error('Expected reservation cleanup to delete one row');

  // The provider can still enroll from a launch payload carrying the deleted reservation id.
  return await createRunnerEnrollmentArrangement({...params, reservationId});
}

async function insertReservation(params: {
  expiresAt: Date;
  provisionerId: string;
  workspaceId: string;
}): Promise<string> {
  const [reservation] = await db()
    .insert(reservations)
    .values({
      workspaceId: params.workspaceId,
      provisionerId: params.provisionerId,
      requiredLabels: ['linux'],
      count: 1,
      expiresAt: params.expiresAt,
    })
    .returning({id: reservations.id});
  if (!reservation) throw new Error('Expected reservation');

  return reservation.id;
}

async function createRunnerEnrollmentArrangement(params: {
  provisionerId: string;
  reservationId: string;
  workspaceId: string;
}): Promise<LateRunnerEnrollmentArrangement> {
  const providerRunnerId = `late-runner-${crypto.randomUUID()}`;
  const controlSessionToken = generateOpaqueToken('runnerControlSession');
  const [runner] = await db()
    .insert(providerRunners)
    .values({
      provisionerId: params.provisionerId,
      providerRunnerId,
      intendedReservationId: params.reservationId,
      templateKey: 'linux',
      labels: ['linux'],
      state: 'starting',
      providerKind: 'docker',
      protocolVersion: '1',
      reportedAt: new Date(),
    })
    .returning({id: providerRunners.id});
  if (!runner) throw new Error('Expected runner instance');

  await db()
    .insert(runnerControlSessions)
    .values({
      runnerInstanceId: runner.id,
      provisionerId: params.provisionerId,
      hashedToken: hashOpaqueToken(controlSessionToken),
      prefix: extractDisplayPrefix(controlSessionToken),
      expiresAt: new Date(Date.now() + 60_000),
    });

  return {
    controlSessionToken,
    provisionerId: params.provisionerId,
    reservationId: params.reservationId,
    runnerInstanceId: runner.id,
    workspaceId: params.workspaceId,
  };
}
