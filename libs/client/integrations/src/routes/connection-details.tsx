import {defineRoute, useRouteParams} from '@shipfox/client-shell/runtime';
import {ConnectionDetailsPage} from '#pages/connection-details-page.js';
import {connectionDetailsRouteParams} from './inputs.js';

export default defineRoute({
  staticData: {frame: 'content'},
  component: () => {
    const {workspaceSlug, connectionSlug} = useRouteParams(connectionDetailsRouteParams);
    return <ConnectionDetailsPage workspaceSlug={workspaceSlug} connectionSlug={connectionSlug} />;
  },
});
