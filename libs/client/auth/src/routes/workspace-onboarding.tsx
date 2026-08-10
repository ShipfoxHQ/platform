import type {RouterContext} from '@shipfox/client-shell/runtime';
import {defineRoute} from '@shipfox/client-shell/runtime';
import {redirect} from '@tanstack/react-router';
import {WorkspaceOnboardingPage} from '#pages/workspace-onboarding-page.js';

export default defineRoute({
  staticData: {frame: 'focused'},
  beforeLoad: ({context, location}: {context: RouterContext; location: {href: string}}) => {
    const auth = context.auth;
    if (!auth || auth.isLoading) return;
    if (!auth.isAuthenticated)
      throw redirect({to: '/auth/login', search: {redirect: location.href}});
  },
  component: WorkspaceOnboardingPage,
});
