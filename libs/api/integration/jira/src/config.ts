import {createConfig, str, url} from '@shipfox/config';

export const config = createConfig({
  JIRA_OAUTH_CLIENT_ID: str({
    desc: 'OAuth client ID of the Jira app, used to start and complete the Jira connect flow. Required.',
  }),
  JIRA_OAUTH_CLIENT_SECRET: str({
    desc: 'OAuth client secret of the Jira app, used for authorization-code exchange and inbound webhook JWT verification. Required.',
  }),
  JIRA_OAUTH_REDIRECT_URL: url({
    desc: 'Public client callback URL Jira redirects to after OAuth authorization, such as https://shipfox.example.com/integrations/jira/callback. Required.',
  }),
  JIRA_WEBHOOK_BASE_URL: url({
    desc: 'Public base URL Jira sends webhooks to. Its origin must be added to the Jira app webhook allowlist. Required.',
  }),
  JIRA_API_BASE_URL: url({
    desc: 'Jira API base URL. Override this only when routing Jira API requests through a proxy or test server.',
    default: 'https://api.atlassian.com',
  }),
  JIRA_AUTH_BASE_URL: url({
    desc: 'Jira OAuth base URL. Override this only when routing OAuth requests through a proxy or test server.',
    default: 'https://auth.atlassian.com',
  }),
});
