import {config} from '#config.js';

const GITHUB_APP_BOT_SUFFIX = '[bot]';

export function githubBotLogin(username: string): string {
  const normalized = username.trim();
  return normalized.toLowerCase().endsWith(GITHUB_APP_BOT_SUFFIX)
    ? normalized
    : `${normalized}${GITHUB_APP_BOT_SUFFIX}`;
}

export function configuredGithubAppBotLogin(): string | undefined {
  const configuredUsername = config.GITHUB_APP_USERNAME?.trim();
  return configuredUsername ? githubBotLogin(configuredUsername) : undefined;
}

export function githubAppBotLogin(): string {
  return configuredGithubAppBotLogin() ?? githubBotLogin(config.GITHUB_APP_SLUG);
}
