export interface ApiKey {
  id: string;
  workspaceId: string;
  hashedKey: string;
  prefix: string;
  scopes: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
