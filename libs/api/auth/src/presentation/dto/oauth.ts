import type {OAuthConsentResponseDto} from '@shipfox/api-auth-dto';
import {OAUTH_READ_SCOPE} from '@shipfox/api-auth-dto';
import {AGENT_ACCESS_TOKEN_EXPIRES_IN_SECONDS} from '#core/agent-access-token.js';
import type {AgentClient} from '#core/entities/agent-access.js';
import {isOAuthLoopbackRedirectUri} from '#core/oauth-client.js';
import type {OAuthConsentDetail, OAuthTokenExchangeResult} from '#core/oauth-flow.js';

function identityOrigin(client: AgentClient): string {
  if (client.kind === 'registered') {
    return 'Self-registered MCP client. Identity not verified by Shipfox.';
  }
  try {
    return new URL(client.clientId).origin;
  } catch {
    // A CIMD client was validated before it was stored. Keep an invalid row
    // from becoming a request-time crash if old data predates that check.
    return client.clientId;
  }
}

export function toOAuthConsentResponse(detail: OAuthConsentDetail): OAuthConsentResponseDto {
  const redirectUrl = new URL(detail.request.redirectUri);
  return {
    request_id: detail.request.id,
    client_name: detail.client.name,
    scope: OAUTH_READ_SCOPE,
    expires_at: detail.request.expiresAt.toISOString(),
    redirect_uri_hostname: redirectUrl.hostname,
    client_identity_origin: identityOrigin(detail.client),
    is_loopback_redirect: isOAuthLoopbackRedirectUri(detail.request.redirectUri),
    workspaces: detail.workspaces.map(({workspaceId, role}) => ({
      workspace_id: workspaceId,
      role,
    })),
  };
}

export function oauthTokenResponse(result: OAuthTokenExchangeResult) {
  return {
    access_token: result.accessToken,
    token_type: 'Bearer' as const,
    expires_in: AGENT_ACCESS_TOKEN_EXPIRES_IN_SECONDS,
    ...(result.refreshToken ? {refresh_token: result.refreshToken} : {}),
    scope: result.scope,
  };
}
