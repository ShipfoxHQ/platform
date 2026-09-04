import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {projectJobListenerSubscriptions} from '#db/job-listener-subscriptions.js';

const mocks = vi.hoisted(() => ({
  dispatchIntegrationEvent: vi.fn(),
  getIntegrationConnectionById: vi.fn(),
}));

vi.mock('#core/dispatch-integration-event.js', () => ({
  dispatchIntegrationEvent: (...args: unknown[]) => mocks.dispatchIntegrationEvent(...args),
}));

const {createTriggersE2eRoutes} = await import('./e2e-routes.js');
const workflows = {} as WorkflowsModuleClient;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const routeParams = {
  workflows,
  integrations: {
    resolveConnectionById: (input: {connectionId: string}) =>
      mocks.getIntegrationConnectionById(input),
  } as IntegrationsModuleClient,
};

describe('triggers E2E routes', () => {
  beforeEach(() => {
    mocks.getIntegrationConnectionById.mockReset();
    mocks.getIntegrationConnectionById.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    mocks.dispatchIntegrationEvent.mockReset();
    await closeApp();
  });

  test('reports a listener without projected subscriptions as not ready', async () => {
    const jobId = crypto.randomUUID();
    const app = await createApp({routes: [createTriggersE2eRoutes(routeParams)], swagger: false});

    const response = await app.inject({
      method: 'GET',
      url: `/triggers/listeners/${jobId}/readiness`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ready: false});
  });

  test('reports a listener with projected subscriptions as ready', async () => {
    const workspaceId = crypto.randomUUID();
    const workflowRunId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    await projectJobListenerSubscriptions({
      workspaceId,
      workflowRunId,
      jobId,
      on: [{source: 'listener-source', event: 'received'}],
      until: null,
    });
    const app = await createApp({routes: [createTriggersE2eRoutes(routeParams)], swagger: false});

    const response = await app.inject({
      method: 'GET',
      url: `/triggers/listeners/${jobId}/readiness`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ready: true});
  });

  test('dispatches a synthetic listener event through the integration dispatcher', async () => {
    mocks.dispatchIntegrationEvent.mockResolvedValue(undefined);
    const body = {
      workspace_id: crypto.randomUUID(),
      connection_id: crypto.randomUUID(),
      source: 'listener-source',
      event: 'received',
      delivery_id: 'delivery-1',
      payload: {method: 'POST', body: {delivery_id: 'delivery-1'}},
    };
    mocks.getIntegrationConnectionById.mockResolvedValue({
      id: body.connection_id,
      workspaceId: body.workspace_id,
      provider: 'webhook',
      slug: body.source,
      displayName: 'Listener webhook',
      lifecycleStatus: 'active',
    });
    const app = await createApp({routes: [createTriggersE2eRoutes(routeParams)], swagger: false});

    const response = await app.inject({
      method: 'POST',
      url: '/triggers/listener-events',
      payload: body,
    });

    expect(response.statusCode).toBe(202);
    const result = response.json();
    expect(result).toMatchObject({delivery_id: body.delivery_id});
    expect(result.event_ref).toMatch(UUID_V4_PATTERN);
    expect(mocks.getIntegrationConnectionById).toHaveBeenCalledWith({
      connectionId: body.connection_id,
    });
    expect(mocks.dispatchIntegrationEvent).toHaveBeenCalledWith({
      workflows,
      eventRef: result.event_ref,
      origin: 'dev',
      workspaceId: body.workspace_id,
      provider: 'webhook',
      source: body.source,
      event: body.event,
      deliveryId: body.delivery_id,
      connectionId: body.connection_id,
      connectionName: 'Listener webhook',
      payload: body.payload,
      receivedAt: expect.any(Date),
    });
  });

  test('rejects a synthetic event when its connection is not found', async () => {
    const app = await createApp({routes: [createTriggersE2eRoutes(routeParams)], swagger: false});
    const body = {
      workspace_id: crypto.randomUUID(),
      connection_id: crypto.randomUUID(),
      source: 'listener-source',
      event: 'received',
      delivery_id: 'delivery-1',
      payload: {method: 'POST'},
    };

    const response = await app.inject({
      method: 'POST',
      url: '/triggers/listener-events',
      payload: body,
    });

    expect(response.statusCode).toBe(404);
    expect(mocks.dispatchIntegrationEvent).not.toHaveBeenCalled();
  });

  test('rejects a synthetic event when its connection belongs to another workspace', async () => {
    const body = {
      workspace_id: crypto.randomUUID(),
      connection_id: crypto.randomUUID(),
      source: 'listener-source',
      event: 'received',
      delivery_id: 'delivery-1',
      payload: {method: 'POST'},
    };
    mocks.getIntegrationConnectionById.mockResolvedValue({
      id: body.connection_id,
      workspaceId: crypto.randomUUID(),
      provider: 'webhook',
      slug: body.source,
      displayName: 'Listener webhook',
      lifecycleStatus: 'active',
    });
    const app = await createApp({routes: [createTriggersE2eRoutes(routeParams)], swagger: false});

    const response = await app.inject({
      method: 'POST',
      url: '/triggers/listener-events',
      payload: body,
    });

    expect(response.statusCode).toBe(403);
    expect(mocks.dispatchIntegrationEvent).not.toHaveBeenCalled();
  });

  test('rejects a synthetic event when its connection is inactive', async () => {
    const body = {
      workspace_id: crypto.randomUUID(),
      connection_id: crypto.randomUUID(),
      source: 'listener-source',
      event: 'received',
      delivery_id: 'delivery-1',
      payload: {method: 'POST'},
    };
    mocks.getIntegrationConnectionById.mockResolvedValue({
      id: body.connection_id,
      workspaceId: body.workspace_id,
      provider: 'webhook',
      slug: body.source,
      displayName: 'Listener webhook',
      lifecycleStatus: 'disabled',
    });
    const app = await createApp({routes: [createTriggersE2eRoutes(routeParams)], swagger: false});

    const response = await app.inject({
      method: 'POST',
      url: '/triggers/listener-events',
      payload: body,
    });

    expect(response.statusCode).toBe(422);
    expect(mocks.dispatchIntegrationEvent).not.toHaveBeenCalled();
  });

  test('rejects a synthetic event when its source does not match the connection', async () => {
    const body = {
      workspace_id: crypto.randomUUID(),
      connection_id: crypto.randomUUID(),
      source: 'untrusted-source',
      event: 'received',
      delivery_id: 'delivery-1',
      payload: {method: 'POST'},
    };
    mocks.getIntegrationConnectionById.mockResolvedValue({
      id: body.connection_id,
      workspaceId: body.workspace_id,
      provider: 'webhook',
      slug: 'listener-source',
      displayName: 'Listener webhook',
      lifecycleStatus: 'active',
    });
    const app = await createApp({routes: [createTriggersE2eRoutes(routeParams)], swagger: false});

    const response = await app.inject({
      method: 'POST',
      url: '/triggers/listener-events',
      payload: body,
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.dispatchIntegrationEvent).not.toHaveBeenCalled();
  });

  test('rejects malformed synthetic event bodies before dispatching', async () => {
    const app = await createApp({routes: [createTriggersE2eRoutes(routeParams)], swagger: false});

    const response = await app.inject({
      method: 'POST',
      url: '/triggers/listener-events',
      payload: {
        workspace_id: crypto.randomUUID(),
        connection_id: crypto.randomUUID(),
        source: 'listener-source',
        event: 'received',
        delivery_id: 'delivery-1',
        payload: 'not-an-object',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.getIntegrationConnectionById).not.toHaveBeenCalled();
    expect(mocks.dispatchIntegrationEvent).not.toHaveBeenCalled();
  });

  test('propagates dispatcher failures instead of returning 202', async () => {
    mocks.dispatchIntegrationEvent.mockRejectedValue(new Error('dispatcher failed'));
    const body = {
      workspace_id: crypto.randomUUID(),
      connection_id: crypto.randomUUID(),
      source: 'listener-source',
      event: 'received',
      delivery_id: 'delivery-1',
      payload: {method: 'POST'},
    };
    mocks.getIntegrationConnectionById.mockResolvedValue({
      id: body.connection_id,
      workspaceId: body.workspace_id,
      provider: 'webhook',
      slug: body.source,
      displayName: 'Listener webhook',
      lifecycleStatus: 'active',
    });
    const app = await createApp({routes: [createTriggersE2eRoutes(routeParams)], swagger: false});

    const response = await app.inject({
      method: 'POST',
      url: '/triggers/listener-events',
      payload: body,
    });

    expect(response.statusCode).toBe(500);
    expect(mocks.dispatchIntegrationEvent).toHaveBeenCalledTimes(1);
  });

  test('rejects payloads above the E2E route body limit', async () => {
    const app = await createApp({routes: [createTriggersE2eRoutes(routeParams)], swagger: false});

    const response = await app.inject({
      method: 'POST',
      url: '/triggers/listener-events',
      payload: {
        workspace_id: crypto.randomUUID(),
        connection_id: crypto.randomUUID(),
        source: 'listener-source',
        event: 'received',
        delivery_id: 'delivery-1',
        payload: {body: 'x'.repeat(1_100_000)},
      },
    });

    expect(response.statusCode).toBe(413);
    expect(mocks.getIntegrationConnectionById).not.toHaveBeenCalled();
    expect(mocks.dispatchIntegrationEvent).not.toHaveBeenCalled();
  });
});
