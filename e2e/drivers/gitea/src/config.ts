import {createConfig, str} from '@shipfox/config';
import {config as e2eCoreConfig} from '@shipfox/e2e-core';

export const config = createConfig({
  E2E_GITEA_URL: str({
    desc: 'Base URL of the Gitea instance the helper drives with admin credentials, seen from the host running the tests (for example http://localhost:3000).',
    default: 'http://localhost:3000',
  }),
  E2E_GITEA_ADMIN_USERNAME: str({
    desc: 'Username of the Gitea site admin the helper authenticates as over Basic auth. Matches the value dev/gitea/bootstrap.sh creates.',
    default: 'gitea-admin',
  }),
  E2E_GITEA_ADMIN_PASSWORD: str({
    desc: 'Password of the Gitea site admin, used for Basic auth against the Gitea REST API. Matches the value dev/gitea/bootstrap.sh creates.',
    default: 'gitea-admin-dev-password',
  }),
  E2E_GITEA_BOT_USERNAME: str({
    desc: "Username of the scoped bot added to each run org's code-read and issue-comment-write teams. Matches the value dev/gitea/bootstrap.sh creates.",
    default: 'shipfox-bot',
  }),
  E2E_GITEA_WEBHOOK_SECRET: str({
    desc: "Secret registered on each run org's push webhook. Must match the API GITEA_WEBHOOK_SECRET so deliveries verify.",
    default: 'shipfox-gitea-dev-webhook-secret',
  }),
  E2E_API_HOST_FROM_CONTAINER: str({
    desc: 'Host the Gitea container uses to reach the API when delivering webhooks. Defaults to host.docker.internal, which resolves to the host running the API from inside a container.',
    default: 'host.docker.internal',
  }),
});

// Gitea delivers push webhooks from inside a container, so the target host is the
// container-reachable API host (host.docker.internal), while the scheme and port
// stay those of the API the tests already talk to.
export function defaultWebhookTargetUrl(): string {
  const url = new URL(e2eCoreConfig.API_URL);
  url.hostname = config.E2E_API_HOST_FROM_CONTAINER;
  url.pathname = '/webhooks/integrations/gitea';
  return url.toString();
}
