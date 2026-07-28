export type AdminRole = 'admin-observer' | 'admin-operator' | 'admin-owner';

export interface UserIdentity {
  id: string;
  email: string;
  name?: string;
  emailVerifiedAt?: string;
  adminRole?: AdminRole;
}

export interface AuthenticatedSession {
  accessToken: string;
  user: UserIdentity;
}

export interface WorkspaceMembership {
  id: string;
  workspaceId: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  membershipId: string;
  status?: 'active' | 'suspended' | 'deleted';
}
