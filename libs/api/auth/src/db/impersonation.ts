import type {AdminRole} from '@shipfox/api-auth-dto';
import {
  type AdministrationActionEvent,
  type AdministrationActionResult,
  createAdministrationActionEvent,
} from '@shipfox/api-common-dto';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {hashOpaqueToken} from '@shipfox/node-tokens';
import {and, eq, isNull} from 'drizzle-orm';
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
  storeAdminCommandResult,
  type Tx,
  updateAdminCommandResult,
  writeAdminAction,
} from './admin-command.js';
import {requireActiveAdminOperator} from './admin-user-moderation.js';
import {db} from './db.js';
import type {StoredImpersonationResult} from './schema/admin-command-results.js';
import {adminGrants} from './schema/admin-grants.js';
import {users} from './schema/users.js';

export const IMPERSONATE_COMMAND = 'auth.user.impersonate';
const IMPERSONATE_REQUIRED_ROLE: AdminRole = 'admin-operator';

export interface ImpersonationCommandParams {
  actorId: string;
  targetUserId: string;
  reason: string;
  actorRole: AdminRole;
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
 * the command entry, and rule 3 (the actor's own session is not impersonated)
 * is the positional `/admin` route guard; both run on every invocation,
 * replay included.
 */
async function runImpersonationLadder(tx: Tx, params: {actorId: string; targetUserId: string}) {
  await requireActiveAdminOperator(tx, params.actorId);
  if (isSameUuid(params.targetUserId, params.actorId)) throw new CannotImpersonateSelfError();
  await requireEligibleImpersonationTarget(tx, params.targetUserId);
  await requireNonAdministratorTarget(tx, params.targetUserId);
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

export async function impersonateUserWithAudit(
  params: ImpersonationCommandParams,
): Promise<ImpersonationResult> {
  return await db().transaction(async (tx) => {
    await lockAdminCommand(tx, params);

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
      const storedExpiresAt = new Date(stored.expires_at);
      if (storedExpiresAt.getTime() <= Date.now()) throw new ImpersonationExpiredError();
      await runImpersonationLadder(tx, {
        actorId: params.actorId,
        targetUserId: stored.target_user_id,
      });

      const remainingSeconds = Math.max(
        1,
        Math.floor((storedExpiresAt.getTime() - Date.now()) / 1000),
      );
      const minted = await createImpersonatedSessionToken({
        targetUserId: stored.target_user_id,
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
            token_fingerprints: [...stored.token_fingerprints, fingerprint],
          },
        },
      );
      // Replays publish their own event with the same idempotency-key
      // fingerprint: the second event under one fingerprint is the replay
      // marker. It commits atomically with the updated command result.
      await writeAdminAction(tx, impersonationEvent(params, 'succeeded'));
      return toImpersonationResult(params, minted, storedExpiresAt);
    }

    await runImpersonationLadder(tx, {
      actorId: params.actorId,
      targetUserId: params.targetUserId,
    });
    const minted = await createImpersonatedSessionToken({
      targetUserId: params.targetUserId,
      impersonatorId: params.actorId,
      workspaces: params.workspaces,
    });
    const stored: StoredImpersonationResult = {
      target_user_id: params.targetUserId,
      expires_at: minted.expiresAt.toISOString(),
      token_fingerprints: [hashOpaqueToken(minted.token)],
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
    await writeAdminAction(tx, impersonationEvent(params, 'succeeded'));
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
