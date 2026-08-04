import {defineRoute} from '@shipfox/client-shell/runtime';
import {JiraCallbackPage} from '#pages/jira-callback-page.js';
import {parseJiraCallbackQuery} from '../jira-callback.js';

export default defineRoute({
  validateSearch: parseJiraCallbackQuery,
  component: JiraCallbackPage,
});
