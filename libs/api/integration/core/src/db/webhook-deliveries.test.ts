import {
  INTEGRATION_EVENT_RECEIVED,
  INTEGRATION_SOURCE_COMMIT_PUSHED,
  INTEGRATION_SOURCE_REPOSITORY_UPDATED,
  type IntegrationEventReceivedEvent,
  type SourcePushPayload,
  type SourceRepositoryIdentity,
} from '@shipfox/api-integration-spi';
import {and, eq, sql} from 'drizzle-orm';
import {db} from './db.js';
import {integrationsOutbox} from './schema/outbox.js';
import {integrationsWebhookDeliveries} from './schema/webhook-deliveries.js';
import {
  claimWebhookDelivery,
  publishIntegrationEventReceived,
  publishSourceCommitPushed,
  publishSourcePush,
  publishSourceRepositoryUpdated,
  recordDeliveryOnly,
} from './webhook-deliveries.js';

function buildEvent(
  overrides: Partial<IntegrationEventReceivedEvent> = {},
): IntegrationEventReceivedEvent {
  return {
    provider: 'github',
    source: 'github_acme_production',
    event: 'push',
    workspaceId: crypto.randomUUID(),
    connectionId: crypto.randomUUID(),
    connectionName: 'Acme Production',
    deliveryId: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    payload: {
      externalRepositoryId: 'github:42',
      ref: 'main',
      headCommitSha: 'abc123',
      defaultBranch: 'main',
      isDefaultBranch: true,
    },
    ...overrides,
  };
}

function buildPush(overrides: Partial<SourcePushPayload> = {}): SourcePushPayload {
  return {
    externalRepositoryId: 'github:42',
    ref: 'main',
    headCommitSha: 'abc123',
    defaultBranch: 'main',
    isDefaultBranch: true,
    ...overrides,
  };
}

function buildSourcePushParams() {
  const rawPayload = {
    ref: 'refs/heads/main',
    after: 'abc123',
    repository: {id: 42, default_branch: 'main'},
  };
  return {
    provider: 'github',
    source: 'github_acme_production',
    workspaceId: crypto.randomUUID(),
    connectionId: crypto.randomUUID(),
    connectionName: 'Acme Production',
    deliveryId: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    rawPayload,
    push: buildPush(),
  };
}

function deliveriesFor(provider: string, deliveryId: string) {
  return db()
    .select()
    .from(integrationsWebhookDeliveries)
    .where(
      and(
        eq(integrationsWebhookDeliveries.provider, provider),
        eq(integrationsWebhookDeliveries.deliveryId, deliveryId),
      ),
    );
}

function outboxFor(deliveryId: string) {
  return db()
    .select()
    .from(integrationsOutbox)
    .where(sql`${integrationsOutbox.payload}->>'deliveryId' = ${deliveryId}`);
}

describe('integration webhook delivery persistence', () => {
  it('writes a delivery row and an outbox event for a new delivery', async () => {
    const event = buildEvent();

    const result = await publishIntegrationEventReceived({tx: db(), event});

    expect(result.published).toBe(true);
    expect(await deliveriesFor(event.provider, event.deliveryId)).toHaveLength(1);
    const outbox = await outboxFor(event.deliveryId);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.eventType).toBe(INTEGRATION_EVENT_RECEIVED);
    expect(outbox[0]?.payload).toMatchObject({
      provider: 'github',
      source: event.source,
      event: 'push',
      deliveryId: event.deliveryId,
      payload: {externalRepositoryId: 'github:42', isDefaultBranch: true},
    });
  });

  it('does not publish a duplicate delivery twice', async () => {
    const event = buildEvent();

    const first = await publishIntegrationEventReceived({tx: db(), event});
    const second = await publishIntegrationEventReceived({tx: db(), event});

    expect(first.published).toBe(true);
    expect(second.published).toBe(false);
    expect(await deliveriesFor(event.provider, event.deliveryId)).toHaveLength(1);
    expect(await outboxFor(event.deliveryId)).toHaveLength(1);
  });

  it('deduplicates received events per connection', async () => {
    const deliveryId = crypto.randomUUID();
    const firstConnectionEvent = buildEvent({
      provider: 'webhook',
      source: 'stripe-prod',
      event: 'received',
      deliveryId,
    });
    const secondConnectionEvent = buildEvent({
      provider: 'webhook',
      source: 'stripe-dev',
      event: 'received',
      deliveryId,
    });

    const first = await publishIntegrationEventReceived({tx: db(), event: firstConnectionEvent});
    const second = await publishIntegrationEventReceived({tx: db(), event: secondConnectionEvent});
    const duplicate = await publishIntegrationEventReceived({
      tx: db(),
      event: firstConnectionEvent,
    });

    expect(first.published).toBe(true);
    expect(second.published).toBe(true);
    expect(duplicate.published).toBe(false);
    expect(await deliveriesFor('webhook', deliveryId)).toHaveLength(2);
    expect(await outboxFor(deliveryId)).toHaveLength(2);
  });

  it('records a delivery without writing an outbox event', async () => {
    const deliveryId = crypto.randomUUID();

    await recordDeliveryOnly({tx: db(), provider: 'github', deliveryId});

    expect(await deliveriesFor('github', deliveryId)).toHaveLength(1);
    expect(await outboxFor(deliveryId)).toHaveLength(0);
  });

  it('ignores a duplicate delivery record', async () => {
    const deliveryId = crypto.randomUUID();

    await recordDeliveryOnly({tx: db(), provider: 'github', deliveryId});
    await recordDeliveryOnly({tx: db(), provider: 'github', deliveryId});

    expect(await deliveriesFor('github', deliveryId)).toHaveLength(1);
  });

  it('reports whether it claimed a delivery', async () => {
    const deliveryId = crypto.randomUUID();

    const first = await claimWebhookDelivery({tx: db(), provider: 'github', deliveryId});
    const duplicate = await claimWebhookDelivery({tx: db(), provider: 'github', deliveryId});

    expect(first.claimed).toBe(true);
    expect(duplicate.claimed).toBe(false);
  });
});

describe('publishSourcePush', () => {
  it('writes the delivery row plus both outbox events for a new delivery', async () => {
    const params = buildSourcePushParams();

    const result = await db().transaction((tx) => publishSourcePush({tx, ...params}));

    expect(result.published).toBe(true);
    expect(await deliveriesFor(params.provider, params.deliveryId)).toHaveLength(1);
    const types = (await outboxFor(params.deliveryId)).map((row) => row.eventType).sort();
    expect(types).toEqual([INTEGRATION_EVENT_RECEIVED, INTEGRATION_SOURCE_COMMIT_PUSHED].sort());
  });

  it('emits the generic envelope (for triggers) and the typed event (for projects)', async () => {
    const params = buildSourcePushParams();

    await db().transaction((tx) => publishSourcePush({tx, ...params}));

    const outbox = await outboxFor(params.deliveryId);
    const envelope = outbox.find((row) => row.eventType === INTEGRATION_EVENT_RECEIVED);
    const typed = outbox.find((row) => row.eventType === INTEGRATION_SOURCE_COMMIT_PUSHED);
    expect(envelope?.payload).toMatchObject({
      provider: 'github',
      source: params.source,
      event: 'push',
      deliveryId: params.deliveryId,
      payload: params.rawPayload,
    });
    expect(typed?.payload).toMatchObject({
      provider: 'github',
      deliveryId: params.deliveryId,
      push: {externalRepositoryId: 'github:42', ref: 'main', headCommitSha: 'abc123'},
    });
  });

  it('writes nothing for a duplicate delivery', async () => {
    const params = buildSourcePushParams();

    const first = await db().transaction((tx) => publishSourcePush({tx, ...params}));
    const second = await db().transaction((tx) => publishSourcePush({tx, ...params}));

    expect(first.published).toBe(true);
    expect(second.published).toBe(false);
    expect(await deliveriesFor(params.provider, params.deliveryId)).toHaveLength(1);
    expect(await outboxFor(params.deliveryId)).toHaveLength(2);
  });

  it('does not publish when the delivery was already recorded (record-only first)', async () => {
    const params = buildSourcePushParams();
    await recordDeliveryOnly({
      tx: db(),
      provider: params.provider,
      deliveryId: params.deliveryId,
    });

    const result = await db().transaction((tx) => publishSourcePush({tx, ...params}));

    expect(result.published).toBe(false);
    expect(await deliveriesFor(params.provider, params.deliveryId)).toHaveLength(1);
    expect(await outboxFor(params.deliveryId)).toHaveLength(0);
  });
});

describe('publishSourceCommitPushed', () => {
  function buildParams() {
    return {
      provider: 'gitea',
      workspaceId: crypto.randomUUID(),
      connectionId: crypto.randomUUID(),
      deliveryId: crypto.randomUUID(),
      receivedAt: new Date().toISOString(),
      push: buildPush({externalRepositoryId: 'gitea:gitea-owner/platform'}),
    };
  }

  it('writes only the typed event, never the generic envelope', async () => {
    const params = buildParams();

    await publishSourceCommitPushed(params);

    const outbox = await outboxFor(params.deliveryId);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.eventType).toBe(INTEGRATION_SOURCE_COMMIT_PUSHED);
    expect(outbox.some((row) => row.eventType === INTEGRATION_EVENT_RECEIVED)).toBe(false);
    expect(outbox[0]?.payload).toMatchObject({
      provider: 'gitea',
      deliveryId: params.deliveryId,
      push: {externalRepositoryId: 'gitea:gitea-owner/platform', isDefaultBranch: true},
    });
  });

  it('does not write a webhook-delivery dedup row', async () => {
    const params = buildParams();

    await publishSourceCommitPushed(params);

    expect(await deliveriesFor(params.provider, params.deliveryId)).toHaveLength(0);
  });
});

describe('publishSourceRepositoryUpdated', () => {
  function buildParams() {
    const deliveryId = crypto.randomUUID();
    const repositories: SourceRepositoryIdentity[] = [
      {
        externalRepositoryId: 'github:42',
        owner: 'acme',
        name: 'platform-renamed',
        defaultBranch: 'main',
      },
      {
        externalRepositoryId: 'github:43',
        owner: 'acme',
        name: 'runner',
        defaultBranch: 'trunk',
      },
    ];
    return {
      provider: 'github',
      source: 'github_acme_production',
      workspaceId: crypto.randomUUID(),
      connectionId: crypto.randomUUID(),
      connectionName: 'Acme Production',
      deliveryId,
      receivedAt: new Date().toISOString(),
      rawPayload: {action: 'added', repositories_added: repositories},
      event: 'installation_repositories.added',
      repositories,
    };
  }

  it('writes the generic envelope and one typed event per repository', async () => {
    const params = buildParams();

    const result = await db().transaction((tx) => publishSourceRepositoryUpdated({tx, ...params}));

    expect(result.published).toBe(true);
    const outbox = await outboxFor(params.deliveryId);
    expect(outbox).toHaveLength(3);
    expect(outbox.filter((row) => row.eventType === INTEGRATION_EVENT_RECEIVED)).toHaveLength(1);
    expect(
      outbox.filter((row) => row.eventType === INTEGRATION_SOURCE_REPOSITORY_UPDATED),
    ).toHaveLength(2);
    expect(
      outbox.find((row) => row.eventType === INTEGRATION_EVENT_RECEIVED)?.payload,
    ).toMatchObject({
      event: 'installation_repositories.added',
      payload: params.rawPayload,
    });
    expect(
      outbox
        .filter((row) => row.eventType === INTEGRATION_SOURCE_REPOSITORY_UPDATED)
        .map((row) => row.payload),
    ).toEqual(
      expect.arrayContaining(
        params.repositories.map((repository) =>
          expect.objectContaining({repository, deliveryId: params.deliveryId}),
        ),
      ),
    );
  });

  it('does not publish a duplicate delivery twice', async () => {
    const params = buildParams();

    const first = await db().transaction((tx) => publishSourceRepositoryUpdated({tx, ...params}));
    const second = await db().transaction((tx) => publishSourceRepositoryUpdated({tx, ...params}));

    expect(first.published).toBe(true);
    expect(second.published).toBe(false);
    expect(await outboxFor(params.deliveryId)).toHaveLength(3);
  });
});
