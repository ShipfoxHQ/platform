import {defineRoute} from '@shipfox/client-shell/runtime';
import {MembersSettingsPage} from '#pages/members-settings-page.js';
export default defineRoute({
  staticData: {frame: 'content'},
  component: MembersSettingsPage,
});
