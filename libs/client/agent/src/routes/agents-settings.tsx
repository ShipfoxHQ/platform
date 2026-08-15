import {defineRoute, useActiveWorkspace} from '@shipfox/client-shell/runtime';
import {Header} from '@shipfox/react-ui/typography';
import {WorkspaceHarnessesSection, WorkspaceModelProvidersSection} from '#index.js';

export default defineRoute({
  staticData: {frame: 'content'},
  component: () => {
    const workspace = useActiveWorkspace();
    return (
      <div className="flex min-w-0 flex-col gap-section">
        <Header variant="h1">Agents</Header>
        <div className="flex flex-col gap-region">
          <WorkspaceHarnessesSection workspaceId={workspace.id} />
          <WorkspaceModelProvidersSection workspaceId={workspace.id} />
        </div>
      </div>
    );
  },
});
