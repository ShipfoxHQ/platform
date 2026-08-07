import {logger} from '@shipfox/node-opentelemetry';
import {extractDisplayPrefix, generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {and, eq, isNull, sql} from 'drizzle-orm';
import type {Tx} from '#db/db.js';
import {db} from '#db/db.js';
import {runnerActivationTokens} from '#db/schema/runner-activation-tokens.js';
import type {RunnerInstanceDb} from '#db/schema/runner-instances.js';
import {providerRunners} from '#db/schema/runner-instances.js';
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
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`runners_activation:${params.runnerInstanceId}`}))`,
  );
  const [runner] = await tx
    .select({
      workspaceId: providerRunners.workspaceId,
      runnerSessionId: providerRunners.runnerSessionId,
      state: providerRunners.state,
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
  const notIssuedReason = getRunnerActivationTokenNotIssuedReason(runner);
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
      runnerSessionId: providerRunners.runnerSessionId,
      state: providerRunners.state,
    })
    .from(providerRunners)
    .where(
      and(
        eq(providerRunners.id, params.runnerInstanceId),
        eq(providerRunners.provisionerId, params.provisionerId),
      ),
    )
    .limit(1);
  return runner?.workspaceId && !runner.runnerSessionId && runner.state === 'running'
    ? {workspaceId: runner.workspaceId, runnerSessionId: runner.runnerSessionId}
    : null;
}

function getRunnerActivationTokenNotIssuedReason(
  runner: Pick<RunnerInstanceDb, 'workspaceId' | 'runnerSessionId' | 'state'> | undefined,
): RunnerActivationTokenNotIssuedReason | null {
  if (!runner) return 'runner-not-found';
  if (!runner.workspaceId) return 'missing-workspace';
  if (runner.runnerSessionId) return 'existing-session';
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
