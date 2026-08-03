import {PROVIDER_CATALOG} from './provider-catalog.js';

describe('PROVIDER_CATALOG', () => {
  test('contains route entries for github, sentry, and gitea', () => {
    expect(PROVIDER_CATALOG.github).toMatchObject({
      kind: 'redirect-install',
      setupPath: '/w/$workspaceSlug/integrations/github',
    });
    expect(PROVIDER_CATALOG.sentry).toMatchObject({
      kind: 'redirect-install',
      setupPath: '/w/$workspaceSlug/integrations/sentry',
    });
    expect(PROVIDER_CATALOG.linear).toMatchObject({
      kind: 'redirect-install',
      iconName: 'linear',
      setupPath: '/w/$workspaceSlug/integrations/linear',
    });
    expect(PROVIDER_CATALOG.gitea).toMatchObject({
      kind: 'direct-connect',
      setupPath: '/w/$workspaceSlug/integrations/gitea',
    });
  });

  test('marks providers with the install behavior their pages implement', () => {
    expect(PROVIDER_CATALOG.github?.kind).toBe('redirect-install');
    expect(PROVIDER_CATALOG.sentry?.kind).toBe('redirect-install');
    expect(PROVIDER_CATALOG.linear?.kind).toBe('redirect-install');
    expect(PROVIDER_CATALOG.gitea?.kind).toBe('direct-connect');
    expect(PROVIDER_CATALOG.webhook?.kind).toBe('modal-connect');
  });

  test('declares webhook as a modal provider with the remixicon webhook icon', () => {
    expect(PROVIDER_CATALOG.webhook).toEqual({
      kind: 'modal-connect',
      iconName: 'webhookLine',
    });
  });

  test('returns undefined for unknown providers (gallery filter behavior)', () => {
    expect(PROVIDER_CATALOG.gitlab).toBeUndefined();
  });
});
