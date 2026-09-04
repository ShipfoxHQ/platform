import type {
  E2eDispatchListenerEventBodyDto,
  E2eDispatchListenerEventResponseDto,
} from '@shipfox/api-triggers-dto';
import {requestJson} from '@shipfox/e2e-core';

export interface DispatchListenerEventParams {
  workspaceId: string;
  connectionId: string;
  source: string;
  event: string;
  deliveryId: string;
  payload: Record<string, unknown>;
}

export type DispatchListenerEventResponse = E2eDispatchListenerEventResponseDto;

/** Dispatches a synthetic integration envelope through the owning Triggers module. */
export async function dispatchListenerEvent(
  params: DispatchListenerEventParams,
): Promise<DispatchListenerEventResponse> {
  const body = {
    workspace_id: params.workspaceId,
    connection_id: params.connectionId,
    source: params.source,
    event: params.event,
    delivery_id: params.deliveryId,
    payload: params.payload,
  } satisfies E2eDispatchListenerEventBodyDto;
  return await requestJson<DispatchListenerEventResponse>(
    'post',
    '/__e2e/triggers/listener-events',
    {
      json: body,
    },
  );
}
