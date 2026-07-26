import type {AdminRole} from '@shipfox/api-auth-dto';

export interface AdminGrant {
  id: string;
  userId: string;
  role: AdminRole;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
