import {requestJson} from '@shipfox/e2e-core';

export interface DispatchListenerEventParams {
  workspaceId: string;
  connectionId: string;
  source: string;
  event: string;
  deliveryId: string;
  payload: Record<string, unknown>;
}

export interface DispatchListenerEventResponse {
  event_ref: string;
  delivery_id: string;
}

/** Dispatches a synthetic integration envelope through the owning Triggers module. */
export async function dispatchListenerEvent(
  params: DispatchListenerEventParams,
): Promise<DispatchListenerEventResponse> {
  return await requestJson<DispatchListenerEventResponse>(
    'post',
    '/__e2e/triggers/listener-events',
    {
      json: {
        workspace_id: params.workspaceId,
        connection_id: params.connectionId,
        source: params.source,
        event: params.event,
        delivery_id: params.deliveryId,
        payload: params.payload,
      },
    },
  );
}
