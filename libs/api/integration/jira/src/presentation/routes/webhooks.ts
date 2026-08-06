import {randomUUID} from 'node:crypto';
import type {StoredWebhookRequest, WebhookProcessingResult} from '@shipfox/api-integration-spi';
import {createStoredWebhookRequest, WEBHOOK_MAX_RAW_BODY_BYTES} from '@shipfox/api-integration-spi';
import {
  ClientError,
  defineRoute,
  type RouteGroup,
  rawBodyPlugin,
  WEBHOOK_BODY_LIMIT,
} from '@shipfox/node-fastify';
import {z} from 'zod';
import {
  type CreateJiraWebhookProcessorOptions,
  createJiraWebhookProcessor,
  type JiraWebhookProcessor,
} from '#core/webhook-processor.js';
import {JIRA_WEBHOOK_ROUTE_PREFIX} from '#core/webhook-url.js';

const jiraWebhookParamsSchema = z.object({connectionId: z.string().uuid()});

export {JIRA_WEBHOOK_ROUTE_PREFIX};

export interface CreateJiraWebhookRoutesOptions
  extends Omit<CreateJiraWebhookProcessorOptions, 'getJiraInstallationByConnectionId'> {
  processor?: JiraWebhookProcessor | undefined;
}

export function createJiraWebhookRoutes(options: CreateJiraWebhookRoutesOptions): RouteGroup {
  const processor = options.processor ?? createJiraWebhookProcessor(options);
  const route = defineRoute({
    method: 'POST',
    path: '/:connectionId',
    auth: [],
    description: 'Jira dynamic webhook receiver.',
    options: {bodyLimit: WEBHOOK_BODY_LIMIT},
    schema: {params: jiraWebhookParamsSchema},
    handler: async (request, reply) => {
      const body = request.body;
      if (!(body instanceof Uint8Array)) {
        throw new ClientError('Expected raw JSON body', 'invalid-webhook-request', {status: 400});
      }
      const result = await processor.process(
        createJiraStoredWebhookRequest({
          body,
          connectionId: request.params.connectionId,
          headers: request.headers,
          rawQueryString: request.raw.url?.split('?')[1] ?? '',
        }),
      );
      return sendJiraWebhookResponse(reply, result);
    },
  });

  return {
    prefix: JIRA_WEBHOOK_ROUTE_PREFIX,
    auth: [],
    plugins: [rawBodyPlugin],
    routes: [route],
  };
}

function createJiraStoredWebhookRequest(input: {
  body: Uint8Array;
  connectionId: string;
  headers: Record<string, string | string[] | undefined>;
  rawQueryString: string;
}): StoredWebhookRequest {
  if (input.body.byteLength > WEBHOOK_MAX_RAW_BODY_BYTES) {
    throw new ClientError('Webhook request body is too large', 'body-too-large', {status: 413});
  }
  try {
    return createStoredWebhookRequest({
      requestId: randomUUID(),
      routeId: 'jira',
      receivedAt: new Date().toISOString(),
      rawQueryString: input.rawQueryString,
      headers: jiraWebhookHeaders(input.headers),
      body: input.body,
      connectionId: input.connectionId,
    });
  } catch (error) {
    throw new ClientError('Webhook request metadata is invalid', 'invalid-webhook-request', {
      cause: error,
    });
  }
}

function jiraWebhookHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    ['authorization', 'content-type', 'x-atlassian-webhook-identifier'].flatMap((name) => {
      const value = headers[name];
      return typeof value === 'string' ? [[name, value]] : [];
    }),
  );
}

function sendJiraWebhookResponse(
  reply: {code(statusCode: number): void},
  result: WebhookProcessingResult,
) {
  if (result.outcome !== 'discarded') {
    reply.code(200);
    return null;
  }
  if (result.reason === 'invalid_signature' || result.reason === 'missing_required_input') {
    reply.code(401);
    return {error: 'invalid authorization'};
  }
  if (result.reason === 'malformed_payload') {
    reply.code(400);
    return {error: 'malformed JSON'};
  }
  reply.code(200);
  return null;
}
