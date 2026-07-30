import {randomUUID} from 'node:crypto';
import type {
  GetIntegrationConnectionByIdFn,
  PublishIntegrationEventReceivedFn,
  PublishSourcePushFn,
  PublishSourceRepositoryUpdatedFn,
  RecordDeliveryOnlyFn,
  StoredWebhookRequest,
  WebhookProcessingResult,
} from '@shipfox/api-integration-spi';
import {createStoredWebhookRequest, WEBHOOK_MAX_RAW_BODY_BYTES} from '@shipfox/api-integration-spi';
import {
  ClientError,
  defineRoute,
  type RouteGroup,
  rawBodyPlugin,
  WEBHOOK_BODY_LIMIT,
} from '@shipfox/node-fastify';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {
  createGithubWebhookProcessor,
  type GithubWebhookProcessor,
} from '#core/webhook-processor.js';

const SIGNATURE_HEADER = 'x-hub-signature-256';
const EVENT_HEADER = 'x-github-event';
const DELIVERY_HEADER = 'x-github-delivery';

export interface CreateGithubWebhookRoutesOptions {
  coreDb: () => NodePgDatabase<Record<string, unknown>>;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  publishSourceRepositoryUpdated: PublishSourceRepositoryUpdatedFn;
  publishSourcePush: PublishSourcePushFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  deleteInstallationTokenSecret?:
    | ((params: {workspaceId: string; installationId: number}) => Promise<unknown>)
    | undefined;
  processor?: GithubWebhookProcessor | undefined;
}

export function createGithubWebhookRoutes(options: CreateGithubWebhookRoutesOptions): RouteGroup {
  const processor = options.processor ?? createGithubWebhookProcessor(options);

  const pushRoute = defineRoute({
    method: 'POST',
    path: '/',
    auth: [],
    description: 'GitHub App webhook receiver.',
    options: {bodyLimit: WEBHOOK_BODY_LIMIT},
    handler: async (request, reply) => {
      const deliveryId = request.headers[DELIVERY_HEADER];
      const signature = request.headers[SIGNATURE_HEADER];
      const event = request.headers[EVENT_HEADER];

      if (typeof deliveryId !== 'string' || !deliveryId) {
        reply.code(400);
        return {error: 'missing X-GitHub-Delivery header'};
      }
      if (typeof signature !== 'string' || !signature) {
        reply.code(401);
        return {error: 'missing X-Hub-Signature-256 header'};
      }
      if (typeof event !== 'string' || !event) {
        reply.code(400);
        return {error: 'missing X-GitHub-Event header'};
      }

      if (!(request.body instanceof Uint8Array)) {
        reply.code(400);
        return {error: 'expected raw JSON body'};
      }
      const result = await processor.process(
        createGithubStoredWebhookRequest({
          body: request.body,
          headers: request.headers,
          rawQueryString: request.raw.url?.split('?')[1] ?? '',
        }),
      );
      return sendGithubWebhookResponse(reply, result);
    },
  });

  return {
    prefix: '/webhooks/integrations/github',
    auth: [],
    plugins: [rawBodyPlugin],
    routes: [pushRoute],
  };
}

function createGithubStoredWebhookRequest(input: {
  body: Uint8Array;
  headers: Record<string, string | string[] | undefined>;
  rawQueryString: string;
}): StoredWebhookRequest {
  if (input.body.byteLength > WEBHOOK_MAX_RAW_BODY_BYTES) {
    throw new ClientError('Webhook request body is too large', 'body-too-large', {status: 413});
  }
  try {
    return createStoredWebhookRequest({
      requestId: randomUUID(),
      routeId: 'github',
      receivedAt: new Date().toISOString(),
      rawQueryString: input.rawQueryString,
      headers: githubWebhookHeaders(input.headers),
      body: input.body,
    });
  } catch (error) {
    throw new ClientError('Webhook request metadata is invalid', 'invalid-webhook-request', {
      cause: error,
    });
  }
}

function githubWebhookHeaders(headers: Record<string, string | string[] | undefined>) {
  return Object.fromEntries(
    ['content-type', DELIVERY_HEADER, EVENT_HEADER, SIGNATURE_HEADER].flatMap((name) => {
      const value = headers[name];
      return typeof value === 'string' ? [[name, value]] : [];
    }),
  );
}

function sendGithubWebhookResponse(
  reply: {code(statusCode: number): void},
  result: WebhookProcessingResult,
) {
  if (result.outcome !== 'discarded') {
    reply.code(204);
    return null;
  }

  switch (result.reason) {
    case 'invalid_signature':
      reply.code(401);
      return {error: 'invalid signature'};
    case 'malformed_payload':
      reply.code(400);
      return {error: 'malformed JSON'};
    case 'connection_unavailable':
    case 'missing_required_input':
    case 'stale_at_receipt':
    case 'unsupported_event':
      reply.code(204);
      return null;
  }
}
