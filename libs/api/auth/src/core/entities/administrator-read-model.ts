import type {AdminRole} from '@shipfox/api-auth-dto';
import type {UserStatus} from './user.js';

export interface AdministratorUserIdentity {
  id: string;
  email: string;
  name: string | null;
  status: UserStatus;
}

export interface AdministratorUserSummary extends AdministratorUserIdentity {
  emailVerifiedAt: Date | null;
  createdAt: Date;
  adminRole: AdminRole | null;
}

export interface AdministratorGrantSummary {
  grantId: string;
  role: AdminRole;
  createdAt: Date;
  revokedAt: Date | null;
  user: AdministratorUserIdentity;
}
