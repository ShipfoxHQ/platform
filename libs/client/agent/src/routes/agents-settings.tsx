import {defineRoute, useActiveWorkspace} from '@shipfox/client-shell/runtime';
import {WorkspaceHarnessesSection, WorkspaceModelProvidersSection} from '#index.js';

export default defineRoute({
  staticData: {frame: 'content'},
  component: () => {
    const workspace = useActiveWorkspace();
    return (
      <div className="flex flex-col gap-region">
        <WorkspaceHarnessesSection workspaceId={workspace.id} />
        <WorkspaceModelProvidersSection workspaceId={workspace.id} />
      </div>
    );
  },
});
