import {defineRoute, useActiveWorkspace} from '@shipfox/client-shell/runtime';
import {WorkspaceProvisionerTokensSettingsSection} from '#index.js';

export default defineRoute({
  staticData: {frame: 'content'},
  component: () => (
    <WorkspaceProvisionerTokensSettingsSection workspaceId={useActiveWorkspace().id} />
  ),
});
