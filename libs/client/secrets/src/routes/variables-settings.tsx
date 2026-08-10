import {defineRoute, useActiveWorkspace} from '@shipfox/client-shell/runtime';
import {WorkspaceVariablesSection} from '#index.js';

export default defineRoute({
  staticData: {frame: 'content'},
  component: () => <WorkspaceVariablesSection workspaceId={useActiveWorkspace().id} />,
});
