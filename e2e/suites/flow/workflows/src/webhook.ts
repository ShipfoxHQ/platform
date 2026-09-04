import type {WebhookConnectionDto} from '@shipfox/api-integration-webhook-dto';
import type {
  TriggerEventDetailResponseDto,
  TriggerEventListResponseDto,
} from '@shipfox/api-triggers-dto';
import type {createApiClient} from '@shipfox/e2e-core';
import {waitForRunByDeliveryId} from '@shipfox/e2e-observe-workflows';
import type {AttachFn} from './attachments.js';
import {logAttachmentName} from './attachments.js';

const WEBHOOK_RECEIVED_EVENT = 'received';

export interface WebhookDiagnosticsRequest {
  deliveryIds: string[];
  source: string;
}

export async function createWebhookConnection(params: {
  client: ReturnType<typeof createApiClient>;
  scenario: string;
  slug: string;
  uniqueId: string;
  workspaceId: string;
}): Promise<WebhookConnectionDto> {
  return await params.client.requestJson<WebhookConnectionDto>(
    'post',
    '/integrations/webhook/connections',
    {
      json: {
        workspace_id: params.workspaceId,
        name: `E2E ${params.scenario} ${params.uniqueId}`,
        slug: params.slug,
      },
    },
  );
}

export function webhookUrlWithQuery(
  inboundUrl: string,
  query: Record<string, string> | undefined,
): string {
  const url = new URL(inboundUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export function webhookHeaders(
  configuredHeaders: Record<string, string> | undefined,
  deliveryId: string,
): Headers {
  const headers = new Headers(configuredHeaders);
  headers.set('x-delivery-id', deliveryId);
  return headers;
}

export async function postWebhookDelivery(params: {
  client: ReturnType<typeof createApiClient>;
  connection: WebhookConnectionDto;
  deliveryId: string;
  webhook:
    | {
        body?: unknown;
        headers?: Record<string, string> | undefined;
        query?: Record<string, string> | undefined;
      }
    | undefined;
}): Promise<void> {
  await params.client.requestJson<{delivery_id: string}>(
    'post',
    webhookUrlWithQuery(params.connection.inbound_url, params.webhook?.query),
    {
      headers: webhookHeaders(params.webhook?.headers, params.deliveryId),
      json: params.webhook?.body ?? {delivery_id: params.deliveryId},
    },
  );
}

export async function attachWebhookTriggerDiagnostics(params: {
  attach: AttachFn;
  client: ReturnType<typeof createApiClient>;
  deliveryIds: string[];
  source: string;
  workspaceId: string;
}): Promise<void> {
  try {
    const search = new URLSearchParams({
      workspace_id: params.workspaceId,
      source: params.source,
      event: WEBHOOK_RECEIVED_EVENT,
      limit: '50',
    });
    const events = await params.client.requestJson<TriggerEventListResponseDto>(
      'get',
      `/trigger-events?${search}`,
    );
    await params.attach({
      name: `webhook-trigger-events-${logAttachmentName(params.source)}.json`,
      contentType: 'application/json',
      body: JSON.stringify(events, null, 2),
    });

    const deliveryIds = new Set(params.deliveryIds);
    for (const event of events.trigger_events) {
      if (!event.delivery_id || !deliveryIds.has(event.delivery_id)) continue;
      const detail = await params.client.requestJson<TriggerEventDetailResponseDto>(
        'get',
        `/trigger-events/${event.id}`,
      );
      await params.attach({
        name: `webhook-trigger-event-${logAttachmentName(event.delivery_id)}.json`,
        contentType: 'application/json',
        body: JSON.stringify(detail, null, 2),
      });
    }
  } catch (error) {
    await params
      .attach({
        name: `webhook-trigger-events-${logAttachmentName(params.source)}.error.txt`,
        contentType: 'text/plain',
        body: error instanceof Error ? error.message : String(error),
      })
      .catch(() => undefined);
  }
}

export async function triggerWebhookAndAwaitRun(params: {
  attach: AttachFn;
  client: ReturnType<typeof createApiClient>;
  connection: WebhookConnectionDto;
  projectId: string;
  scenario: string;
  token: string;
  webhook:
    | {
        body?: unknown;
        headers?: Record<string, string> | undefined;
        query?: Record<string, string> | undefined;
      }
    | undefined;
  workspaceId: string;
}): Promise<{deliveryIds: string[]; runId: string}> {
  const maxAttempts = 8;
  const deliveryIds: string[] = [];
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const deliveryId = crypto.randomUUID();
    deliveryIds.push(deliveryId);
    await postWebhookDelivery({
      client: params.client,
      connection: params.connection,
      deliveryId,
      webhook: {
        ...params.webhook,
        body: params.webhook?.body ?? {
          scenario: params.scenario,
          attempt,
          delivery_id: deliveryId,
        },
      },
    });

    try {
      const run = await waitForRunByDeliveryId({
        projectId: params.projectId,
        deliveryId,
        token: params.token,
        timeoutMs: 15_000,
        workspaceId: params.workspaceId,
      });
      return {deliveryIds, runId: run.id};
    } catch (error) {
      lastError = error;
    }
  }

  await attachWebhookTriggerDiagnostics({
    attach: params.attach,
    client: params.client,
    deliveryIds,
    source: params.connection.slug,
    workspaceId: params.workspaceId,
  });
  throw lastError instanceof Error
    ? lastError
    : new Error(`No run appeared for ${params.scenario} after ${maxAttempts} webhook deliveries`);
}
