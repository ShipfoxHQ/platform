export interface RefreshToken {
  id: string;
  userId: string;
  hashedToken: string;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
