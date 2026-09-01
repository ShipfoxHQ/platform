import {randomUUID} from 'node:crypto';
import type {LinearWebhookBaseEnvelopeDto} from '@shipfox/api-integration-linear-dto';
import type {
  GetIntegrationConnectionByIdFn,
  IntegrationConnection,
  PublishIntegrationEventReceivedFn,
  RecordDeliveryOnlyFn,
} from '@shipfox/api-integration-spi';
import {db} from '#db/db.js';
import {upsertLinearInstallation} from '#db/installations.js';
import {linearInstallations} from '#db/schema/installations.js';
import {handleLinearWebhook} from './webhook.js';

function fakeConnection(overrides: Partial<IntegrationConnection> = {}): IntegrationConnection {
  return {
    id: randomUUID(),
    workspaceId: randomUUID(),
    provider: 'linear',
    externalAccountId: 'org-1',
    slug: 'Linear_Acme',
    displayName: 'Linear Acme',
    lifecycleStatus: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
    repositoryAccessMode: overrides.repositoryAccessMode ?? 'selected',
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  return {
    action: 'create',
    type: 'Issue',
    organizationId: `org-${randomUUID()}`,
    webhookTimestamp: Date.now(),
    data: {id: 'issue-1'},
    ...overrides,
  };
}

function agentSessionPayload(
  overrides: Record<string, unknown> = {},
): LinearWebhookBaseEnvelopeDto {
  return {
    action: 'created',
    type: 'AgentSessionEvent',
    organizationId: `org-${randomUUID()}`,
    appUserId: 'app-user-1',
    webhookTimestamp: Date.now(),
    agentSession: {id: 'session-1'},
    ...overrides,
  };
}

function deps(
  options: {
    connection?: IntegrationConnection | undefined;
    publishIntegrationEventReceivedResult?: {published: boolean};
  } = {},
) {
  return {
    publishIntegrationEventReceived: vi.fn<PublishIntegrationEventReceivedFn>(() =>
      Promise.resolve(options.publishIntegrationEventReceivedResult ?? {published: true}),
    ),
    recordDeliveryOnly: vi.fn<RecordDeliveryOnlyFn>(() => Promise.resolve()),
    getIntegrationConnectionById: vi.fn<GetIntegrationConnectionByIdFn>(() =>
      Promise.resolve(options.connection ?? fakeConnection()),
    ),
  };
}

function firstPublishIntegrationEventReceivedCall(publishIntegrationEventReceived: {
  mock: {calls: Array<Parameters<PublishIntegrationEventReceivedFn>>};
}): Parameters<PublishIntegrationEventReceivedFn>[0] {
  const [call] = publishIntegrationEventReceived.mock.calls;
  if (!call) throw new Error('Expected publishIntegrationEventReceived to be called');
  return call[0];
}

function firstRecordDeliveryOnlyCall(recordDeliveryOnly: {
  mock: {calls: Array<Parameters<RecordDeliveryOnlyFn>>};
}): Parameters<RecordDeliveryOnlyFn>[0] {
  const [call] = recordDeliveryOnly.mock.calls;
  if (!call) throw new Error('Expected recordDeliveryOnly to be called');
  return call[0];
}

async function seedInstallation(input: {
  connectionId: string;
  organizationId: string;
  status?: 'installed' | 'revoked' | undefined;
}): Promise<void> {
  await upsertLinearInstallation({
    connectionId: input.connectionId,
    organizationId: input.organizationId,
    organizationUrlKey: 'acme',
    appUserId: 'app-user-1',
    scopes: ['read', 'write'],
    status: input.status ?? 'installed',
  });
}

describe('handleLinearWebhook', () => {
  beforeEach(async () => {
    await db().delete(linearInstallations);
  });

  it('publishes a supported Linear data event for an active connection', async () => {
    const connection = fakeConnection();
    const deliveryId = randomUUID();
    const rawPayload = payload({organizationId: 'org-active'});
    await seedInstallation({connectionId: connection.id, organizationId: 'org-active'});
    const handlers = deps({connection});

    const result = await handleLinearWebhook({
      tx: db(),
      deliveryId,
      payload: rawPayload,
      rawPayload,
      ...handlers,
    });

    expect(result.outcome).toBe('published');
    expect(handlers.recordDeliveryOnly).not.toHaveBeenCalled();
    expect(
      firstPublishIntegrationEventReceivedCall(handlers.publishIntegrationEventReceived),
    ).toMatchObject({
      event: {
        provider: 'linear',
        source: connection.slug,
        event: 'Issue.create',
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        connectionName: connection.displayName,
        deliveryId,
        payload: rawPayload,
      },
    });
  });

  it('returns duplicate when the delivery was already published', async () => {
    const connection = fakeConnection();
    const rawPayload = payload({organizationId: 'org-duplicate'});
    await seedInstallation({connectionId: connection.id, organizationId: 'org-duplicate'});
    const handlers = deps({
      connection,
      publishIntegrationEventReceivedResult: {published: false},
    });

    const result = await handleLinearWebhook({
      tx: db(),
      deliveryId: randomUUID(),
      payload: rawPayload,
      rawPayload,
      ...handlers,
    });

    expect(result.outcome).toBe('duplicate');
    expect(handlers.publishIntegrationEventReceived).toHaveBeenCalledTimes(1);
    expect(handlers.recordDeliveryOnly).not.toHaveBeenCalled();
  });

  it.each([
    ['created', 'agentSession.created'],
    ['prompted', 'agentSession.prompted'],
  ] as const)('publishes AgentSessionEvent %s as %s', async (action, event) => {
    const connection = fakeConnection();
    const rawPayload = agentSessionPayload({
      action,
      organizationId: `org-${action}`,
      promptContext: '<issue identifier="ENG-879">Route the complete payload</issue>',
    });
    await seedInstallation({connectionId: connection.id, organizationId: `org-${action}`});
    const handlers = deps({connection});

    const result = await handleLinearWebhook({
      tx: db(),
      deliveryId: randomUUID(),
      payload: rawPayload,
      rawPayload,
      ...handlers,
    });

    expect(result.outcome).toBe('published');
    const published = firstPublishIntegrationEventReceivedCall(
      handlers.publishIntegrationEventReceived,
    );
    expect(published.event.event).toBe(event);
    expect(published.event.payload).toEqual(rawPayload);
  });

  it('records the delivery only for an unknown organization', async () => {
    const handlers = deps();
    const deliveryId = randomUUID();

    const result = await handleLinearWebhook({
      tx: db(),
      deliveryId,
      payload: payload({organizationId: 'org-missing'}),
      rawPayload: payload({organizationId: 'org-missing'}),
      ...handlers,
    });

    expect(result.outcome).toBe('unknown-organization');
    expect(handlers.getIntegrationConnectionById).not.toHaveBeenCalled();
    expect(handlers.publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(firstRecordDeliveryOnlyCall(handlers.recordDeliveryOnly)).toMatchObject({
      provider: 'linear',
      deliveryId,
    });
  });

  it('records the delivery only for a revoked installation', async () => {
    const connection = fakeConnection();
    const rawPayload = payload({organizationId: 'org-revoked'});
    await seedInstallation({
      connectionId: connection.id,
      organizationId: 'org-revoked',
      status: 'revoked',
    });
    const handlers = deps({connection});

    const result = await handleLinearWebhook({
      tx: db(),
      deliveryId: randomUUID(),
      payload: rawPayload,
      rawPayload,
      ...handlers,
    });

    expect(result.outcome).toBe('revoked-installation');
    expect(handlers.getIntegrationConnectionById).not.toHaveBeenCalled();
    expect(handlers.publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(handlers.recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  it('records the delivery only when the installation has no connection', async () => {
    const connection = fakeConnection();
    const rawPayload = payload({organizationId: 'org-dangling'});
    await seedInstallation({connectionId: connection.id, organizationId: 'org-dangling'});
    const handlers = deps({connection});
    handlers.getIntegrationConnectionById.mockResolvedValue(undefined);

    const result = await handleLinearWebhook({
      tx: db(),
      deliveryId: randomUUID(),
      payload: rawPayload,
      rawPayload,
      ...handlers,
    });

    expect(result.outcome).toBe('missing-connection');
    expect(handlers.publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(handlers.recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  it.each([
    'disabled',
    'error',
  ] as const)('records the delivery only when the connection is %s', async (lifecycleStatus) => {
    const connection = fakeConnection({lifecycleStatus});
    const rawPayload = payload({organizationId: `org-${lifecycleStatus}`});
    await seedInstallation({
      connectionId: connection.id,
      organizationId: `org-${lifecycleStatus}`,
    });
    const handlers = deps({connection});

    const result = await handleLinearWebhook({
      tx: db(),
      deliveryId: randomUUID(),
      payload: rawPayload,
      rawPayload,
      ...handlers,
    });

    expect(result.outcome).toBe('inactive-connection');
    expect(handlers.publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(handlers.recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  it('records the delivery only for unsupported resources', async () => {
    const connection = fakeConnection();
    const rawPayload = payload({organizationId: 'org-reaction', type: 'Reaction'});
    await seedInstallation({connectionId: connection.id, organizationId: 'org-reaction'});
    const handlers = deps({connection});

    const result = await handleLinearWebhook({
      tx: db(),
      deliveryId: randomUUID(),
      payload: rawPayload,
      rawPayload,
      ...handlers,
    });

    expect(result.outcome).toBe('unsupported-event');
    expect(handlers.publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(handlers.recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });

  it('records and drops an unsupported AgentSessionEvent action', async () => {
    const connection = fakeConnection();
    const rawPayload = agentSessionPayload({action: 'resolved', organizationId: 'org-resolved'});
    await seedInstallation({connectionId: connection.id, organizationId: 'org-resolved'});
    const handlers = deps({connection});

    const result = await handleLinearWebhook({
      tx: db(),
      deliveryId: randomUUID(),
      payload: rawPayload,
      rawPayload,
      ...handlers,
    });

    expect(result.outcome).toBe('unsupported-event');
    expect(handlers.publishIntegrationEventReceived).not.toHaveBeenCalled();
    expect(handlers.recordDeliveryOnly).toHaveBeenCalledTimes(1);
  });
});
