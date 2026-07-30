import {
  INTEGRATION_EVENT_RECEIVED,
  INTEGRATION_SOURCE_COMMIT_PUSHED,
  INTEGRATION_SOURCE_REPOSITORY_UPDATED,
  integrationEventReceivedSchema,
  integrationSourceCommitPushedSchema,
  integrationSourceRepositoryUpdatedSchema,
  integrationsEventSchemas,
} from './events.js';

const validEventReceived = {
  provider: 'github',
  source: 'github',
  event: 'push',
  workspaceId: 'ws-1',
  connectionId: 'conn-1',
  connectionName: 'Acme Production',
  deliveryId: 'delivery-1',
  receivedAt: '2026-06-21T00:00:00.000Z',
  payload: {opaque: true},
};

const validCommitPushed = {
  provider: 'github',
  workspaceId: 'ws-1',
  connectionId: 'conn-1',
  deliveryId: 'delivery-1',
  receivedAt: '2026-06-21T00:00:00.000Z',
  push: {
    externalRepositoryId: 'acme/repo',
    ref: 'refs/heads/main',
    headCommitSha: 'abc123',
    defaultBranch: 'main',
    isDefaultBranch: true,
  },
};

const validRepositoryUpdated = {
  provider: 'github',
  workspaceId: 'ws-1',
  connectionId: 'conn-1',
  deliveryId: 'delivery-1',
  receivedAt: '2026-06-21T00:00:00.000Z',
  repository: {
    externalRepositoryId: 'github:42',
    owner: 'acme',
    name: 'platform-renamed',
    defaultBranch: 'main',
  },
};

describe('integrationSourceCommitPushedSchema', () => {
  it('parses a valid commit-pushed payload unchanged', () => {
    const result = integrationSourceCommitPushedSchema.parse(validCommitPushed);

    expect(result).toEqual(validCommitPushed);
  });

  it('rejects a payload missing a top-level field', () => {
    const {provider: _provider, ...withoutProvider} = validCommitPushed;

    const parse = () => integrationSourceCommitPushedSchema.parse(withoutProvider);

    expect(parse).toThrow();
  });

  it('rejects a payload missing a nested push field', () => {
    const {headCommitSha: _headCommitSha, ...pushWithoutSha} = validCommitPushed.push;
    const input = {...validCommitPushed, push: pushWithoutSha};

    const parse = () => integrationSourceCommitPushedSchema.parse(input);

    expect(parse).toThrow();
  });

  it('strips unknown keys (tolerant of forward-compatible producer additions)', () => {
    const input = {...validCommitPushed, addedLater: 'ignored'};

    const result = integrationSourceCommitPushedSchema.parse(input);

    expect(result).toEqual(validCommitPushed);
  });
});

describe('integrationEventReceivedSchema', () => {
  it('parses a valid generic integration event envelope unchanged', () => {
    const result = integrationEventReceivedSchema.parse(validEventReceived);

    expect(result).toEqual(validEventReceived);
  });

  it('defaults missing connection names to null for queued events', () => {
    const {connectionName: _connectionName, ...withoutConnectionName} = validEventReceived;

    const result = integrationEventReceivedSchema.parse(withoutConnectionName);

    expect(result).toEqual({...withoutConnectionName, connectionName: null});
  });

  it('rejects a payload missing the opaque provider payload key', () => {
    const {payload: _payload, ...withoutPayload} = validEventReceived;

    const parse = () => integrationEventReceivedSchema.parse(withoutPayload);

    expect(parse).toThrow();
  });

  it('strips unknown envelope keys', () => {
    const input = {...validEventReceived, addedLater: 'ignored'};

    const result = integrationEventReceivedSchema.parse(input);

    expect(result).toEqual(validEventReceived);
  });
});

describe('integrationSourceRepositoryUpdatedSchema', () => {
  it('parses a valid repository identity update unchanged', () => {
    const result = integrationSourceRepositoryUpdatedSchema.parse(validRepositoryUpdated);

    expect(result).toEqual(validRepositoryUpdated);
  });

  it('rejects a payload missing repository identity', () => {
    const {repository: _repository, ...withoutRepository} = validRepositoryUpdated;

    const parse = () => integrationSourceRepositoryUpdatedSchema.parse(withoutRepository);

    expect(parse).toThrow();
  });
});

describe('integrationsEventSchemas', () => {
  it('registers every integration publisher event type', () => {
    const registeredTypes = Object.keys(integrationsEventSchemas).sort();

    expect(registeredTypes).toEqual(
      [
        INTEGRATION_EVENT_RECEIVED,
        INTEGRATION_SOURCE_COMMIT_PUSHED,
        INTEGRATION_SOURCE_REPOSITORY_UPDATED,
      ].sort(),
    );
  });
});
