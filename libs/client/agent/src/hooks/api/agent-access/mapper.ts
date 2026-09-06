import type {AgentGrantSummaryDto, OAuthConsentResponseDto} from '@shipfox/api-auth-dto';
import type {AgentGrant, OAuthConsent} from '#agent-access/core/agent-access.js';

export function toOAuthConsent(dto: OAuthConsentResponseDto): OAuthConsent {
  return {
    requestId: dto.request_id,
    clientName: dto.client_name,
    scope: dto.scope,
    expiresAt: dto.expires_at,
    redirectHostname: dto.redirect_uri_hostname,
    clientIdentity:
      dto.client_identity_kind === 'cimd'
        ? {kind: 'cimd', origin: dto.client_identity_origin}
        : {kind: 'self-registered'},
    isLoopbackRedirect: dto.is_loopback_redirect,
    workspaces: dto.workspaces.map((workspace) => ({
      id: workspace.workspace_id,
      role: workspace.role,
    })),
  };
}

export function toAgentGrant(dto: AgentGrantSummaryDto): AgentGrant {
  return {
    id: dto.id,
    clientName: dto.client_name,
    workspaceId: dto.workspace_id,
    scopes: dto.scopes,
    createdAt: dto.created_at,
    lastRefreshedAt: dto.last_refreshed_at,
  };
}
