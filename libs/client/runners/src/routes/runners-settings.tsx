import {defineRoute, useActiveWorkspace} from '@shipfox/client-shell/runtime';
import {WorkspaceManualRegistrationTokensSettingsSection} from '#index.js';

export default defineRoute({
  staticData: {frame: 'content'},
  component: () => (
    <WorkspaceManualRegistrationTokensSettingsSection workspaceId={useActiveWorkspace().id} />
  ),
});
