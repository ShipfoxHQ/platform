export interface OAuthConsentSearch {
  requestId?: string;
}

export function validateOAuthConsentSearch(search: Record<string, unknown>): OAuthConsentSearch {
  return typeof search.request_id === 'string' && search.request_id.length > 0
    ? {requestId: search.request_id}
    : {};
}
