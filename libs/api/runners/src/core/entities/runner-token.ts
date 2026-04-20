export interface RunnerToken {
  id: string;
  workspaceId: string;
  hashedToken: string;
  prefix: string;
  name: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
