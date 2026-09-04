import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {closeApp, createApp} from '@shipfox/node-fastify';
import {projectJobListenerSubscriptions} from '#db/job-listener-subscriptions.js';

const mocks = vi.hoisted(() => ({
  dispatchIntegrationEvent: vi.fn(),
}));

vi.mock('#core/dispatch-integration-event.js', () => ({
  dispatchIntegrationEvent: (...args: unknown[]) => mocks.dispatchIntegrationEvent(...args),
}));

const {createTriggersE2eRoutes} = await import('./e2e-routes.js');
const workflows = {} as WorkflowsModuleClient;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

describe('triggers E2E routes', () => {
  afterEach(async () => {
    mocks.dispatchIntegrationEvent.mockReset();
    await closeApp();
  });

  test('reports a listener without projected subscriptions as not ready', async () => {
    const jobId = crypto.randomUUID();
    const app = await createApp({routes: [createTriggersE2eRoutes(workflows)], swagger: false});

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
    const app = await createApp({routes: [createTriggersE2eRoutes(workflows)], swagger: false});

    const response = await app.inject({
      method: 'GET',
      url: `/triggers/listeners/${jobId}/readiness`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ready: true});
  });

  test('dispatches a synthetic listener event through the integration dispatcher', async () => {
    mocks.dispatchIntegrationEvent.mockResolvedValue(undefined);
    const app = await createApp({routes: [createTriggersE2eRoutes(workflows)], swagger: false});
    const body = {
      workspace_id: crypto.randomUUID(),
      connection_id: crypto.randomUUID(),
      source: 'listener-source',
      event: 'received',
      delivery_id: 'delivery-1',
      payload: {method: 'POST', body: {delivery_id: 'delivery-1'}},
    };

    const response = await app.inject({
      method: 'POST',
      url: '/triggers/listener-events',
      payload: body,
    });

    expect(response.statusCode).toBe(202);
    const result = response.json();
    expect(result).toMatchObject({delivery_id: body.delivery_id});
    expect(result.event_ref).toMatch(UUID_V4_PATTERN);
    expect(mocks.dispatchIntegrationEvent).toHaveBeenCalledWith({
      workflows,
      eventRef: result.event_ref,
      workspaceId: body.workspace_id,
      provider: 'webhook',
      source: body.source,
      event: body.event,
      deliveryId: body.delivery_id,
      connectionId: body.connection_id,
      connectionName: null,
      payload: body.payload,
      receivedAt: expect.any(Date),
    });
  });
});
