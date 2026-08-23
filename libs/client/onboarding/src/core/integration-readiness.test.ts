import type {
  IntegrationCapability,
  IntegrationConnection,
  IntegrationProvider,
} from '@shipfox/client-integrations';
import {describe, expect, test} from '@shipfox/vitest/vi';
import {deriveIntegrationReadiness} from './integration-readiness.js';

function provider(key: string, capabilities: IntegrationCapability[] = []): IntegrationProvider {
  return {provider: key, displayName: key, capabilities};
}

function connection(
  providerKey: string,
  overrides: Partial<IntegrationConnection> = {},
): IntegrationConnection {
  return {
    id: `connection-${providerKey}`,
    workspaceId: 'workspace',
    provider: providerKey,
    externalAccountId: 'account',
    slug: `${providerKey}_account`,
    displayName: providerKey,
    lifecycleStatus: 'active',
    capabilities: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const GITHUB = provider('github', ['source_control', 'agent_tools']);
const LINEAR = provider('linear', ['agent_tools']);
const WEBHOOK = provider('webhook', []);

describe('deriveIntegrationReadiness', () => {
  test('reports a provider as connected when at least one connection is active', () => {
    const readiness = deriveIntegrationReadiness({
      providers: [LINEAR],
      connections: [
        connection('linear', {lifecycleStatus: 'active'}),
        connection('linear', {id: 'other', lifecycleStatus: 'error'}),
      ],
    });

    expect(readiness.providers).toEqual([
      {provider: 'linear', capabilities: ['agent_tools'], connected: true, attention: false},
    ]);
  });

  test('reports a provider as needing attention when connections exist but none is active', () => {
    const readiness = deriveIntegrationReadiness({
      providers: [LINEAR],
      connections: [
        connection('linear', {lifecycleStatus: 'error'}),
        connection('linear', {id: 'other', lifecycleStatus: 'disabled'}),
      ],
    });

    expect(readiness.providers).toEqual([
      {provider: 'linear', capabilities: ['agent_tools'], connected: false, attention: true},
    ]);
    expect(readiness.attentionProviders).toEqual(['linear']);
  });

  test('reports a provider with no connections as neither connected nor in attention', () => {
    const readiness = deriveIntegrationReadiness({
      providers: [LINEAR, GITHUB],
      connections: [connection('github', {lifecycleStatus: 'active'})],
    });

    expect(readiness.providers).toEqual([
      {provider: 'linear', capabilities: ['agent_tools'], connected: false, attention: false},
      {
        provider: 'github',
        capabilities: ['source_control', 'agent_tools'],
        connected: true,
        attention: false,
      },
    ]);
  });

  test('ignores connections for providers outside the catalog', () => {
    const readiness = deriveIntegrationReadiness({
      providers: [LINEAR],
      connections: [connection('unknown', {lifecycleStatus: 'active'})],
    });

    expect(readiness.providers).toEqual([
      {provider: 'linear', capabilities: ['agent_tools'], connected: false, attention: false},
    ]);
    expect(readiness.hasToolIntegration).toBe(false);
  });

  test('orders attention providers by the most recent connection update first', () => {
    const readiness = deriveIntegrationReadiness({
      providers: [GITHUB, LINEAR, WEBHOOK],
      connections: [
        connection('linear', {
          lifecycleStatus: 'error',
          updatedAt: '2026-03-01T00:00:00.000Z',
        }),
        connection('webhook', {
          lifecycleStatus: 'error',
          updatedAt: '2026-02-01T00:00:00.000Z',
        }),
        connection('github', {
          lifecycleStatus: 'disabled',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
      ],
    });

    expect(readiness.attentionProviders).toEqual(['linear', 'webhook', 'github']);
  });

  test('uses the newest of several connections per provider for ordering', () => {
    const readiness = deriveIntegrationReadiness({
      providers: [LINEAR, WEBHOOK],
      connections: [
        connection('linear', {
          id: 'stale',
          lifecycleStatus: 'error',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
        connection('linear', {
          id: 'fresh',
          lifecycleStatus: 'disabled',
          updatedAt: '2026-04-01T00:00:00.000Z',
        }),
        connection('webhook', {
          lifecycleStatus: 'error',
          updatedAt: '2026-03-01T00:00:00.000Z',
        }),
      ],
    });

    expect(readiness.attentionProviders).toEqual(['linear', 'webhook']);
  });

  test('keeps catalog order when attention providers updated at the same time', () => {
    const readiness = deriveIntegrationReadiness({
      providers: [GITHUB, LINEAR, WEBHOOK],
      connections: [
        connection('linear', {lifecycleStatus: 'error'}),
        connection('webhook', {lifecycleStatus: 'error'}),
        connection('github', {lifecycleStatus: 'error'}),
      ],
    });

    expect(readiness.attentionProviders).toEqual(['github', 'linear', 'webhook']);
  });

  test('skips connections with an unparsable updated_at when ordering', () => {
    const readiness = deriveIntegrationReadiness({
      providers: [LINEAR, WEBHOOK],
      connections: [
        connection('linear', {lifecycleStatus: 'error', updatedAt: 'not-a-date'}),
        connection('webhook', {lifecycleStatus: 'error', updatedAt: '2026-02-01T00:00:00.000Z'}),
      ],
    });

    expect(readiness.attentionProviders).toEqual(['webhook', 'linear']);
  });

  test('reports no attention providers when no connection needs attention', () => {
    const readiness = deriveIntegrationReadiness({
      providers: [GITHUB, LINEAR],
      connections: [
        connection('github', {lifecycleStatus: 'active'}),
        connection('linear', {lifecycleStatus: 'active'}),
      ],
    });

    expect(readiness.attentionProviders).toEqual([]);
  });

  test('reports hasSourceControl only for an active source-control connection', () => {
    expect(
      deriveIntegrationReadiness({
        providers: [GITHUB],
        connections: [connection('github', {lifecycleStatus: 'active'})],
      }).hasSourceControl,
    ).toBe(true);

    expect(
      deriveIntegrationReadiness({
        providers: [GITHUB],
        connections: [connection('github', {lifecycleStatus: 'error'})],
      }).hasSourceControl,
    ).toBe(false);

    expect(
      deriveIntegrationReadiness({
        providers: [LINEAR],
        connections: [connection('linear', {lifecycleStatus: 'active'})],
      }).hasSourceControl,
    ).toBe(false);
  });

  test('reports hasToolIntegration for an active connection without source_control', () => {
    expect(
      deriveIntegrationReadiness({
        providers: [LINEAR],
        connections: [connection('linear', {lifecycleStatus: 'active'})],
      }).hasToolIntegration,
    ).toBe(true);

    expect(
      deriveIntegrationReadiness({
        providers: [WEBHOOK],
        connections: [connection('webhook', {lifecycleStatus: 'active'})],
      }).hasToolIntegration,
    ).toBe(true);
  });

  test('GitHub never satisfies hasToolIntegration', () => {
    expect(
      deriveIntegrationReadiness({
        providers: [GITHUB],
        connections: [connection('github', {lifecycleStatus: 'active'})],
      }).hasToolIntegration,
    ).toBe(false);
  });

  test('an inactive tool connection does not satisfy hasToolIntegration', () => {
    expect(
      deriveIntegrationReadiness({
        providers: [LINEAR],
        connections: [connection('linear', {lifecycleStatus: 'error'})],
      }).hasToolIntegration,
    ).toBe(false);
  });

  test('combines providers in one readiness report', () => {
    const readiness = deriveIntegrationReadiness({
      providers: [GITHUB, LINEAR, WEBHOOK],
      connections: [
        connection('github', {lifecycleStatus: 'active'}),
        connection('linear', {lifecycleStatus: 'error'}),
      ],
    });

    expect(readiness.hasSourceControl).toBe(true);
    expect(readiness.hasToolIntegration).toBe(false);
    expect(readiness.attentionProviders).toEqual(['linear']);
  });
});
