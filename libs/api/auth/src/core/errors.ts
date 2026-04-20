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
