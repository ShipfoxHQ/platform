import {timingSafeEqual} from 'node:crypto';
import type {AdminRole} from '@shipfox/api-auth-dto';
import {createAdministrationActionEvent} from '@shipfox/api-common-dto';
import type {TimestampIdCursor} from '@shipfox/node-drizzle';
import {hashOpaqueToken} from '@shipfox/node-tokens';
import {config} from '#config.js';
import {
  bootstrapFirstAdminOwner as bootstrapFirstAdminOwnerInDb,
  grantAdminRoleWithAudit,
  hasActiveAdminOwner,
  listAdminGrantSummaries,
  revokeAdminGrantWithAudit,
} from '#db/admin-grants.js';
import {
  reactivateUserWithAudit,
  revokeUserSessionsWithAudit,
  suspendUserWithAudit,
  type UserModerationResult,
} from '#db/admin-user-moderation.js';
import {findAdministratorUser as findAdministratorUserInDb} from '#db/admin-users.js';
import {requireAdminRole} from './admin-role.js';
import type {AdminGrant} from './entities/admin-grant.js';
import type {
  AdministratorGrantSummary,
  AdministratorUserSummary,
} from './entities/administrator-read-model.js';
import {
  AdminBootstrapClosedError,
  AdminGrantAlreadyExistsError,
  AdminGrantNotFoundError,
  AdminIdempotencyKeyReuseError,
  InvalidAdminBootstrapTokenError,
  LastAdminOwnerError,
  UserNotFoundError,
} from './errors.js';

const ADMIN_OWNER_ROLE: AdminRole = 'admin-owner';
const ADMIN_OBSERVER_ROLE: AdminRole = 'admin-observer';
const ADMIN_OPERATOR_ROLE: AdminRole = 'admin-operator';
const BOOTSTRAP_COMMAND = 'auth.admin_grant.bootstrap';
const GRANT_COMMAND = 'auth.admin_grant.grant';
const REVOKE_COMMAND = 'auth.admin_grant.revoke';
const SUSPEND_USER_COMMAND = 'auth.user.suspend';
const REACTIVATE_USER_COMMAND = 'auth.user.reactivate';
const REVOKE_USER_SESSIONS_COMMAND = 'auth.user.revoke-sessions';

export function administrationCommandFingerprint(command: string, input: unknown): string {
  return hashOpaqueToken(`${command}:${JSON.stringify(input)}`);
}

function bootstrapTokenMatches(candidate: string, expected: string | undefined): boolean {
  if (!expected) return false;
  const candidateHash = Buffer.from(hashOpaqueToken(candidate), 'hex');
  const expectedHash = Buffer.from(hashOpaqueToken(expected), 'hex');
  return timingSafeEqual(candidateHash, expectedHash);
}

function administrationEvent(params: {
  actorId: string;
  actorRole: AdminRole;
  command: string;
  targetType: string;
  targetId: string;
  reason: string;
  requiredRole?: AdminRole;
  correlationId: string;
  idempotencyKeyFingerprint: string;
}) {
  return createAdministrationActionEvent({
    actorId: params.actorId,
    actorRole: params.actorRole,
    requiredRole: params.requiredRole ?? ADMIN_OWNER_ROLE,
    command: params.command,
    targetType: params.targetType,
    targetId: params.targetId,
    reason: params.reason,
    result: 'succeeded',
    correlationId: params.correlationId,
    idempotencyKeyFingerprint: params.idempotencyKeyFingerprint,
    occurredAt: new Date().toISOString(),
  });
}

export interface AdministrationMutationContext {
  actorId: string;
  idempotencyKey: string;
  correlationId: string;
}

export interface AdministratorUserMutationResult {
  user: AdministratorUserSummary;
  correlationId: string;
  sessionsRevoked: number;
}

function toAdministratorUserMutationResult(
  result: UserModerationResult,
): AdministratorUserMutationResult {
  return {
    user: result.user,
    correlationId: result.correlationId,
    sessionsRevoked: result.sessionsRevoked,
  };
}

export async function bootstrapFirstAdminOwner(
  params: AdministrationMutationContext & {bootstrapToken: string},
): Promise<AdminGrant> {
  if (!bootstrapTokenMatches(params.bootstrapToken, config.ADMIN_BOOTSTRAP_TOKEN)) {
    throw new InvalidAdminBootstrapTokenError();
  }

  return await bootstrapFirstAdminOwnerInDb({
    userId: params.actorId,
    actorId: params.actorId,
    idempotencyKeyFingerprint: hashOpaqueToken(params.idempotencyKey),
    requestFingerprint: administrationCommandFingerprint(BOOTSTRAP_COMMAND, {
      actorId: params.actorId,
    }),
    event: administrationEvent({
      actorId: params.actorId,
      actorRole: ADMIN_OWNER_ROLE,
      command: BOOTSTRAP_COMMAND,
      targetType: 'user',
      targetId: params.actorId,
      reason: 'Initial administrator owner bootstrap',
      correlationId: params.correlationId,
      idempotencyKeyFingerprint: hashOpaqueToken(params.idempotencyKey),
    }),
  });
}

export async function getAdminBootstrapState(): Promise<'available' | 'closed'> {
  return (await hasActiveAdminOwner()) ? 'closed' : 'available';
}

export async function findAdministratorUserSummary(
  params: {actorId: string} & ({id: string; email?: never} | {email: string; id?: never}),
): Promise<AdministratorUserSummary | undefined> {
  await requireAdminRole({userId: params.actorId, minimumRole: ADMIN_OBSERVER_ROLE});

  const user = await findAdministratorUserInDb(
    'id' in params ? {id: params.id} : {email: params.email},
  );
  if (!user) return undefined;

  return user;
}

export async function listAdministratorGrantSummaries(params: {
  actorId: string;
  limit: number;
  cursor?: TimestampIdCursor;
}): Promise<{
  grants: AdministratorGrantSummary[];
  nextCursor: TimestampIdCursor | null;
}> {
  await requireAdminRole({userId: params.actorId, minimumRole: ADMIN_OBSERVER_ROLE});

  const result = await listAdminGrantSummaries({
    limit: params.limit,
    ...(params.cursor ? {cursor: params.cursor} : {}),
  });
  return {
    grants: result.rows.map((row) => ({
      grantId: row.id,
      role: row.role,
      createdAt: row.createdAt,
      revokedAt: row.revokedAt,
      user: row.user,
    })),
    nextCursor: result.nextCursor,
  };
}

export async function grantAdministratorRole(
  params: AdministrationMutationContext & {userId: string; role: AdminRole; reason: string},
): Promise<AdminGrant> {
  const actorRole = await requireAdminRole({
    userId: params.actorId,
    minimumRole: ADMIN_OWNER_ROLE,
  });
  return await grantAdminRoleWithAudit({
    userId: params.userId,
    role: params.role,
    actorId: params.actorId,
    idempotencyKeyFingerprint: hashOpaqueToken(params.idempotencyKey),
    requestFingerprint: administrationCommandFingerprint(GRANT_COMMAND, {
      userId: params.userId,
      role: params.role,
      reason: params.reason,
    }),
    event: administrationEvent({
      actorId: params.actorId,
      actorRole,
      command: GRANT_COMMAND,
      targetType: 'user',
      targetId: params.userId,
      reason: params.reason,
      correlationId: params.correlationId,
      idempotencyKeyFingerprint: hashOpaqueToken(params.idempotencyKey),
    }),
  });
}

export async function revokeAdministratorGrant(
  params: AdministrationMutationContext & {grantId: string; reason: string},
): Promise<AdminGrant> {
  const actorRole = await requireAdminRole({
    userId: params.actorId,
    minimumRole: ADMIN_OWNER_ROLE,
  });
  return await revokeAdminGrantWithAudit({
    grantId: params.grantId,
    actorId: params.actorId,
    idempotencyKeyFingerprint: hashOpaqueToken(params.idempotencyKey),
    requestFingerprint: administrationCommandFingerprint(REVOKE_COMMAND, {
      grantId: params.grantId,
      reason: params.reason,
    }),
    event: administrationEvent({
      actorId: params.actorId,
      actorRole,
      command: REVOKE_COMMAND,
      targetType: 'admin-grant',
      targetId: params.grantId,
      reason: params.reason,
      correlationId: params.correlationId,
      idempotencyKeyFingerprint: hashOpaqueToken(params.idempotencyKey),
    }),
  });
}

export async function suspendAdministratorUser(
  params: AdministrationMutationContext & {userId: string; reason: string},
): Promise<AdministratorUserMutationResult> {
  const actorRole = await requireAdminRole({
    userId: params.actorId,
    minimumRole: ADMIN_OPERATOR_ROLE,
  });
  const idempotencyKeyFingerprint = hashOpaqueToken(params.idempotencyKey);
  return toAdministratorUserMutationResult(
    await suspendUserWithAudit({
      actorId: params.actorId,
      userId: params.userId,
      idempotencyKeyFingerprint,
      requestFingerprint: administrationCommandFingerprint(SUSPEND_USER_COMMAND, {
        userId: params.userId,
        reason: params.reason,
      }),
      event: administrationEvent({
        actorId: params.actorId,
        actorRole,
        requiredRole: ADMIN_OPERATOR_ROLE,
        command: SUSPEND_USER_COMMAND,
        targetType: 'user',
        targetId: params.userId,
        reason: params.reason,
        correlationId: params.correlationId,
        idempotencyKeyFingerprint,
      }),
    }),
  );
}

export async function reactivateAdministratorUser(
  params: AdministrationMutationContext & {userId: string; reason?: string},
): Promise<AdministratorUserMutationResult> {
  const actorRole = await requireAdminRole({
    userId: params.actorId,
    minimumRole: ADMIN_OPERATOR_ROLE,
  });
  const reason = params.reason ?? 'User reactivation requested by an administrator';
  const idempotencyKeyFingerprint = hashOpaqueToken(params.idempotencyKey);
  return toAdministratorUserMutationResult(
    await reactivateUserWithAudit({
      actorId: params.actorId,
      userId: params.userId,
      idempotencyKeyFingerprint,
      requestFingerprint: administrationCommandFingerprint(REACTIVATE_USER_COMMAND, {
        userId: params.userId,
        reason,
      }),
      event: administrationEvent({
        actorId: params.actorId,
        actorRole,
        requiredRole: ADMIN_OPERATOR_ROLE,
        command: REACTIVATE_USER_COMMAND,
        targetType: 'user',
        targetId: params.userId,
        reason,
        correlationId: params.correlationId,
        idempotencyKeyFingerprint,
      }),
    }),
  );
}

export async function revokeAdministratorUserSessions(
  params: AdministrationMutationContext & {userId: string; reason?: string},
): Promise<AdministratorUserMutationResult> {
  const actorRole = await requireAdminRole({
    userId: params.actorId,
    minimumRole: ADMIN_OPERATOR_ROLE,
  });
  const reason = params.reason ?? 'All active user sessions revoked by an administrator';
  const idempotencyKeyFingerprint = hashOpaqueToken(params.idempotencyKey);
  return toAdministratorUserMutationResult(
    await revokeUserSessionsWithAudit({
      actorId: params.actorId,
      userId: params.userId,
      idempotencyKeyFingerprint,
      requestFingerprint: administrationCommandFingerprint(REVOKE_USER_SESSIONS_COMMAND, {
        userId: params.userId,
        reason,
      }),
      event: administrationEvent({
        actorId: params.actorId,
        actorRole,
        requiredRole: ADMIN_OPERATOR_ROLE,
        command: REVOKE_USER_SESSIONS_COMMAND,
        targetType: 'user',
        targetId: params.userId,
        reason,
        correlationId: params.correlationId,
        idempotencyKeyFingerprint,
      }),
    }),
  );
}

export {
  AdminBootstrapClosedError,
  AdminGrantAlreadyExistsError,
  AdminGrantNotFoundError,
  AdminIdempotencyKeyReuseError,
  InvalidAdminBootstrapTokenError,
  LastAdminOwnerError,
  UserNotFoundError,
};
