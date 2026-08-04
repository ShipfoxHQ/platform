import {getProviderIcon, PROVIDER_ICONS} from './provider-icons.js';

describe('PROVIDER_ICONS', () => {
  test('declares an icon for every known provider', () => {
    expect(PROVIDER_ICONS).toMatchObject({
      github: 'github',
      sentry: 'sentry',
      linear: 'linear',
      slack: 'slack',
      jira: 'jira',
      gitea: 'gitea',
      webhook: 'webhookLine',
    });
  });
});

describe('getProviderIcon', () => {
  test('resolves a known provider', () => {
    expect(getProviderIcon('github')).toBe('github');
  });

  test('returns undefined for unknown providers', () => {
    expect(getProviderIcon('gitlab')).toBeUndefined();
  });
});
