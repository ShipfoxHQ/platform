import {defineRoute} from '@shipfox/client-shell/runtime';
import {LinearInstallPage} from '#pages/linear-install-page.js';

export default defineRoute({
  staticData: {frame: 'focused'},
  component: LinearInstallPage,
});
