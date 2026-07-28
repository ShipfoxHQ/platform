import type {AdministrationActionEvent} from '@shipfox/api-common-dto';
import {and, eq, gt, isNull, sql} from 'drizzle-orm';
import {hasMinimumAdminRole, highestAdminRole} from '#core/admin-role-model.js';
import type {AdministratorUserSummary} from '#core/entities/administrator-read-model.js';
import {AdminRoleRequiredError, LastAdminOwnerError, UserNotFoundError} from '#core/errors.js';
import {
  findAdminCommandResult,
  lockAdminCommand,
  lockAdminOwnerGrants,
  storeAdminCommandResult,
  type Tx,
  writeAdminAction,
} from './admin-command.js';
import {findAdministratorUserSummary} from './admin-user-summary.js';
import {db} from './db.js';
import {lockUserSessionMutations} from './refresh-tokens.js';
import type {
  StoredAdministratorUserSummary,
  StoredAdminUserModerationResult,
} from './schema/admin-command-results.js';
import {adminGrants} from './schema/admin-grants.js';
import {refreshTokens} from './schema/refresh-tokens.js';
import {users} from './schema/users.js';

interface UserModerationCommandParams {
  actorId: string;
  userId: string;
  idempotencyKeyFingerprint: string;
  requestFingerprint: string;
  event: AdministrationActionEvent;
}

function toStoredUserSummary(user: AdministratorUserSummary): StoredAdministratorUserSummary {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    adminRole: user.adminRole,
  };
}

async function findUserSummary(tx: Tx, userId: string): Promise<StoredAdministratorUserSummary> {
  const user = await findAdministratorUserSummary(tx, {id: userId});
  if (!user) throw new Error('User summary query returned no rows');
  return toStoredUserSummary(user);
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
  const result = await findAdminCommandResult(tx, params);
  if (!result) return undefined;
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
  await storeAdminCommandResult(tx, params, {userModeration: result});
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
        gt(refreshTokens.expiresAt, sql`now()`),
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

    await lockUserSessionMutations(tx, params.userId);
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
          )
          .limit(2);
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
