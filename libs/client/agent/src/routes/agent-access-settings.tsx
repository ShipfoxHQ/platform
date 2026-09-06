import {defineRoute, useActiveWorkspace} from '@shipfox/client-shell/runtime';
import {Header} from '@shipfox/react-ui/typography';
import {AgentAccessSettingsPage} from '#agent-access/components/agent-access-settings-page.js';

export default defineRoute({
  staticData: {frame: 'content'},
  component: () => {
    const workspace = useActiveWorkspace();
    return (
      <div className="flex min-w-0 flex-col gap-section">
        <Header variant="h1">MCP connections</Header>
        <AgentAccessSettingsPage workspaceId={workspace.id} />
      </div>
    );
  },
});
