export interface EmailVerification {
  id: string;
  userId: string;
  hashedToken: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}
