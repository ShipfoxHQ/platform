import type {RunnerToolCapabilitiesDto} from '@shipfox/api-runners-dto';
import {and, asc, eq, gt, inArray, isNull, lt, notExists, or, sql} from 'drizzle-orm';
import type {RunnerSession} from '#core/entities/runner-session.js';
import {EmptyRunnerLabelsError} from '#core/errors.js';
import {sanitizeRunnerLabelsOrThrow} from '#core/runner-labels.js';
import {recordProviderRunnerAssignmentToActivation} from '#metrics/instance.js';
import {db} from './db.js';
import {provisionerTokens} from './schema/provisioner-tokens.js';
import {runnerActivationTokens} from './schema/runner-activation-tokens.js';
import {runnerControlSessions} from './schema/runner-control-sessions.js';
import {providerRunners} from './schema/runner-instances.js';
import {runnerSessions, toRunnerSession} from './schema/runner-sessions.js';
import {runningJobExecutions} from './schema/running-job-executions.js';

export interface CreateRunnerSessionParams {
  workspaceId: string;
  scope: 'workspace';
  registrationTokenId: string;
  labels: string[];
  toolCapabilities?: RunnerToolCapabilitiesDto | null;
}

export async function createRunnerSession(
  params: CreateRunnerSessionParams,
): Promise<RunnerSession> {
  const rows = await db()
    .insert(runnerSessions)
    .values({
      workspaceId: params.workspaceId,
      scope: params.scope,
      registrationTokenId: params.registrationTokenId,
      registrationTokenKind: 'manual',
      labels: params.labels,
      toolCapabilities: params.toolCapabilities ?? null,
      toolCapabilitiesReportedAt: params.toolCapabilities ? sql`now()` : null,
      maxClaims: null,
      claimsUsed: 0,
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error('Insert returned no rows');
  return toRunnerSession(row);
}

export async function getRunnerSessionById(runnerSessionId: string): Promise<RunnerSession | null> {
  const rows = await db()
    .select()
    .from(runnerSessions)
    .where(eq(runnerSessions.id, runnerSessionId))
    .limit(1);

  const row = rows[0];
  return row ? toRunnerSession(row) : null;
}

export async function createRunnerSessionConsumingActivationToken(params: {
  activationTokenId: string;
  labels: string[];
  toolCapabilities?: RunnerToolCapabilitiesDto | null;
}) {
  return await db().transaction(async (tx) => {
    const [runner] = await tx
      .select({
        activationTokenId: runnerActivationTokens.id,
        runnerInstanceId: providerRunners.id,
        workspaceId: providerRunners.workspaceId,
        provisionerId: providerRunners.provisionerId,
        providerRunnerId: providerRunners.providerRunnerId,
        assignedAt: providerRunners.assignedAt,
        provider: providerRunners.providerKind,
        launchKind: providerRunners.launchKind,
        runnerSessionId: providerRunners.runnerSessionId,
      })
      .from(runnerActivationTokens)
      .innerJoin(providerRunners, eq(providerRunners.id, runnerActivationTokens.runnerInstanceId))
      .where(eq(runnerActivationTokens.id, params.activationTokenId))
      .limit(1)
      .for('update', {of: providerRunners});
    if (!runner?.workspaceId || !runner.providerRunnerId || runner.runnerSessionId)
      throw new Error('Runner activation token is invalid, expired, or has already been used');

    const [activationToken] = await tx
      .select({id: runnerActivationTokens.id})
      .from(runnerActivationTokens)
      .where(
        and(
          eq(runnerActivationTokens.id, runner.activationTokenId),
          eq(runnerActivationTokens.runnerInstanceId, runner.runnerInstanceId),
          isNull(runnerActivationTokens.consumedAt),
          isNull(runnerActivationTokens.revokedAt),
          gt(runnerActivationTokens.expiresAt, sql`now()`),
        ),
      )
      .limit(1)
      .for('update');
    if (!activationToken)
      throw new Error('Runner activation token is invalid, expired, or has already been used');

    const [provisioner] = await tx
      .select({scope: provisionerTokens.scope})
      .from(provisionerTokens)
      .where(eq(provisionerTokens.id, runner.provisionerId))
      .limit(1);
    const labels = sanitizeRunnerLabelsOrThrow(params.labels, {
      scope: provisioner?.scope ?? 'workspace',
      source: 'activation runner registration',
    });
    if (labels.length === 0) throw new EmptyRunnerLabelsError();
    const [session] = await tx
      .insert(runnerSessions)
      .values({
        workspaceId: runner.workspaceId,
        scope: 'workspace',
        registrationTokenId: activationToken.id,
        registrationTokenKind: 'activation',
        runnerInstanceId: runner.runnerInstanceId,
        provisionerId: runner.provisionerId,
        providerRunnerId: runner.providerRunnerId,
        labels,
        toolCapabilities: params.toolCapabilities ?? null,
        toolCapabilitiesReportedAt: params.toolCapabilities ? sql`now()` : null,
        maxClaims: 1,
        claimsUsed: 0,
      })
      .returning();
    if (!session) throw new Error('Runner activation session insert returned no row');
    await tx
      .update(runnerActivationTokens)
      .set({consumedAt: sql`now()`, consumedSessionId: session.id})
      .where(eq(runnerActivationTokens.id, activationToken.id));
    await tx
      .update(providerRunners)
      .set({runnerSessionId: session.id, updatedAt: sql`now()`})
      .where(
        and(
          eq(providerRunners.id, runner.runnerInstanceId),
          isNull(providerRunners.runnerSessionId),
        ),
      );
    await tx
      .update(runnerControlSessions)
      .set({closedAt: sql`now()`, closeReason: 'activated'})
      .where(
        and(
          eq(runnerControlSessions.runnerInstanceId, runner.runnerInstanceId),
          isNull(runnerControlSessions.closedAt),
        ),
      );
    if (runner.assignedAt)
      recordProviderRunnerAssignmentToActivation({
        durationMs: session.createdAt.getTime() - runner.assignedAt.getTime(),
        provider: runner.provider ?? 'unknown',
        launchKind: runner.launchKind,
      });
    return toRunnerSession(session);
  });
}

export interface DeleteExpiredRunnerSessionsParams {
  manualRetentionDays: number;
  ephemeralRetentionDays: number;
  limit?: number;
}

export async function deleteExpiredRunnerSessions(
  params: DeleteExpiredRunnerSessionsParams,
): Promise<number> {
  const expiredIds = db()
    .select({id: runnerSessions.id})
    .from(runnerSessions)
    .where(
      and(
        or(
          and(
            eq(runnerSessions.registrationTokenKind, 'manual'),
            lt(
              runnerSessions.createdAt,
              sql`now() - (${params.manualRetentionDays} || ' days')::interval`,
            ),
          ),
          and(
            inArray(runnerSessions.registrationTokenKind, ['ephemeral', 'activation']),
            lt(
              runnerSessions.createdAt,
              sql`now() - (${params.ephemeralRetentionDays} || ' days')::interval`,
            ),
          ),
        ),
        notExists(
          db()
            .select({id: runningJobExecutions.id})
            .from(runningJobExecutions)
            .where(eq(runningJobExecutions.runnerSessionId, runnerSessions.id)),
        ),
      ),
    )
    .orderBy(asc(runnerSessions.createdAt), asc(runnerSessions.id))
    .limit(params.limit ?? 1000);

  const deleted = await db()
    .delete(runnerSessions)
    .where(inArray(runnerSessions.id, expiredIds))
    .returning({id: runnerSessions.id});

  return deleted.length;
}
