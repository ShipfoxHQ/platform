import {beforeEach, describe, expect, test, vi} from '@shipfox/vitest/vi';

const requestJson = vi.fn();
const createApiClient = vi.fn(() => ({requestJson}));
const pollUntil = vi.fn();

describe('webhook helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    requestJson.mockReset();
    createApiClient.mockClear();
    pollUntil.mockReset();
    pollUntil.mockImplementation(
      async (_options: unknown, callback: () => Promise<unknown>) => await callback(),
    );
    vi.doMock('@shipfox/e2e-core', () => ({createApiClient, pollUntil}));
    vi.doMock('@shipfox/e2e-observe-workflows', () => ({waitForRunByDeliveryId: vi.fn()}));
  });

  test('follows trigger-event cursors until it finds the delivery', async () => {
    const detail = {id: 'event-2', delivery_id: 'target-delivery'};
    requestJson
      .mockResolvedValueOnce({
        trigger_events: [{id: 'event-1', delivery_id: 'other-delivery'}],
        next_cursor: 'cursor-1',
      })
      .mockResolvedValueOnce({
        trigger_events: [{id: detail.id, delivery_id: detail.delivery_id}],
        next_cursor: null,
      })
      .mockResolvedValueOnce(detail);
    const {waitForTriggerEvent} = await import('./webhook.js');

    await expect(
      waitForTriggerEvent({
        token: 'token',
        workspaceId: '00000000-0000-4000-8000-000000000001',
        source: 'source',
        event: 'received',
        outcome: 'routed',
        deliveryId: detail.delivery_id,
        timeoutMs: 1_000,
      }),
    ).resolves.toEqual(detail);

    expect(requestJson).toHaveBeenNthCalledWith(
      2,
      'get',
      expect.stringContaining('cursor=cursor-1'),
    );
    expect(requestJson).toHaveBeenLastCalledWith('get', `/trigger-events/${detail.id}`);
  });
});
