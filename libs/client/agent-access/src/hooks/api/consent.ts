import {
  oauthConsentDecisionResponseSchema,
  oauthConsentResponseSchema,
} from '@shipfox/api-auth-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {type FetchQueryOptions, queryOptions, useMutation, useQuery} from '@tanstack/react-query';
import type {OAuthConsent} from '#core/agent-access.js';
import {toOAuthConsent} from './mapper.js';

export const oauthConsentQueryKeys = {
  all: ['oauth-consent'] as const,
  detail: (requestId: string) => [...oauthConsentQueryKeys.all, requestId] as const,
};

type OAuthConsentQueryOptions = FetchQueryOptions<
  OAuthConsent,
  Error,
  OAuthConsent,
  ReturnType<typeof oauthConsentQueryKeys.detail>
>;

export async function getOAuthConsent({
  requestId,
  signal,
}: {
  requestId: string;
  signal?: AbortSignal;
}): Promise<OAuthConsent> {
  const response = await checkedApiRequest(
    oauthConsentResponseSchema,
    `/oauth/consents/${encodeURIComponent(requestId)}`,
    {signal},
  );
  return toOAuthConsent(response);
}

export async function approveOAuthConsent({
  requestId,
  workspaceId,
}: {
  requestId: string;
  workspaceId: string;
}): Promise<string> {
  const response = await checkedApiRequest(
    oauthConsentDecisionResponseSchema,
    `/oauth/consents/${encodeURIComponent(requestId)}/approve`,
    {method: 'POST', body: {workspace_id: workspaceId}},
  );
  return response.redirect_url;
}

export async function denyOAuthConsent(requestId: string): Promise<string> {
  const response = await checkedApiRequest(
    oauthConsentDecisionResponseSchema,
    `/oauth/consents/${encodeURIComponent(requestId)}/deny`,
    {method: 'POST'},
  );
  return response.redirect_url;
}

export function oauthConsentQueryOptions(requestId: string): OAuthConsentQueryOptions {
  return queryOptions({
    queryKey: oauthConsentQueryKeys.detail(requestId),
    queryFn: ({signal}) => getOAuthConsent({requestId, signal}),
  });
}

export function useOAuthConsentQuery(requestId: string) {
  return useQuery(oauthConsentQueryOptions(requestId));
}

export function useApproveOAuthConsentMutation(requestId: string) {
  return useMutation({
    mutationFn: (workspaceId: string) => approveOAuthConsent({requestId, workspaceId}),
  });
}

export function useDenyOAuthConsentMutation(requestId: string) {
  return useMutation({mutationFn: () => denyOAuthConsent(requestId)});
}
