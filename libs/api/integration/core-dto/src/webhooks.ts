import {z} from 'zod';

export const WEBHOOK_REQUEST_SCHEMA_VERSION = 1 as const;
export const WEBHOOK_MAX_RAW_BODY_BYTES = 512 * 1024;
export const WEBHOOK_MAX_SERIALIZED_REQUEST_BYTES = 1024 * 1024;
export const WEBHOOK_MAX_HEADER_BYTES = 64 * 1024;
export const WEBHOOK_MAX_RAW_QUERY_STRING_LENGTH = 8 * 1024;

const standardWebhookRouteIds = [
  'github',
  'gitea',
  'linear',
  'sentry',
  'slack.event',
  'slack.command',
] as const;

export const webhookRouteIds = [...standardWebhookRouteIds, 'webhook.connection', 'jira'] as const;

export const webhookRouteIdSchema = z.enum(webhookRouteIds);
export type WebhookRouteId = z.infer<typeof webhookRouteIdSchema>;

const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function decodedBase64Length(value: string): number {
  const paddingLength = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;

  return (value.length / 4) * 3 - paddingLength;
}

function headersByteLength(headers: Record<string, string>): number {
  return new TextEncoder().encode(JSON.stringify(headers)).byteLength;
}

const webhookHeadersSchema = z
  .record(z.string(), z.string().max(8 * 1024))
  .refine(
    (headers) =>
      Object.keys(headers).every(
        (name) => name === name.toLowerCase() && name.length > 0 && name.length <= 128,
      ),
    'Webhook header names must be lowercase and at most 128 characters',
  )
  .refine(
    (headers) => headersByteLength(headers) <= WEBHOOK_MAX_HEADER_BYTES,
    `Webhook headers must serialize to at most ${WEBHOOK_MAX_HEADER_BYTES} bytes`,
  );

const webhookBodySchema = z
  .object({
    encoding: z.literal('base64'),
    data: z
      .string()
      .max(Math.ceil(WEBHOOK_MAX_RAW_BODY_BYTES / 3) * 4)
      .regex(base64Pattern),
  })
  .strict()
  .refine(
    (body) => decodedBase64Length(body.data) <= WEBHOOK_MAX_RAW_BODY_BYTES,
    `Webhook bodies must decode to at most ${WEBHOOK_MAX_RAW_BODY_BYTES} bytes`,
  );

const storedWebhookRequestBaseSchema = z.object({
  schema_version: z.literal(WEBHOOK_REQUEST_SCHEMA_VERSION),
  request_id: z.string().uuid(),
  received_at: z.string().datetime({offset: true}),
  method: z.literal('POST'),
  raw_query_string: z.string().max(WEBHOOK_MAX_RAW_QUERY_STRING_LENGTH),
  headers: webhookHeadersSchema,
  body: webhookBodySchema,
});

const emptyPathParametersSchema = z.object({}).strict();
const connectionPathParametersSchema = z.object({connection_id: z.string().uuid()}).strict();

const standardWebhookRouteRequestSchema = storedWebhookRequestBaseSchema
  .extend({
    route_id: z.enum(standardWebhookRouteIds),
    path_parameters: emptyPathParametersSchema,
  })
  .strict();

const genericWebhookRouteRequestSchema = storedWebhookRequestBaseSchema
  .extend({
    route_id: z.literal('webhook.connection'),
    path_parameters: connectionPathParametersSchema,
  })
  .strict();

const jiraWebhookRouteRequestSchema = storedWebhookRequestBaseSchema
  .extend({
    route_id: z.literal('jira'),
    path_parameters: connectionPathParametersSchema,
  })
  .strict();

export const storedWebhookRequestSchema = z.discriminatedUnion('route_id', [
  standardWebhookRouteRequestSchema,
  genericWebhookRouteRequestSchema,
  jiraWebhookRouteRequestSchema,
]);
export type StoredWebhookRequest = z.infer<typeof storedWebhookRequestSchema>;

export const webhookProcessingResultSchema = z.discriminatedUnion('outcome', [
  z
    .object({
      outcome: z.literal('processed'),
      deliveryId: z.string().min(1).optional(),
      challenge: z.string().min(1).optional(),
    })
    .strict(),
  z.object({outcome: z.literal('duplicate'), deliveryId: z.string().min(1)}).strict(),
  z
    .object({
      outcome: z.literal('discarded'),
      reason: z.enum([
        'missing_required_input',
        'invalid_signature',
        'stale_at_receipt',
        'malformed_payload',
        'unsupported_event',
        'connection_unavailable',
      ]),
      deliveryId: z.string().min(1).optional(),
    })
    .strict(),
]);
export type WebhookProcessingResult = z.infer<typeof webhookProcessingResultSchema>;

interface CreateStoredWebhookRequestInputBase {
  requestId: string;
  routeId: WebhookRouteId;
  receivedAt: string;
  rawQueryString: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

type ConnectionScopedWebhookRouteId = 'webhook.connection' | 'jira';

export type CreateStoredWebhookRequestInput =
  | (CreateStoredWebhookRequestInputBase & {
      routeId: ConnectionScopedWebhookRouteId;
      connectionId: string;
    })
  | (CreateStoredWebhookRequestInputBase & {
      routeId: Exclude<WebhookRouteId, ConnectionScopedWebhookRouteId>;
      connectionId?: never;
    });

export function encodeWebhookBody(body: Uint8Array): string {
  let encoded = '';

  for (let index = 0; index < body.length; index += 3) {
    const first = body[index] ?? 0;
    const second = body[index + 1];
    const third = body[index + 2];
    const combined = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);

    encoded += 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'[
      (combined >> 18) & 63
    ];
    encoded += 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'[
      (combined >> 12) & 63
    ];
    encoded +=
      second === undefined
        ? '='
        : 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'[(combined >> 6) & 63];
    encoded +=
      third === undefined
        ? '='
        : 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'[combined & 63];
  }

  return encoded;
}

export function decodeWebhookBody(body: z.infer<typeof webhookBodySchema>): Uint8Array {
  const output = new Uint8Array(decodedBase64Length(body.data));
  let outputIndex = 0;

  for (let index = 0; index < body.data.length; index += 4) {
    const chunk = body.data.slice(index, index + 4);
    const values = chunk
      .split('')
      .map((character) =>
        character === '='
          ? 0
          : 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'.indexOf(character),
      );
    const first = values[0] ?? 0;
    const second = values[1] ?? 0;
    const third = values[2] ?? 0;
    const fourth = values[3] ?? 0;
    const combined = (first << 18) | (second << 12) | (third << 6) | fourth;

    output[outputIndex++] = (combined >> 16) & 255;
    if (chunk[2] !== '=') output[outputIndex++] = (combined >> 8) & 255;
    if (chunk[3] !== '=') output[outputIndex++] = combined & 255;
  }

  return output;
}

export function createStoredWebhookRequest(
  input: CreateStoredWebhookRequestInput,
): StoredWebhookRequest {
  const pathParameters =
    input.routeId === 'webhook.connection' || input.routeId === 'jira'
      ? {connection_id: input.connectionId}
      : {};

  return storedWebhookRequestSchema.parse({
    schema_version: WEBHOOK_REQUEST_SCHEMA_VERSION,
    request_id: input.requestId,
    route_id: input.routeId,
    received_at: input.receivedAt,
    method: 'POST',
    path_parameters: pathParameters,
    raw_query_string: input.rawQueryString,
    headers: input.headers,
    body: {encoding: 'base64', data: encodeWebhookBody(input.body)},
  });
}
