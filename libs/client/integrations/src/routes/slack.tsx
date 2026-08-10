import {defineRoute} from '@shipfox/client-shell/runtime';
import {SlackInstallPage} from '#pages/slack-install-page.js';
export default defineRoute({
  staticData: {frame: 'focused'},
  component: SlackInstallPage,
});
