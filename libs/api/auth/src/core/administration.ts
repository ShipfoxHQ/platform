import {timingSafeEqual} from 'node:crypto';
import type {AdminRole} from '@shipfox/api-auth-dto';
import {createAdministrationActionEvent} from '@shipfox/api-common-dto';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
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
import {
  type ImpersonationResult,
  impersonateUserWithAudit,
  impersonationSucceededEventExists,
  publishImpersonationFailure,
} from '#db/impersonation.js';
import {recordImpersonationOutcome} from '#metrics/index.js';
import {getCurrentAdminRole, requireAdminRole} from './admin-role.js';
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
  AdminRoleRequiredError,
  CannotImpersonateAdministratorError,
  CannotImpersonateSelfError,
  EmailNotVerifiedError,
  ImpersonationDisabledError,
  ImpersonationExpiredError,
  ImpersonationTargetNotActiveError,
  InvalidAdminBootstrapTokenError,
  InvalidCredentialsError,
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
const IMPERSONATE_COMMAND = 'auth.user.impersonate';

/**
 * Client-contract errors are reported to the caller, not the denial stream: a
 * 404 for an unknown target or a 409 for a reused key is a request mistake,
 * and auditing each retry would drown the `failed` event stream under durable
 * rows that a security review cannot distinguish from genuine denials.
 */
function isImpersonationClientContractError(error: unknown): boolean {
  return error instanceof AdminIdempotencyKeyReuseError || error instanceof UserNotFoundError;
}

/**
 * Deterministic authorization and eligibility denials. They are raised before
 * the command transaction writes anything, so the transaction is known to have
 * rolled back and the failure event is an unambiguous audit of the denial.
 */
function isImpersonationDenial(error: unknown): boolean {
  return (
    error instanceof ImpersonationDisabledError ||
    error instanceof AdminRoleRequiredError ||
    error instanceof CannotImpersonateSelfError ||
    error instanceof CannotImpersonateAdministratorError ||
    error instanceof ImpersonationTargetNotActiveError ||
    error instanceof ImpersonationExpiredError ||
    error instanceof EmailNotVerifiedError ||
    error instanceof InvalidCredentialsError
  );
}

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

export interface ImpersonateUserParams extends AdministrationMutationContext {
  targetUserId: string;
  reason: string;
  /**
   * The actor's own session mark, from the verified request context. The
   * positional `/admin` guard rejects an impersonated actor before this
   * command runs; the command refuses the same mark defensively.
   */
  actorImpersonatorId?: string | undefined;
  workspaces: WorkspacesInterModuleClient;
}

/**
 * Mints a short-lived, marked, audited impersonated session for a target
 * user. Enforces the authorization and eligibility ladder (rules 1-6), the
 * fingerprint-only idempotency flow (replay re-runs the ladder and re-signs
 * with the original expiry), and the audit event contract: success and replay
 * events commit atomically with the command result, and failure events commit
 * in their own transaction after the rollback.
 */
export async function impersonateUser(params: ImpersonateUserParams): Promise<ImpersonationResult> {
  const idempotencyKeyFingerprint = hashOpaqueToken(params.idempotencyKey);
  const requestFingerprint = administrationCommandFingerprint(IMPERSONATE_COMMAND, {
    targetUserId: params.targetUserId,
    reason: params.reason,
  });
  try {
    // Rule 1: the capability is an explicit opt-in; the flag is a kill switch
    // and must hold on the replay path as well as the initial mint.
    if (!config.AUTH_IMPERSONATION_ENABLED) throw new ImpersonationDisabledError();
    // Rule 3: an impersonated actor cannot impersonate (nested impersonation).
    if (params.actorImpersonatorId !== undefined) {
      throw new AdminRoleRequiredError(ADMIN_OPERATOR_ROLE);
    }
    // Rule 2: minimum admin-operator, the same bar as suspension and session
    // revocation. Re-checked inside the transaction on every path, replay
    // included, so a revocation mid-window ends the capability immediately.
    await requireAdminRole({
      userId: params.actorId,
      minimumRole: ADMIN_OPERATOR_ROLE,
    });
    const result = await impersonateUserWithAudit({
      actorId: params.actorId,
      targetUserId: params.targetUserId,
      reason: params.reason,
      idempotencyKeyFingerprint,
      requestFingerprint,
      correlationId: params.correlationId,
      workspaces: params.workspaces,
    });
    recordImpersonationOutcome('succeeded');
    return result;
  } catch (error) {
    // The command did not hand out a token, so the attempt is a failed outcome
    // regardless of why: mint-volume and denial-spike alerts key off this.
    recordImpersonationOutcome('failed');
    // Client-contract errors (unknown target, reused key) are reported to the
    // caller and never enter the denial stream.
    if (isImpersonationClientContractError(error)) throw error;
    // Deterministic denials always audit: their transaction rolled back with
    // nothing written, so the `failed` event is unambiguous even when a
    // previous mint under the same key left a committed result row.
    if (isImpersonationDenial(error)) {
      await publishImpersonationFailureForActor(params, {
        idempotencyKeyFingerprint,
        correlationId: params.correlationId,
      });
      throw error;
    }
    // An unexpected error may be an ambiguous COMMIT: the mint transaction
    // committed (result row and `succeeded` event are durable) but the driver
    // raised on the acknowledgement. Publishing a `failed` event then would
    // contradict the committed trail, so reconcile against the committed
    // `succeeded` event for THIS invocation before writing anything: the event
    // is written atomically with the result row, and its correlationId is
    // unique per request, so a result row committed by an earlier mint or
    // replay under the same key is never mistaken for this invocation's
    // commit. The reconcile is best-effort: never mask the original error.
    let committed = false;
    try {
      committed = await impersonationSucceededEventExists({
        actorId: params.actorId,
        idempotencyKeyFingerprint,
        correlationId: params.correlationId,
      });
    } catch {
      // Fall through: publish the failure event rather than losing the denial.
    }
    if (!committed) {
      await publishImpersonationFailureForActor(params, {
        idempotencyKeyFingerprint,
        correlationId: params.correlationId,
      });
    }
    throw error;
  }
}

async function publishImpersonationFailureForActor(
  params: ImpersonateUserParams,
  audit: {idempotencyKeyFingerprint: string; correlationId: string},
): Promise<void> {
  // Failures publish from a separate committed transaction after the rollback:
  // the main transaction is gone, so an event written inside it would
  // disappear, and the role check runs before it even opens.
  let actorRole: AdminRole | null = null;
  try {
    actorRole = await getCurrentAdminRole({userId: params.actorId});
  } catch {
    // The failure event is best-effort; never mask the original error.
  }
  await publishImpersonationFailure({
    actorId: params.actorId,
    targetUserId: params.targetUserId,
    reason: params.reason,
    actorRole,
    idempotencyKeyFingerprint: audit.idempotencyKeyFingerprint,
    correlationId: audit.correlationId,
  });
}

export {
  AdminBootstrapClosedError,
  AdminGrantAlreadyExistsError,
  AdminGrantNotFoundError,
  AdminIdempotencyKeyReuseError,
  CannotImpersonateAdministratorError,
  CannotImpersonateSelfError,
  ImpersonationDisabledError,
  ImpersonationExpiredError,
  ImpersonationTargetNotActiveError,
  InvalidAdminBootstrapTokenError,
  LastAdminOwnerError,
  UserNotFoundError,
};
