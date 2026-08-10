import {defineRoute} from '@shipfox/client-shell/runtime';
import {redirect} from '@tanstack/react-router';

export default defineRoute({
  staticData: {frame: 'content'},
  beforeLoad: ({params}: {params: {workspaceSlug: string; projectSlug: string}}) => {
    throw redirect({
      to: '/w/$workspaceSlug/p/$projectSlug/runs',
      params: {workspaceSlug: params.workspaceSlug, projectSlug: params.projectSlug},
    });
  },
});
