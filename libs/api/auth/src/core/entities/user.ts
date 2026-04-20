export type UserStatus = 'active' | 'suspended' | 'deleted';

export interface User {
  id: string;
  email: string;
  hashedPassword: string;
  name: string | null;
  emailVerifiedAt: Date | null;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}
