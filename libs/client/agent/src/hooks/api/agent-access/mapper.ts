import type {
  AgentGrantSummaryDto,
  AgentPersonalAccessTokenSummaryDto,
  CreateAgentPersonalAccessTokenResponseDto,
  OAuthConsentResponseDto,
} from '@shipfox/api-auth-dto';
import type {
  AgentGrant,
  AgentPersonalAccessToken,
  CreateAgentPersonalAccessTokenCommand,
  CreatedAgentPersonalAccessToken,
  OAuthConsent,
} from '#agent-access/core/agent-access.js';

export function toOAuthConsent(dto: OAuthConsentResponseDto): OAuthConsent {
  return {
    requestId: dto.request_id,
    clientName: dto.client_name,
    scope: dto.scope,
    expiresAt: dto.expires_at,
    redirectHostname: dto.redirect_uri_hostname,
    clientIdentityOrigin: dto.client_identity_origin,
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

export function toAgentPersonalAccessToken(
  dto: AgentPersonalAccessTokenSummaryDto,
): AgentPersonalAccessToken {
  return {
    id: dto.id,
    workspaceId: dto.workspace_id,
    prefix: dto.prefix,
    name: dto.name,
    expiresAt: dto.expires_at,
    lastUsedAt: dto.last_used_at,
    createdAt: dto.created_at,
  };
}

export function toCreatedAgentPersonalAccessToken(
  dto: CreateAgentPersonalAccessTokenResponseDto,
): CreatedAgentPersonalAccessToken {
  return {...toAgentPersonalAccessToken(dto), token: dto.raw_token};
}

export function toCreateAgentPersonalAccessTokenBody(
  workspaceId: string,
  command: CreateAgentPersonalAccessTokenCommand,
) {
  return {
    workspace_id: workspaceId,
    name: command.name,
    expires_in_days: command.expiresInDays,
  };
}
