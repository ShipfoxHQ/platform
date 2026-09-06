import {defineRoute, type RouterContext} from '@shipfox/client-shell/runtime';
import {redirect} from '@tanstack/react-router';
import {OAuthConsentRoutePage} from '#agent-access/components/oauth-consent-page.js';
import {validateOAuthConsentSearch} from '#agent-access/routes/inputs.js';
import {createOAuthConsentLoginRedirect} from '#agent-access/routes/login-redirect.js';

export default defineRoute({
  staticData: {frame: 'focused'},
  validateSearch: validateOAuthConsentSearch,
  beforeLoad: ({context, location}: {context: RouterContext; location: {href: string}}) => {
    const auth = context.auth;
    if (!auth || auth.isLoading) return;
    if (!auth.isAuthenticated) {
      const target = createOAuthConsentLoginRedirect(location.href);
      throw redirect({to: target.to, search: target.search});
    }
  },
  component: OAuthConsentRoutePage,
});
