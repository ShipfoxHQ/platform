import type {AdminRole} from '@shipfox/api-auth-dto';
import type {
  AdministrationActionEvent,
  AdministrationActionEventMap,
} from '@shipfox/api-common-dto';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import {and, eq, isNull, sql} from 'drizzle-orm';
import {hasMinimumAdminRole, highestAdminRole} from '#core/admin-role-model.js';
import type {UserStatus} from '#core/entities/user.js';
import {
  AdminIdempotencyKeyReuseError,
  AdminRoleRequiredError,
  LastAdminOwnerError,
  UserNotFoundError,
} from '#core/errors.js';
import {db} from './db.js';
import {
  type AdminCommandResultDb,
  adminCommandResults,
  type StoredAdministratorUserSummary,
  type StoredAdminUserModerationResult,
} from './schema/admin-command-results.js';
import {adminGrants} from './schema/admin-grants.js';
import {authOutbox} from './schema/outbox.js';
import {refreshTokens} from './schema/refresh-tokens.js';
import {users} from './schema/users.js';

type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];

interface UserModerationCommandParams {
  actorId: string;
  userId: string;
  idempotencyKeyFingerprint: string;
  requestFingerprint: string;
  event: AdministrationActionEvent;
}

function userSummaryFromRows(
  rows: Array<{
    id: string;
    email: string;
    name: string | null;
    emailVerifiedAt: Date | null;
    status: UserStatus;
    createdAt: Date;
    adminRole: AdminRole | null;
  }>,
): StoredAdministratorUserSummary {
  const first = rows[0];
  if (!first) throw new Error('User summary query returned no rows');

  return {
    id: first.id,
    email: first.email,
    name: first.name,
    emailVerifiedAt: first.emailVerifiedAt?.toISOString() ?? null,
    status: first.status,
    createdAt: first.createdAt.toISOString(),
    adminRole: highestAdminRole(rows.flatMap(({adminRole}) => (adminRole ? [adminRole] : []))),
  };
}

async function findUserSummary(tx: Tx, userId: string): Promise<StoredAdministratorUserSummary> {
  const rows = await tx
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      emailVerifiedAt: users.emailVerifiedAt,
      status: users.status,
      createdAt: users.createdAt,
      adminRole: adminGrants.role,
    })
    .from(users)
    .leftJoin(
      adminGrants,
      and(
        eq(adminGrants.userId, users.id),
        isNull(adminGrants.revokedAt),
        eq(users.status, 'active'),
      ),
    )
    .where(eq(users.id, userId));

  return userSummaryFromRows(rows as typeof rows & Array<{status: UserStatus}>);
}

function fromStoredResult(result: StoredAdminUserModerationResult) {
  return {
    user: {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      emailVerifiedAt: result.user.emailVerifiedAt ? new Date(result.user.emailVerifiedAt) : null,
      status: result.user.status,
      createdAt: new Date(result.user.createdAt),
      adminRole: result.user.adminRole,
    },
    correlationId: result.correlationId,
    sessionsRevoked: result.sessionsRevoked,
  };
}

async function findCommandResult(
  tx: Tx,
  params: Pick<
    UserModerationCommandParams,
    'actorId' | 'idempotencyKeyFingerprint' | 'requestFingerprint'
  > & {command: string},
) {
  const rows = await tx
    .select()
    .from(adminCommandResults)
    .where(
      and(
        eq(adminCommandResults.actorId, params.actorId),
        eq(adminCommandResults.idempotencyKeyFingerprint, params.idempotencyKeyFingerprint),
      ),
    )
    .limit(1);
  const result: AdminCommandResultDb | undefined = rows[0];
  if (!result) return undefined;
  if (
    result.command !== params.command ||
    result.requestFingerprint !== params.requestFingerprint
  ) {
    throw new AdminIdempotencyKeyReuseError();
  }
  if (!('userModeration' in result.result)) {
    throw new Error('Administrator command result has an unexpected shape');
  }
  return fromStoredResult(result.result.userModeration);
}

async function storeCommandResult(
  tx: Tx,
  params: UserModerationCommandParams,
  result: StoredAdminUserModerationResult,
): Promise<void> {
  await tx.insert(adminCommandResults).values({
    actorId: params.actorId,
    idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
    command: params.event.command,
    requestFingerprint: params.requestFingerprint,
    result: {userModeration: result},
  });
}

async function writeAdminAction(tx: Tx, event: AdministrationActionEvent): Promise<void> {
  await writeOutboxEvent<AdministrationActionEventMap>(tx, authOutbox, {
    type: 'administration.action.performed',
    payload: event,
  });
}

async function lockAdminCommand(
  tx: Tx,
  params: Pick<UserModerationCommandParams, 'actorId' | 'idempotencyKeyFingerprint'>,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`auth_admin_command:${params.actorId}:${params.idempotencyKeyFingerprint}`}))`,
  );
}

async function lockAdminOwnerGrants(tx: Tx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('auth_admin_owner_grants'))`);
}

async function readTargetUserForUpdate(tx: Tx, userId: string) {
  const rows = await tx
    .select({id: users.id, status: users.status})
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .for('update');
  const user = rows[0];
  if (!user || user.status === 'deleted') throw new UserNotFoundError(userId);
  return user;
}

async function requireActiveAdminOperator(tx: Tx, actorId: string): Promise<void> {
  const actorRows = await tx
    .select({status: users.status})
    .from(users)
    .where(eq(users.id, actorId))
    .limit(1);
  const actor = actorRows[0];
  const grants = await tx
    .select({role: adminGrants.role})
    .from(adminGrants)
    .where(and(eq(adminGrants.userId, actorId), isNull(adminGrants.revokedAt)));
  const role = highestAdminRole(grants.map(({role}) => role));

  if (actor?.status !== 'active' || !role || !hasMinimumAdminRole(role, 'admin-operator')) {
    throw new AdminRoleRequiredError('admin-operator');
  }
}

async function revokeActiveSessions(tx: Tx, userId: string): Promise<number> {
  const revoked = await tx
    .update(refreshTokens)
    .set({revokedAt: sql`now()`, updatedAt: sql`now()`})
    .where(
      and(
        eq(refreshTokens.userId, userId),
        isNull(refreshTokens.revokedAt),
        isNull(refreshTokens.rotatedAt),
      ),
    )
    .returning({sessionId: refreshTokens.sessionId});

  return new Set(revoked.map(({sessionId}) => sessionId)).size;
}

async function executeUserModerationCommand(
  params: UserModerationCommandParams & {
    operation: 'suspend' | 'reactivate' | 'revoke-sessions';
  },
) {
  return await db().transaction(async (tx) => {
    await lockAdminCommand(tx, params);
    if (params.operation === 'suspend') await lockAdminOwnerGrants(tx);

    const existing = await findCommandResult(tx, {
      ...params,
      command: params.event.command,
    });
    if (existing) return existing;

    const user = await readTargetUserForUpdate(tx, params.userId);
    await requireActiveAdminOperator(tx, params.actorId);
    let sessionsRevoked = 0;

    if (params.operation === 'suspend') {
      if (user.status === 'active') {
        const activeOwners = await tx
          .select({id: adminGrants.id})
          .from(adminGrants)
          .innerJoin(users, eq(adminGrants.userId, users.id))
          .where(
            and(
              eq(adminGrants.role, 'admin-owner'),
              isNull(adminGrants.revokedAt),
              eq(users.status, 'active'),
            ),
          );
        const targetIsActiveOwner = await tx
          .select({id: adminGrants.id})
          .from(adminGrants)
          .where(
            and(
              eq(adminGrants.userId, user.id),
              eq(adminGrants.role, 'admin-owner'),
              isNull(adminGrants.revokedAt),
            ),
          )
          .limit(1);
        if (targetIsActiveOwner.length > 0 && activeOwners.length <= 1) {
          throw new LastAdminOwnerError();
        }

        await tx
          .update(users)
          .set({status: 'suspended', updatedAt: sql`now()`})
          .where(eq(users.id, user.id));
      }
      sessionsRevoked = await revokeActiveSessions(tx, user.id);
    } else if (params.operation === 'reactivate' && user.status === 'suspended') {
      await tx
        .update(users)
        .set({status: 'active', updatedAt: sql`now()`})
        .where(eq(users.id, user.id));
    } else if (params.operation === 'revoke-sessions') {
      sessionsRevoked = await revokeActiveSessions(tx, user.id);
    }

    const summary = await findUserSummary(tx, user.id);
    const result: StoredAdminUserModerationResult = {
      user: summary,
      correlationId: params.event.correlationId,
      sessionsRevoked,
    };
    await writeAdminAction(tx, params.event);
    await storeCommandResult(tx, params, result);
    return fromStoredResult(result);
  });
}

export type UserModerationResult = Awaited<ReturnType<typeof executeUserModerationCommand>>;

export async function suspendUserWithAudit(
  params: UserModerationCommandParams,
): Promise<UserModerationResult> {
  return await executeUserModerationCommand({...params, operation: 'suspend'});
}

export async function reactivateUserWithAudit(
  params: UserModerationCommandParams,
): Promise<UserModerationResult> {
  return await executeUserModerationCommand({...params, operation: 'reactivate'});
}

export async function revokeUserSessionsWithAudit(
  params: UserModerationCommandParams,
): Promise<UserModerationResult> {
  return await executeUserModerationCommand({...params, operation: 'revoke-sessions'});
}
