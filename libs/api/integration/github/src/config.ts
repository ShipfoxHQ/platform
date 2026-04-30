import {createConfig, str} from '@shipfox/config';

export const config = createConfig({
  GITHUB_APP_ID: str(),
  GITHUB_APP_PRIVATE_KEY: str(),
  GITHUB_APP_CLIENT_ID: str(),
  GITHUB_APP_CLIENT_SECRET: str(),
  GITHUB_APP_WEBHOOK_SECRET: str(),
  GITHUB_APP_SLUG: str(),
  GITHUB_INSTALL_STATE_SECRET: str(),
});

export function normalizedGithubPrivateKey(): string {
  return config.GITHUB_APP_PRIVATE_KEY.replaceAll('\\n', '\n');
}
