import type {RunnerToolCapabilitiesDto} from '@shipfox/api-runners-dto';
import type {NodePgDatabase} from '@shipfox/node-drizzle';
import {logger} from '@shipfox/node-opentelemetry';
import {extractDisplayPrefix, generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {and, eq, gt, isNull, notInArray, or, sql} from 'drizzle-orm';
import {config} from '#config.js';
import {
  ReservationExpiredError,
  ReservationNotFoundError,
  RunnerInstanceAlreadyAssignedError,
  RunnerInstanceNotAssignableError,
} from '#core/errors.js';
import {sanitizeRunnerLabels} from '#core/runner-labels.js';
import {db, type schema, type Tx} from '#db/db.js';
import {
  assignRunnerInstancesTx,
  validateRunnerReservationCapacityTx,
} from '#db/runner-assignments.js';
import {terminalStates} from '#db/runner-instances.js';
import {provisionerTokens} from '#db/schema/provisioner-tokens.js';
import {runnerBootstrapTokens, runnerControlSessions} from '#db/schema/runner-control-sessions.js';
import {providerRunners} from '#db/schema/runner-instances.js';
import {
  type RunnerReservationPromotionFailureReason,
  recordRunnerReservationCapacityFailure,
  recordRunnerReservationPromotionFailure,
} from '#metrics/index.js';
import {issueRunnerActivationTokenTx} from './runner-activation.js';

export class RunnerBootstrapTokenInvalidError extends Error {
  constructor() {
    super('Runner bootstrap token is invalid, expired, or has already been used');
    this.name = 'RunnerBootstrapTokenInvalidError';
  }
}

export class RunnerControlSessionInvalidError extends Error {
  constructor() {
    super('Runner control session is invalid, expired, or closed');
    this.name = 'RunnerControlSessionInvalidError';
  }
}

export async function createRunnerInstancesWithBootstrapTokens(params: {
  provisionerId: string;
  providerKind?: string | null;
  runnerInstances: Array<{
    templateKey?: string | null;
    reservationId?: string | null;
  }>;
  ttlSeconds: number;
}): Promise<{
  runnerInstances: Array<{
    runnerInstanceId: string;
    bootstrapToken: string;
    requestIndex: number;
  }>;
  reservationUnavailable: boolean;
}> {
  const expiresAt = new Date(Date.now() + params.ttlSeconds * 1000);
  return await db().transaction(async (tx) => {
    const reservationValidation = await validateRunnerReservationCapacityTx(tx, {
      provisionerId: params.provisionerId,
      requests: params.runnerInstances.reduce(
        (requests, runner) => {
          if (!runner.reservationId) return requests;
          const request = requests.find(
            (candidate) => candidate.reservationId === runner.reservationId,
          );
          if (request) request.count += 1;
          else requests.push({reservationId: runner.reservationId, count: 1});
          return requests;
        },
        [] as Array<{reservationId: string; count: number}>,
      ),
    });
    for (const {reason, count} of reservationValidation.unavailableByReservation.values())
      recordRunnerReservationCapacityFailure(reason, count);
    const remainingAcceptedByReservation = new Map(reservationValidation.acceptedByReservation);
    const runnerInstances = params.runnerInstances.flatMap((runner, requestIndex) => {
      if (!runner.reservationId) return [{...runner, requestIndex}];
      const remaining = remainingAcceptedByReservation.get(runner.reservationId) ?? 0;
      if (remaining === 0) return [];
      remainingAcceptedByReservation.set(runner.reservationId, remaining - 1);
      return [{...runner, requestIndex}];
    });

    if (runnerInstances.length === 0)
      return {
        runnerInstances: [],
        reservationUnavailable: reservationValidation.unavailableByReservation.size > 0,
      };

    const instances = await tx
      .insert(providerRunners)
      .values(
        runnerInstances.map((runner) => ({
          provisionerId: params.provisionerId,
          providerKind: params.providerKind ?? null,
          templateKey: runner.templateKey ?? null,
          intendedReservationId: runner.reservationId ?? null,
          launchKind: runner.reservationId ? ('demand' as const) : ('warm' as const),
          state: 'starting' as const,
          labels: [],
          reportedAt: new Date(),
        })),
      )
      .returning({id: providerRunners.id});
    const results = instances.map((instance, index) => {
      const runner = runnerInstances[index];
      if (!runner) throw new Error('Runner instance insert returned an unexpected row count');
      return {
        runnerInstanceId: instance.id,
        bootstrapToken: generateOpaqueToken('runnerBootstrapToken'),
        requestIndex: runner.requestIndex,
      };
    });
    await tx.insert(runnerBootstrapTokens).values(
      results.map((result) => ({
        runnerInstanceId: result.runnerInstanceId,
        provisionerId: params.provisionerId,
        hashedToken: hashOpaqueToken(result.bootstrapToken),
        prefix: extractDisplayPrefix(result.bootstrapToken),
        expiresAt,
      })),
    );
    return {
      runnerInstances: results,
      reservationUnavailable: reservationValidation.unavailableByReservation.size > 0,
    };
  });
}

export async function exchangeRunnerBootstrapToken(params: {
  rawToken: string;
  ttlSeconds: number;
}): Promise<{runnerInstanceId: string; controlSessionToken: string; expiresAt: Date}> {
  const controlSessionToken = generateOpaqueToken('runnerControlSession');
  const expiresAt = new Date(Date.now() + params.ttlSeconds * 1000);
  return await db().transaction(async (tx) => {
    const [bootstrap] = await tx
      .update(runnerBootstrapTokens)
      .set({consumedAt: sql`now()`})
      .where(
        and(
          eq(runnerBootstrapTokens.hashedToken, hashOpaqueToken(params.rawToken)),
          isNull(runnerBootstrapTokens.consumedAt),
          isNull(runnerBootstrapTokens.revokedAt),
          gt(runnerBootstrapTokens.expiresAt, sql`now()`),
        ),
      )
      .returning();
    if (!bootstrap) throw new RunnerBootstrapTokenInvalidError();
    const [session] = await tx
      .insert(runnerControlSessions)
      .values({
        runnerInstanceId: bootstrap.runnerInstanceId,
        provisionerId: bootstrap.provisionerId,
        hashedToken: hashOpaqueToken(controlSessionToken),
        prefix: extractDisplayPrefix(controlSessionToken),
        expiresAt,
      })
      .returning({id: runnerControlSessions.id});
    if (!session) throw new Error('Runner control session insert returned no row');
    return {runnerInstanceId: bootstrap.runnerInstanceId, controlSessionToken, expiresAt};
  });
}

export async function resolveRunnerControlSession(rawToken: string) {
  const [session] = await db()
    .select({
      id: runnerControlSessions.id,
      runnerInstanceId: runnerControlSessions.runnerInstanceId,
      provisionerId: runnerControlSessions.provisionerId,
    })
    .from(runnerControlSessions)
    .leftJoin(provisionerTokens, eq(provisionerTokens.id, runnerControlSessions.provisionerId))
    .where(
      and(
        eq(runnerControlSessions.hashedToken, hashOpaqueToken(rawToken)),
        isNull(runnerControlSessions.closedAt),
        or(isNull(provisionerTokens.id), isNull(provisionerTokens.revokedAt)),
        gt(runnerControlSessions.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  return session;
}

export async function enrollRunnerControlSession(params: {
  runnerInstanceId: string;
  provisionerId: string;
  labels: string[];
  capabilities?: RunnerToolCapabilitiesDto | null;
  providerKind: string;
  protocolVersion: string;
}): Promise<string | null> {
  return await db().transaction(async (tx) => {
    const [current] = await tx
      .select({
        intendedReservationId: providerRunners.intendedReservationId,
        provisionerScope: provisionerTokens.scope,
      })
      .from(providerRunners)
      .innerJoin(provisionerTokens, eq(provisionerTokens.id, providerRunners.provisionerId))
      .where(
        and(
          eq(providerRunners.id, params.runnerInstanceId),
          eq(providerRunners.provisionerId, params.provisionerId),
        ),
      );
    if (!current) throw new RunnerControlSessionInvalidError();
    if (current.intendedReservationId)
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`runners_assignment:${params.provisionerId}:${current.intendedReservationId}`}))`,
      );

    // Provider reports may populate reservationId before the assignment commits. assignedAt is
    // written by the assignment transaction, so keep the guard on that write boundary.
    const [metadataUpdated] = await tx
      .update(providerRunners)
      .set({
        labels: sanitizeRunnerLabels(params.labels, {
          scope: current.provisionerScope,
          source: 'runner control enrollment',
        }),
        providerKind: params.providerKind,
        protocolVersion: params.protocolVersion,
        capabilities: params.capabilities ?? null,
      })
      .where(
        and(
          eq(providerRunners.id, params.runnerInstanceId),
          eq(providerRunners.provisionerId, params.provisionerId),
          isNull(providerRunners.assignedAt),
          notInArray(providerRunners.state, [...terminalStates]),
        ),
      )
      .returning({id: providerRunners.id});
    if (!metadataUpdated)
      logger().debug(
        {runnerInstanceId: params.runnerInstanceId, provisionerId: params.provisionerId},
        'Runner enrollment metadata update skipped for assigned or terminal runner',
      );

    const [updated] = await tx
      .update(providerRunners)
      .set({
        state: 'running',
        reportedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(providerRunners.id, params.runnerInstanceId),
          eq(providerRunners.provisionerId, params.provisionerId),
          notInArray(providerRunners.state, [...terminalStates]),
        ),
      )
      .returning({
        id: providerRunners.id,
        intendedReservationId: providerRunners.intendedReservationId,
      });
    if (!updated) throw new RunnerControlSessionInvalidError();

    await updateRunnerControlSessionLastSeen(tx, params.runnerInstanceId, params.provisionerId);

    const intendedReservationId = updated.intendedReservationId;
    if (!intendedReservationId) return null;

    try {
      return await tx.transaction(async (promotionTx) => {
        await assignRunnerInstancesTx(promotionTx, {
          provisionerId: params.provisionerId,
          reservationId: intendedReservationId,
          runnerInstanceIds: [params.runnerInstanceId],
        });
        return await issueRunnerActivationTokenTx(promotionTx, {
          runnerInstanceId: params.runnerInstanceId,
          provisionerId: params.provisionerId,
          ttlSeconds: config.RUNNER_ACTIVATION_TOKEN_TTL_SECONDS,
          surface: 'enrollment',
        });
      });
    } catch (error) {
      const expectedFailureReason = getRunnerReservationPromotionFailureReason(error);
      const details = {
        err: error,
        runnerInstanceId: params.runnerInstanceId,
        provisionerId: params.provisionerId,
        reservationId: intendedReservationId,
      };
      if (expectedFailureReason) {
        recordRunnerReservationPromotionFailure(expectedFailureReason);
        logger().debug(details, 'Runner reservation could not be promoted during enrollment');
      } else {
        logger().error(
          details,
          'Unexpected failure promoting runner reservation during enrollment',
        );
      }
      return null;
    }
  });
}

function getRunnerReservationPromotionFailureReason(
  error: unknown,
): RunnerReservationPromotionFailureReason | null {
  if (error instanceof ReservationExpiredError) return 'reservation-expired';
  if (error instanceof ReservationNotFoundError) return 'reservation-not-found';
  if (error instanceof RunnerInstanceAlreadyAssignedError) return 'already-assigned';
  if (error instanceof RunnerInstanceNotAssignableError) return 'not-assignable';
  return null;
}

export async function attachRunnerControlProviderId(params: {
  runnerInstanceId: string;
  provisionerId: string;
  providerRunnerId: string;
}): Promise<boolean> {
  const rows = await db()
    .update(providerRunners)
    .set({providerRunnerId: params.providerRunnerId, updatedAt: sql`now()`})
    .where(
      and(
        eq(providerRunners.id, params.runnerInstanceId),
        eq(providerRunners.provisionerId, params.provisionerId),
        isNull(providerRunners.providerRunnerId),
        notInArray(providerRunners.state, [...terminalStates]),
      ),
    )
    .returning({id: providerRunners.id});
  return rows.length === 1;
}

export async function touchRunnerControlSession(runnerInstanceId: string, provisionerId: string) {
  await updateRunnerControlSessionLastSeen(db(), runnerInstanceId, provisionerId);
  await db()
    .update(providerRunners)
    .set({reportedAt: sql`now()`, updatedAt: sql`now()`})
    .where(
      and(
        eq(providerRunners.id, runnerInstanceId),
        eq(providerRunners.provisionerId, provisionerId),
      ),
    );
}

async function updateRunnerControlSessionLastSeen(
  tx: Tx | NodePgDatabase<typeof schema>,
  runnerInstanceId: string,
  provisionerId: string,
) {
  await tx
    .update(runnerControlSessions)
    .set({lastSeenAt: sql`now()`})
    .where(
      and(
        eq(runnerControlSessions.runnerInstanceId, runnerInstanceId),
        eq(runnerControlSessions.provisionerId, provisionerId),
        isNull(runnerControlSessions.closedAt),
      ),
    );
}
