import type {SignupDenialMessageFormat} from './ports.js';

export class WorkspaceNotFoundError extends Error {
  constructor(workspaceId: string) {
    super(`Workspace not found: ${workspaceId}`);
    this.name = 'WorkspaceNotFoundError';
  }
}

export class ApiKeyNotFoundError extends Error {
  constructor(id: string) {
    super(`API key not found: ${id}`);
    this.name = 'ApiKeyNotFoundError';
  }
}

export class InvitationNotFoundError extends Error {
  constructor(id: string) {
    super(`Invitation not found: ${id}`);
    this.name = 'InvitationNotFoundError';
  }
}

export class InvitationWorkspaceMismatchError extends Error {
  constructor() {
    super('Invitation does not belong to this workspace');
    this.name = 'InvitationWorkspaceMismatchError';
  }
}

export class MembershipNotFoundError extends Error {
  constructor(userId: string, workspaceId: string) {
    super(`Membership not found for user ${userId} in workspace ${workspaceId}`);
    this.name = 'MembershipNotFoundError';
  }
}

export class UserNotFoundError extends Error {
  constructor(idOrEmail: string) {
    super(`User not found: ${idOrEmail}`);
    this.name = 'UserNotFoundError';
  }
}

export class EmailTakenError extends Error {
  constructor(email: string) {
    super(`Email already registered: ${email}`);
    this.name = 'EmailTakenError';
  }
}

export class SignupNotAllowedError extends Error {
  constructor(
    message: string,
    readonly format?: SignupDenialMessageFormat,
  ) {
    super(message);
    this.name = 'SignupNotAllowedError';
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid credentials');
    this.name = 'InvalidCredentialsError';
  }
}

export class EmailNotVerifiedError extends Error {
  constructor() {
    super('Email not verified');
    this.name = 'EmailNotVerifiedError';
  }
}

export class AuthDependencyUnavailableError extends Error {
  readonly dependency: string;
  override readonly cause: unknown;

  constructor(dependency: string, cause: unknown) {
    super(`Authentication dependency unavailable: ${dependency}`);
    this.name = 'AuthDependencyUnavailableError';
    this.dependency = dependency;
    this.cause = cause;
  }
}

export class AdminRoleRequiredError extends Error {
  readonly minimumRole: import('@shipfox/api-auth-dto').AdminRole;

  constructor(minimumRole: import('@shipfox/api-auth-dto').AdminRole) {
    super(`Administrator role required: ${minimumRole}`);
    this.name = 'AdminRoleRequiredError';
    this.minimumRole = minimumRole;
  }
}

export class InvalidAdministratorUserDirectoryFilterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAdministratorUserDirectoryFilterError';
  }
}

export class LastAdminOwnerError extends Error {
  constructor() {
    super('Cannot remove the final active administrator owner');
    this.name = 'LastAdminOwnerError';
  }
}

export class AdminGrantNotFoundError extends Error {
  constructor() {
    super('Administrator grant not found');
    this.name = 'AdminGrantNotFoundError';
  }
}

export class AdminGrantAlreadyExistsError extends Error {
  constructor() {
    super('Administrator grant already exists');
    this.name = 'AdminGrantAlreadyExistsError';
  }
}

export class AdminBootstrapClosedError extends Error {
  constructor() {
    super('First administrator owner has already been created');
    this.name = 'AdminBootstrapClosedError';
  }
}

export class InvalidAdminBootstrapTokenError extends Error {
  constructor() {
    super('Bootstrap token is invalid');
    this.name = 'InvalidAdminBootstrapTokenError';
  }
}

export class AdminIdempotencyKeyReuseError extends Error {
  constructor() {
    super('Idempotency key was already used for a different command');
    this.name = 'AdminIdempotencyKeyReuseError';
  }
}

export class ImpersonationDisabledError extends Error {
  constructor() {
    super('Impersonation is disabled');
    this.name = 'ImpersonationDisabledError';
  }
}

export class CannotImpersonateSelfError extends Error {
  constructor() {
    super('Cannot impersonate yourself');
    this.name = 'CannotImpersonateSelfError';
  }
}

export class CannotImpersonateAdministratorError extends Error {
  constructor() {
    super('Cannot impersonate an administrator');
    this.name = 'CannotImpersonateAdministratorError';
  }
}

export class ImpersonationTargetNotActiveError extends Error {
  constructor() {
    super('Impersonation target is not active or verified');
    this.name = 'ImpersonationTargetNotActiveError';
  }
}

export class ImpersonationExpiredError extends Error {
  constructor() {
    super('Impersonation session has expired');
    this.name = 'ImpersonationExpiredError';
  }
}

export class TokenInvalidError extends Error {
  constructor(reason?: string) {
    super(reason ? `Invalid token: ${reason}` : 'Invalid token');
    this.name = 'TokenInvalidError';
  }
}

export class TokenExpiredError extends Error {
  constructor() {
    super('Token has expired');
    this.name = 'TokenExpiredError';
  }
}

export class TokenAlreadyUsedError extends Error {
  constructor() {
    super('Token has already been used');
    this.name = 'TokenAlreadyUsedError';
  }
}

export class MembershipRequiredError extends Error {
  constructor(workspaceId: string) {
    super(`Membership required for workspace: ${workspaceId}`);
    this.name = 'MembershipRequiredError';
  }
}

export class LastMemberError extends Error {
  constructor(workspaceId: string) {
    super(`Cannot remove the last member of workspace: ${workspaceId}`);
    this.name = 'LastMemberError';
  }
}

export class InvitationEmailMismatchError extends Error {
  constructor() {
    super('Invitation email does not match authenticated user');
    this.name = 'InvitationEmailMismatchError';
  }
}

export class OpenInvitationExistsError extends Error {
  constructor(email: string) {
    super(`An open invitation already exists for: ${email}`);
    this.name = 'OpenInvitationExistsError';
  }
}
