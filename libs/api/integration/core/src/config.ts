import {bool, createConfig, num, port} from '@shipfox/config';

export const config = createConfig({
  INTEGRATIONS_ENABLE_CRON_PROVIDER: bool({
    desc: 'Enables the cron integration provider so workflow schedules can use the built-in cron source. It is enabled by default because it does not require provider setup.',
    default: true,
  }),
  INTEGRATIONS_ENABLE_REPOSITORY_AUTHORIZATION: bool({
    desc: 'Enables the provider-free repository authorization guard. It is disabled by default while repository authorization is rolled out.',
    default: false,
  }),
  INTEGRATIONS_ENABLE_GITEA_PROVIDER: bool({
    desc: 'Enables the Gitea integration provider so users can connect a Gitea instance.',
    default: false,
  }),
  INTEGRATIONS_ENABLE_GITHUB_PROVIDER: bool({
    desc: 'Enables the GitHub integration provider so users can connect GitHub.',
    default: false,
  }),
  INTEGRATIONS_ENABLE_JIRA_PROVIDER: bool({
    desc: 'Enables the Jira integration provider so users can connect Jira sites.',
    default: false,
  }),
  INTEGRATIONS_ENABLE_LINEAR_PROVIDER: bool({
    desc: 'Enables the Linear integration provider so users can connect Linear workspaces.',
    default: false,
  }),
  INTEGRATIONS_ENABLE_SENTRY_PROVIDER: bool({
    desc: 'Enables the Sentry integration provider so users can connect Sentry.',
    default: false,
  }),
  INTEGRATIONS_ENABLE_SLACK_PROVIDER: bool({
    desc: 'Enables the Slack integration provider so users can connect Slack workspaces.',
    default: false,
  }),
  INTEGRATIONS_ENABLE_TEST_VCS_PROVIDER: bool({
    desc: 'Enables the private test source-control provider and its local smart-HTTP fixture. Keep this disabled outside E2E runs.',
    default: false,
  }),
  INTEGRATIONS_TEST_VCS_CREDENTIAL_TTL_SECONDS: num({
    desc: 'Lifetime of credentials minted by the private E2E source-control provider, in seconds.',
    default: 3,
  }),
  INTEGRATIONS_TEST_VCS_PORT: port({
    desc: 'Loopback port used by the private E2E source-control smart-HTTP fixture.',
    default: 16113,
  }),
  INTEGRATIONS_ENABLE_WEBHOOK_PROVIDER: bool({
    desc: 'Enables the generic webhook integration provider so users can create inbound webhook URLs. It is enabled by default because it does not require provider setup.',
    default: true,
  }),
});
