export interface ConsentWorkspace {
  id: string;
  role: string;
}

export interface OAuthConsent {
  requestId: string;
  clientName: string;
  scope: 'read';
  expiresAt: string;
  redirectHostname: string;
  clientIdentityOrigin: string;
  isLoopbackRedirect: boolean;
  workspaces: ConsentWorkspace[];
}

export interface AgentGrant {
  id: string;
  clientName: string;
  workspaceId: string;
  scopes: 'read'[];
  createdAt: string;
  lastRefreshedAt: string | null;
}

export interface AgentPersonalAccessToken {
  id: string;
  workspaceId: string;
  prefix: string;
  name: string;
  expiresAt: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface CreatedAgentPersonalAccessToken extends AgentPersonalAccessToken {
  token: string;
}

export type AgentPersonalAccessTokenExpiration = 30 | 90 | 365;

export interface CreateAgentPersonalAccessTokenCommand {
  name: string;
  expiresInDays: AgentPersonalAccessTokenExpiration;
}

export function createAgentPersonalAccessTokenCommand(
  name: string,
  expiresInDays: AgentPersonalAccessTokenExpiration,
): CreateAgentPersonalAccessTokenCommand {
  return {name: name.trim(), expiresInDays};
}
