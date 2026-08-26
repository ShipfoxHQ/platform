import type {AdminRole} from '@shipfox/api-auth-dto';
import {
  ADMINISTRATION_ACTION_PERFORMED,
  type AdministrationActionEvent,
  type AdministrationActionResult,
  createAdministrationActionEvent,
} from '@shipfox/api-common-dto';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {hashOpaqueToken} from '@shipfox/node-tokens';
import {and, eq, isNull, sql} from 'drizzle-orm';
import {highestAdminRole} from '#core/admin-role-model.js';
import {
  type CreateImpersonatedSessionTokenResult,
  createImpersonatedSessionToken,
} from '#core/auth.js';
import {
  CannotImpersonateAdministratorError,
  CannotImpersonateSelfError,
  ImpersonationExpiredError,
  ImpersonationTargetNotActiveError,
  UserNotFoundError,
} from '#core/errors.js';
import {
  findAdminCommandResult,
  lockAdminCommand,
  lockAdminOwnerGrants,
  storeAdminCommandResult,
  type Tx,
  updateAdminCommandResult,
  writeAdminAction,
} from './admin-command.js';
import {requireActiveAdminOperator} from './admin-user-moderation.js';
import {db} from './db.js';
import type {StoredImpersonationResult} from './schema/admin-command-results.js';
import {adminGrants} from './schema/admin-grants.js';
import {authOutbox} from './schema/outbox.js';
import {users} from './schema/users.js';

export const IMPERSONATE_COMMAND = 'auth.user.impersonate';
const IMPERSONATE_REQUIRED_ROLE: AdminRole = 'admin-operator';

export interface ImpersonationCommandParams {
  actorId: string;
  targetUserId: string;
  reason: string;
  idempotencyKeyFingerprint: string;
  requestFingerprint: string;
  correlationId: string;
  workspaces: WorkspacesInterModuleClient;
}

export interface ImpersonationResult {
  token: string;
  expiresAt: Date;
  user: CreateImpersonatedSessionTokenResult['user'];
  impersonatorId: string;
  correlationId: string;
}

interface ImpersonationEventFields {
  actorId: string;
  targetUserId: string;
  reason: string;
  actorRole: AdminRole;
  idempotencyKeyFingerprint: string;
  correlationId: string;
}

function impersonationEvent(
  params: ImpersonationEventFields,
  result: AdministrationActionResult,
): AdministrationActionEvent {
  return createAdministrationActionEvent({
    actorId: params.actorId,
    actorRole: params.actorRole,
    requiredRole: IMPERSONATE_REQUIRED_ROLE,
    command: IMPERSONATE_COMMAND,
    targetType: 'user',
    targetId: params.targetUserId,
    reason: params.reason,
    result,
    correlationId: params.correlationId,
    idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
    occurredAt: new Date().toISOString(),
  });
}

function isSameUuid(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** Rule 5: the target exists, is active, and has a verified email. */
async function requireEligibleImpersonationTarget(tx: Tx, targetUserId: string): Promise<void> {
  const rows = await tx
    .select({emailVerifiedAt: users.emailVerifiedAt, status: users.status})
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);
  const target = rows[0];
  if (!target || target.status === 'deleted') throw new UserNotFoundError(targetUserId);
  if (target.emailVerifiedAt === null) throw new ImpersonationTargetNotActiveError();
  if (target.status !== 'active') throw new ImpersonationTargetNotActiveError();
}

/** Rule 6: the target holds no active administrator grant of any role. */
async function requireNonAdministratorTarget(tx: Tx, targetUserId: string): Promise<void> {
  const grants = await tx
    .select({role: adminGrants.role})
    .from(adminGrants)
    .innerJoin(users, eq(adminGrants.userId, users.id))
    .where(
      and(
        eq(adminGrants.userId, targetUserId),
        isNull(adminGrants.revokedAt),
        eq(users.status, 'active'),
      ),
    );
  if (highestAdminRole(grants.map(({role}) => role)) !== null) {
    throw new CannotImpersonateAdministratorError();
  }
}

/**
 * The in-transaction authorization and eligibility ladder (rules 2, 4, 5, and
 * 6). Rule 1 (`AUTH_IMPERSONATION_ENABLED`) is a configuration read checked at
 * the command entry and inside the mint primitive, and rule 3 (the actor's own
 * session is not impersonated) is the positional `/admin` route guard; all run
 * on every invocation, replay included. Returns the actor's current role read
 * in this transaction, so the audit event records the role that actually
 * authorized the mint rather than a pre-transaction snapshot.
 */
async function runImpersonationLadder(
  tx: Tx,
  params: {actorId: string; targetUserId: string},
): Promise<AdminRole> {
  const actorRole = await requireActiveAdminOperator(tx, params.actorId);
  if (isSameUuid(params.targetUserId, params.actorId)) throw new CannotImpersonateSelfError();
  await requireEligibleImpersonationTarget(tx, params.targetUserId);
  await requireNonAdministratorTarget(tx, params.targetUserId);
  return actorRole;
}

function toImpersonationResult(
  params: ImpersonationCommandParams,
  minted: CreateImpersonatedSessionTokenResult,
  expiresAt: Date,
): ImpersonationResult {
  return {
    token: minted.token,
    expiresAt,
    user: minted.user,
    impersonatorId: params.actorId,
    correlationId: params.correlationId,
  };
}

/**
 * True when the current invocation's mint committed: a `succeeded` event
 * carrying this invocation's `correlationId` is durable under the idempotency
 * key. The event is written atomically with the result row, and the
 * correlationId is unique per request, so a result row committed by an earlier
 * mint or replay under the same key can never be mistaken for this
 * invocation's commit. The command entry reconciles against this before
 * publishing a `failed` event for an unexpected error: if the event exists,
 * the mint transaction committed (the driver may still have raised on the
 * COMMIT acknowledgement), so a failure event would contradict the durable
 * `succeeded` trail.
 */
export async function impersonationSucceededEventExists(params: {
  actorId: string;
  idempotencyKeyFingerprint: string;
  correlationId: string;
}): Promise<boolean> {
  const rows = await db()
    .select({id: authOutbox.id})
    .from(authOutbox)
    .where(
      and(
        eq(authOutbox.eventType, ADMINISTRATION_ACTION_PERFORMED),
        sql`${authOutbox.payload}->>'command' = ${IMPERSONATE_COMMAND}`,
        sql`${authOutbox.payload}->>'actorId' = ${params.actorId}`,
        sql`${authOutbox.payload}->>'idempotencyKeyFingerprint' = ${params.idempotencyKeyFingerprint}`,
        sql`${authOutbox.payload}->>'correlationId' = ${params.correlationId}`,
        sql`${authOutbox.payload}->>'result' = 'succeeded'`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function impersonateUserWithAudit(
  params: ImpersonationCommandParams,
): Promise<ImpersonationResult> {
  return await db().transaction(async (tx) => {
    await lockAdminCommand(tx, params);
    // Every audited administrator grant mutation (bootstrap, grant, revoke,
    // and suspension) takes this advisory lock, so serializing the ladder and
    // the mint against it closes the race where a concurrent grant mutation
    // changes actor or target eligibility after the ladder read but before
    // the token is signed.
    await lockAdminOwnerGrants(tx);

    const existing = await findAdminCommandResult(tx, {
      actorId: params.actorId,
      idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
      requestFingerprint: params.requestFingerprint,
      command: IMPERSONATE_COMMAND,
    });

    if (existing) {
      if (!('impersonation' in existing.result)) {
        throw new Error('Administrator command result has an unexpected shape');
      }
      const stored = existing.result.impersonation as StoredImpersonationResult;

      // A replay hands back a usable bearer token, so it is an issuance, not a
      // read: it re-runs the full ladder and re-signs instead of returning the
      // stored result, and a replay after expiry is a terminal failure.
      const storedExpiresAt = new Date(stored.expiresAt);
      if (storedExpiresAt.getTime() <= Date.now()) throw new ImpersonationExpiredError();
      const actorRole = await runImpersonationLadder(tx, {
        actorId: params.actorId,
        targetUserId: stored.targetUserId,
      });

      // A replay never extends the window: the re-signed token's TTL is the
      // remaining time to the canonical `expiresAt`, so a sub-second remainder
      // is treated as already-expired instead of flooring up to a new token.
      const remainingSeconds = Math.floor((storedExpiresAt.getTime() - Date.now()) / 1000);
      if (remainingSeconds <= 0) throw new ImpersonationExpiredError();
      const minted = await createImpersonatedSessionToken({
        targetUserId: stored.targetUserId,
        impersonatorId: params.actorId,
        workspaces: params.workspaces,
        expiresIn: `${remainingSeconds}s`,
      });
      const fingerprint = hashOpaqueToken(minted.token);
      await updateAdminCommandResult(
        tx,
        {
          actorId: params.actorId,
          idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
          requestFingerprint: params.requestFingerprint,
        },
        {
          impersonation: {
            ...stored,
            tokenFingerprints: [...stored.tokenFingerprints, fingerprint],
          },
        },
      );
      // Replays publish their own event with the same idempotency-key
      // fingerprint: the second event under one fingerprint is the replay
      // marker. It commits atomically with the updated command result.
      await writeAdminAction(tx, impersonationEvent({...params, actorRole}, 'succeeded'));
      return toImpersonationResult(params, minted, storedExpiresAt);
    }

    const actorRole = await runImpersonationLadder(tx, {
      actorId: params.actorId,
      targetUserId: params.targetUserId,
    });
    const minted = await createImpersonatedSessionToken({
      targetUserId: params.targetUserId,
      impersonatorId: params.actorId,
      workspaces: params.workspaces,
    });
    const stored: StoredImpersonationResult = {
      targetUserId: params.targetUserId,
      expiresAt: minted.expiresAt.toISOString(),
      tokenFingerprints: [hashOpaqueToken(minted.token)],
    };
    await storeAdminCommandResult(
      tx,
      {
        actorId: params.actorId,
        idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
        requestFingerprint: params.requestFingerprint,
        command: IMPERSONATE_COMMAND,
      },
      {impersonation: stored},
    );
    await writeAdminAction(tx, impersonationEvent({...params, actorRole}, 'succeeded'));
    return toImpersonationResult(params, minted, minted.expiresAt);
  });
}

/**
 * Publishes a `failed` administration event from its own committed
 * transaction. The main command transaction rolls back on failure and the role
 * check runs before it opens, so an event written inside it would disappear;
 * without this a denied attempt leaves no trace on the one route where failed
 * attempts matter most. The strict event schema requires an actor role, so a
 * role-less actor's denial (nothing but the role gate itself) is not recorded.
 */
export async function publishImpersonationFailure(params: {
  actorId: string;
  targetUserId: string;
  reason: string;
  actorRole: AdminRole | null;
  idempotencyKeyFingerprint: string;
  correlationId: string;
}): Promise<void> {
  if (!params.actorRole) return;
  const event = impersonationEvent(
    {
      actorId: params.actorId,
      targetUserId: params.targetUserId,
      reason: params.reason,
      actorRole: params.actorRole,
      idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
      correlationId: params.correlationId,
    },
    'failed',
  );
  try {
    await db().transaction(async (tx) => {
      await writeAdminAction(tx, event);
    });
  } catch {
    // The failure event must never mask the original command error.
  }
}
