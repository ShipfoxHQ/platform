import {defineRoute} from '@shipfox/client-shell/runtime';
import {SentryCallbackPage} from '#pages/sentry-callback-page.js';
import {parseSentryCallbackParams} from '../sentry-callback.js';

export default defineRoute({
  staticData: {frame: 'focused'},
  validateSearch: parseSentryCallbackParams,
  component: SentryCallbackPage,
});
