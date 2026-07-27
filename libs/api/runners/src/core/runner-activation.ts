import {extractDisplayPrefix, generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {and, eq, isNull, sql} from 'drizzle-orm';
import type {Tx} from '#db/db.js';
import {db} from '#db/db.js';
import {runnerActivationTokens} from '#db/schema/runner-activation-tokens.js';
import {providerRunners} from '#db/schema/runner-instances.js';

export async function issueRunnerActivationToken(params: {
  runnerInstanceId: string;
  provisionerId: string;
  ttlSeconds: number;
}): Promise<string | null> {
  return await db().transaction(async (tx) => issueRunnerActivationTokenTx(tx, params));
}

export async function issueRunnerActivationTokenTx(
  tx: Tx,
  params: {
    runnerInstanceId: string;
    provisionerId: string;
    ttlSeconds: number;
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
  if (!runner?.workspaceId || runner.runnerSessionId || runner.state !== 'running') return null;

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
    })
    .from(providerRunners)
    .where(
      and(
        eq(providerRunners.id, params.runnerInstanceId),
        eq(providerRunners.provisionerId, params.provisionerId),
      ),
    )
    .limit(1);
  return runner?.workspaceId && !runner.runnerSessionId ? runner : null;
}
