import {defineRoute} from '@shipfox/client-shell/runtime';
import {SlackCallbackPage} from '#pages/slack-callback-page.js';
import {parseSlackCallbackQuery} from '../slack-callback.js';

export default defineRoute({
  staticData: {frame: 'focused'},
  validateSearch: parseSlackCallbackQuery,
  component: SlackCallbackPage,
});
