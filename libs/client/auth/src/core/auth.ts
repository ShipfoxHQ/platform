export interface LoginCommand {
  email: string;
  password: string;
}

export interface SignupCommand extends LoginCommand {
  name: string;
  invitationToken?: string;
}

export interface PasswordResetRequestCommand {
  email: string;
}

export interface PasswordResetConfirmCommand {
  token: string;
  newPassword: string;
}

export interface VerifyEmailCommand {
  email: string;
  challengeId: string;
  code: string;
}

export interface ResendEmailVerificationCommand {
  email: string;
  challengeId: string;
}

export interface WorkspaceCreateCommand {
  name: string;
  slug: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'deleted';
}

export interface SignupResult {
  user: {
    id: string;
    email: string;
    name?: string;
    emailVerifiedAt?: string;
  };
  emailChallenge?: {id: string; nextResendAvailableAt: string};
  membership?: {id: string; userId: string; workspaceId: string};
  acceptError?: {code: string; message: string};
}

export interface EmailVerificationResendResult {
  nextResendAvailableAt: string;
}
