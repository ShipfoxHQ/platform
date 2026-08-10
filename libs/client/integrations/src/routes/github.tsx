import {defineRoute} from '@shipfox/client-shell/runtime';
import {GithubInstallPage} from '#pages/github-install-page.js';

export default defineRoute({
  staticData: {frame: 'focused'},
  component: GithubInstallPage,
});
