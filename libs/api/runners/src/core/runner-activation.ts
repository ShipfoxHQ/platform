import {logger} from '@shipfox/node-opentelemetry';
import {extractDisplayPrefix, generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {and, eq, isNull, sql} from 'drizzle-orm';
import type {Tx} from '#db/db.js';
import {db} from '#db/db.js';
import {lockRunnerEnrollmentTx} from '#db/enrollment-locks.js';
import {runnerActivationTokens} from '#db/schema/runner-activation-tokens.js';
import type {RunnerInstanceDb} from '#db/schema/runner-instances.js';
import {providerRunners} from '#db/schema/runner-instances.js';
import {runnerSessions} from '#db/schema/runner-sessions.js';
import {
  type RunnerActivationTokenNotIssuedReason,
  type RunnerActivationTokenNotIssuedSurface,
  recordRunnerActivationTokenNotIssued,
} from '#metrics/instance.js';

export async function issueRunnerActivationToken(params: {
  runnerInstanceId: string;
  provisionerId: string;
  ttlSeconds: number;
  surface: RunnerActivationTokenNotIssuedSurface;
}): Promise<string | null> {
  return await db().transaction(async (tx) => issueRunnerActivationTokenTx(tx, params));
}

export async function issueRunnerActivationTokenTx(
  tx: Tx,
  params: {
    runnerInstanceId: string;
    provisionerId: string;
    ttlSeconds: number;
    surface: RunnerActivationTokenNotIssuedSurface;
  },
): Promise<string | null> {
  const [candidate] = await tx
    .select({workspaceId: providerRunners.workspaceId})
    .from(providerRunners)
    .where(
      and(
        eq(providerRunners.id, params.runnerInstanceId),
        eq(providerRunners.provisionerId, params.provisionerId),
      ),
    )
    .limit(1);
  if (!candidate) {
    recordRunnerActivationTokenNotIssuedWithLog('runner-not-found', params);
    return null;
  }
  if (candidate.workspaceId)
    await lockRunnerEnrollmentTx(tx, {
      workspaceId: candidate.workspaceId,
      runnerInstanceId: params.runnerInstanceId,
    });
  const [runner] = await tx
    .select({
      workspaceId: providerRunners.workspaceId,
      state: providerRunners.state,
      runnerSessionId: providerRunners.runnerSessionId,
      terminationAuthorizedAt: providerRunners.terminationAuthorizedAt,
      providerRunnerId: providerRunners.providerRunnerId,
      provisionerId: providerRunners.provisionerId,
    })
    .from(providerRunners)
    .where(
      and(
        eq(providerRunners.id, params.runnerInstanceId),
        eq(providerRunners.provisionerId, params.provisionerId),
      ),
    )
    .limit(1)
    .for('update');
  let enrolledSession = Boolean(runner?.runnerSessionId);
  if (runner?.workspaceId && runner.providerRunnerId && runner.provisionerId) {
    const [session] = await tx
      .select({id: runnerSessions.id})
      .from(runnerSessions)
      .where(
        and(
          eq(runnerSessions.workspaceId, runner.workspaceId),
          eq(runnerSessions.provisionerId, runner.provisionerId),
          eq(runnerSessions.providerRunnerId, runner.providerRunnerId),
        ),
      )
      .limit(1);
    enrolledSession ||= Boolean(session);
  }
  const notIssuedReason = runner
    ? getRunnerActivationTokenNotIssuedReason(runner, enrolledSession)
    : 'runner-not-found';
  if (notIssuedReason) {
    recordRunnerActivationTokenNotIssuedWithLog(notIssuedReason, params);
    return null;
  }

  await tx
    .update(runnerActivationTokens)
    .set({revokedAt: sql`now()`})
    .where(
      and(
        eq(runnerActivationTokens.runnerInstanceId, params.runnerInstanceId),
        isNull(runnerActivationTokens.consumedAt),
        isNull(runnerActivationTokens.revokedAt),
      ),
    );
  const rawToken = generateOpaqueToken('runnerActivationToken');
  await tx.insert(runnerActivationTokens).values({
    runnerInstanceId: params.runnerInstanceId,
    hashedToken: hashOpaqueToken(rawToken),
    prefix: extractDisplayPrefix(rawToken),
    expiresAt: new Date(Date.now() + params.ttlSeconds * 1000),
  });
  return rawToken;
}

export async function getRunnerAssignment(params: {
  runnerInstanceId: string;
  provisionerId: string;
}) {
  const [runner] = await db()
    .select({
      workspaceId: providerRunners.workspaceId,
      state: providerRunners.state,
      providerRunnerId: providerRunners.providerRunnerId,
    })
    .from(providerRunners)
    .where(
      and(
        eq(providerRunners.id, params.runnerInstanceId),
        eq(providerRunners.provisionerId, params.provisionerId),
      ),
    )
    .limit(1);
  if (!runner?.workspaceId || !runner.providerRunnerId || runner.state !== 'running') return null;
  const [session] = await db()
    .select({id: runnerSessions.id})
    .from(runnerSessions)
    .where(
      and(
        eq(runnerSessions.workspaceId, runner.workspaceId),
        eq(runnerSessions.provisionerId, params.provisionerId),
        eq(runnerSessions.providerRunnerId, runner.providerRunnerId),
      ),
    )
    .limit(1);
  return session ? null : {workspaceId: runner.workspaceId, runnerSessionId: null};
}

function getRunnerActivationTokenNotIssuedReason(
  runner: Pick<RunnerInstanceDb, 'workspaceId' | 'state' | 'terminationAuthorizedAt'> | undefined,
  enrolledSession: boolean,
): RunnerActivationTokenNotIssuedReason | null {
  if (!runner) return 'runner-not-found';
  if (!runner.workspaceId) return 'missing-workspace';
  if (runner.terminationAuthorizedAt) return 'termination-authorized';
  if (enrolledSession) return 'existing-session';
  if (runner.state !== 'running') return 'not-running';
  return null;
}

function recordRunnerActivationTokenNotIssuedWithLog(
  reason: RunnerActivationTokenNotIssuedReason,
  params: {
    runnerInstanceId: string;
    provisionerId: string;
    surface: RunnerActivationTokenNotIssuedSurface;
  },
): void {
  recordRunnerActivationTokenNotIssued({reason, surface: params.surface});
  logger().debug(
    {
      runnerInstanceId: params.runnerInstanceId,
      provisionerId: params.provisionerId,
      reason,
      surface: params.surface,
    },
    'Runner activation token was not issued',
  );
}
