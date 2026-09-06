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
  clientIdentity: {kind: 'cimd'; origin: string} | {kind: 'self-registered'};
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
