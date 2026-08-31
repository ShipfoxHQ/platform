export type AgentClientKind = 'registered' | 'cimd';

export interface AgentClient {
  id: string;
  clientId: string;
  name: string;
  redirectUris: string[];
  kind: AgentClientKind;
  lastSeenAt: Date | null;
  unreferencedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentAuthorizationRequest {
  id: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  scopes: string[];
  codeChallenge: string;
  state: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentGrant {
  id: string;
  userId: string;
  workspaceId: string;
  clientId: string;
  scopes: string[];
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  terminalAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentAuthorizationCode {
  id: string;
  grantId: string;
  hashedCode: string;
  codeChallenge: string;
  redirectUri: string;
  resource: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentRefreshToken {
  id: string;
  grantId: string;
  hashedToken: string;
  expiresAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentPersonalAccessToken {
  id: string;
  userId: string;
  workspaceId: string;
  hashedToken: string;
  prefix: string;
  name: string;
  scopes: string[];
  expiresAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
