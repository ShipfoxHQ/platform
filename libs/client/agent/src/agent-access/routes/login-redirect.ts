export interface OAuthConsentLoginRedirect {
  href: string;
  search: {redirect: string};
  to: '/auth/login';
}

/** Builds the shared login target for every OAuth consent guest transition. */
export function createOAuthConsentLoginRedirect(returnUrl: string): OAuthConsentLoginRedirect {
  return {
    href: `/auth/login?redirect=${encodeURIComponent(returnUrl)}`,
    search: {redirect: returnUrl},
    to: '/auth/login',
  };
}
