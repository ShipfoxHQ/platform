import type {RouterContext} from '@shipfox/client-shell/runtime';
import {defineRoute, getLastWorkspaceId} from '@shipfox/client-shell/runtime';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {redirect} from '@tanstack/react-router';

export default defineRoute({
  staticData: {frame: 'focused'},
  beforeLoad: ({context}: {context: RouterContext}) => {
    const auth = context.auth;
    if (!auth || auth.isLoading) return;
    if (!auth.isAuthenticated) throw redirect({to: '/auth/login'});
    const [first, ...rest] = auth.workspaces;
    if (!first) throw redirect({to: '/setup/workspaces/new'});
    const principalId = auth.user?.id;
    const target = principalId
      ? [first, ...rest].find((workspace) => workspace.id === getLastWorkspaceId(principalId))
      : undefined;
    throw redirect({
      to: '/w/$workspaceSlug',
      params: {workspaceSlug: (target ?? first).slug},
    });
  },
  component: FullPageLoader,
});
