import {bool, createConfig, str, url} from '@shipfox/config';

const trailingSlashesPattern = /\/+$/u;

export const config = createConfig({
  GITHUB_APP_ID: str({
    desc: "Numeric ID of the GitHub App, found on the app's settings page. Required.",
  }),
  GITHUB_APP_PRIVATE_KEY: str({
    desc: 'Private key of the GitHub App in PEM format, used to sign API requests. Newlines may be written as \\n and are restored at runtime. Required.',
  }),
  GITHUB_APP_CLIENT_ID: str({
    desc: 'OAuth client ID of the GitHub App, used for user sign-in. Required.',
  }),
  GITHUB_APP_CLIENT_SECRET: str({
    desc: 'OAuth client secret of the GitHub App. Required.',
  }),
  GITHUB_APP_WEBHOOK_SECRET: str({
    desc: 'Secret used to verify the signature of incoming GitHub webhooks. Must match the value set on the GitHub App. Required.',
  }),
  GITHUB_APP_SLUG: str({
    desc: 'URL slug of the GitHub App, used to build install and callback links. Required.',
  }),
  GITHUB_APP_USERNAME: str({
    desc: 'GitHub App username used as the Git commit author when checkout credentials are persisted. Set this to the app username, such as my-app. The [bot] suffix is added automatically. Leave unset to keep Git author identity unset.',
    default: undefined,
  }),
  GITHUB_API_BASE_URL: url({
    desc: 'Base URL used for GitHub REST API requests. Set this only for GitHub Enterprise Server or a compatible test server.',
    default: 'https://api.github.com',
  }),
  GITHUB_CHECKOUT_TOKEN_CACHE_ENABLED: bool({
    desc: 'Enables the exact-scope encrypted cache for GitHub checkout credentials. Set this to false to bypass RAM and shared checkout caches and mint directly. Defaults to true.',
    default: true,
  }),
  GITHUB_INSTALLATION_TOKEN_FORMAT_OVERRIDE: str({
    desc: 'Temporary GitHub installation token format override. Set this to enabled to request stateless tokens, disabled to request stateful tokens, or leave it unset to follow the GitHub rollout.',
    choices: ['enabled', 'disabled'] as const,
    default: undefined,
  }),
  GITHUB_INSTALL_STATE_SECRET: str({
    desc: 'Secret used to sign the state token that protects the GitHub App install flow. Required.',
  }),
});

export function normalizedGithubPrivateKey(): string {
  return config.GITHUB_APP_PRIVATE_KEY.replaceAll('\\n', '\n');
}

export function normalizeGithubApiBaseUrl(baseUrl: string): string {
  return baseUrl.replace(trailingSlashesPattern, '');
}

export function normalizedGithubApiBaseUrl(): string {
  return normalizeGithubApiBaseUrl(config.GITHUB_API_BASE_URL);
}
