import {defineRoute} from '@shipfox/client-shell/runtime';
import {GiteaInstallPage} from '#pages/gitea-install-page.js';

export default defineRoute({
  staticData: {frame: 'focused'},
  component: GiteaInstallPage,
});
