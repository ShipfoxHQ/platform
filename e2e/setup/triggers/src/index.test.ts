import {beforeEach, describe, expect, test, vi} from '@shipfox/vitest/vi';

const requestJson = vi.fn();

describe('dispatchListenerEvent', () => {
  beforeEach(() => {
    vi.resetModules();
    requestJson.mockReset();
    vi.doMock('@shipfox/e2e-core', () => ({requestJson}));
  });

  test('posts the module-owned listener event setup request', async () => {
    const response = {event_ref: crypto.randomUUID(), delivery_id: 'delivery-1'};
    requestJson.mockResolvedValue(response);
    const {dispatchListenerEvent} = await import('./index.js');

    await expect(
      dispatchListenerEvent({
        workspaceId: '00000000-0000-4000-8000-000000000001',
        connectionId: '00000000-0000-4000-8000-000000000002',
        source: 'listener-source',
        event: 'received',
        deliveryId: 'delivery-1',
        payload: {method: 'POST'},
      }),
    ).resolves.toEqual(response);

    expect(requestJson).toHaveBeenCalledWith('post', '/__e2e/triggers/listener-events', {
      json: {
        workspace_id: '00000000-0000-4000-8000-000000000001',
        connection_id: '00000000-0000-4000-8000-000000000002',
        source: 'listener-source',
        event: 'received',
        delivery_id: 'delivery-1',
        payload: {method: 'POST'},
      },
    });
  });
});
