export type VcsProviderKind = 'test' | 'github' | 'gitlab';

export interface VcsConnection {
  id: string;
  workspaceId: string;
  provider: VcsProviderKind;
  providerHost: string;
  externalConnectionId: string;
  displayName: string;
  credentials: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
