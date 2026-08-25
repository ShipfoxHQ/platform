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
  /**
   * Present only for externally minted sessions (for example an adopted
   * session whose token carries the claim); ordinary cookie sessions never
   * set it.
   */
  impersonatorId?: string;
}

export interface WorkspaceMembership {
  id: string;
  workspaceId: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  membershipId: string;
  status?: 'active' | 'suspended' | 'deleted';
}
