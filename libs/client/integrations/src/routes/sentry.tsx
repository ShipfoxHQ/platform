import {defineRoute} from '@shipfox/client-shell/runtime';
import {SentryInstallPage} from '#pages/sentry-install-page.js';

export default defineRoute({
  staticData: {frame: 'focused'},
  component: SentryInstallPage,
});
