import {defineRoute} from '@shipfox/client-shell/runtime';
import {redirect} from '@tanstack/react-router';

export default defineRoute({
  beforeLoad: ({params}: {params: {workspaceSlug: string}}) => {
    throw redirect({
      to: '/w/$workspaceSlug/settings/members',
      params: {workspaceSlug: params.workspaceSlug},
    });
  },
});
