import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {
  type JiraWebhookEnvelopeDto,
  jiraWebhookEnvelopeSchema,
} from '@shipfox/api-integration-jira-dto';
import {
  decodeWebhookBody,
  type GetIntegrationConnectionByIdFn,
  type PublishIntegrationEventReceivedFn,
  type RecordDeliveryOnlyFn,
  type StoredWebhookRequest,
  type WebhookProcessingResult,
} from '@shipfox/api-integration-spi';
import {extractBearerToken} from '@shipfox/node-fastify';
import {verifyHs256} from '@shipfox/node-jwt';
import {logger} from '@shipfox/node-opentelemetry';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {z} from 'zod';
import {config} from '#config.js';
import {handleJiraWebhook, isJiraInstallationUsable} from '#core/webhook.js';
import {getJiraInstallationByConnectionId} from '#db/installations.js';

const JIRA_PROVIDER = 'jira';
const jiraWebhookJwtClaimsSchema = z
  .object({iat: z.number().int(), exp: z.number().int()})
  .passthrough();

export interface CreateJiraWebhookProcessorOptions {
  coreDb: () => NodePgDatabase<Record<string, unknown>>;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  getJiraInstallationByConnectionId?: typeof getJiraInstallationByConnectionId;
}

export interface JiraWebhookProcessor {
  process(request: StoredWebhookRequest): Promise<WebhookProcessingResult>;
}

export function createJiraWebhookProcessor(
  options: CreateJiraWebhookProcessorOptions,
): JiraWebhookProcessor {
  return {process: (request) => processJiraWebhookRequest(options, request)};
}

async function processJiraWebhookRequest(
  options: CreateJiraWebhookProcessorOptions,
  request: StoredWebhookRequest,
): Promise<WebhookProcessingResult> {
  if (request.route_id !== 'jira') {
    throw new Error(`Jira processor cannot process ${request.route_id} requests`);
  }

  const rawBody = Buffer.from(decodeWebhookBody(request.body));
  const deliveryId = jiraDeliveryId(request, rawBody);
  const authorization = request.headers.authorization;
  if (!authorization) return invalidAuthorization(deliveryId);

  const token = extractBearerToken(authorization);
  if (!token) return invalidAuthorization(deliveryId);

  try {
    await verifyHs256({
      token,
      secret: config.JIRA_OAUTH_CLIENT_SECRET,
      schema: jiraWebhookJwtClaimsSchema,
      verificationTime: new Date(request.received_at),
    });
  } catch (error) {
    logger().warn(
      {deliveryId, errName: error instanceof Error ? error.name : typeof error},
      'Jira webhook authorization verification failed',
    );
    return invalidAuthorization(deliveryId);
  }

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(rawBody.toString('utf8'));
  } catch (error) {
    logger().warn({deliveryId, err: error}, 'Jira webhook payload JSON parse failed');
    return {outcome: 'discarded', reason: 'malformed_payload', deliveryId};
  }

  const payload = jiraWebhookEnvelopeSchema.safeParse(rawPayload);
  if (!payload.success) {
    await recordDeliveryOnly(options, deliveryId);
    return {outcome: 'discarded', reason: 'unsupported_event', deliveryId};
  }

  const connectionId = request.path_parameters.connection_id;
  const connection = await options.getIntegrationConnectionById(connectionId);
  if (
    !connection ||
    connection.provider !== JIRA_PROVIDER ||
    connection.lifecycleStatus !== 'active'
  ) {
    return await discardUnavailableConnection(options, deliveryId);
  }
  const installation = await (
    options.getJiraInstallationByConnectionId ?? getJiraInstallationByConnectionId
  )(connectionId);
  if (
    !isJiraInstallationUsable(installation) ||
    !hasMatchingWebhookId(payload.data, installation.webhookIds)
  ) {
    return await discardUnavailableConnection(options, deliveryId);
  }

  const result = await options.coreDb().transaction(async (tx) =>
    handleJiraWebhook({
      tx,
      deliveryId,
      receivedAt: request.received_at,
      rawPayload: payload.data,
      cloudId: installation.cloudId,
      connection: connection as typeof connection & {provider: 'jira'},
      authorizingAccountId: installation.authorizingAccountId,
      publishIntegrationEventReceived: options.publishIntegrationEventReceived,
      recordDeliveryOnly: options.recordDeliveryOnly,
    }),
  );

  if (result === 'duplicate') return {outcome: 'duplicate', deliveryId};
  if (result === 'discarded')
    return {outcome: 'discarded', reason: 'unsupported_event', deliveryId};
  return {outcome: 'processed', deliveryId};
}

function invalidAuthorization(deliveryId: string): WebhookProcessingResult {
  return {outcome: 'discarded', reason: 'invalid_signature', deliveryId};
}

function jiraDeliveryId(request: StoredWebhookRequest, rawBody: Uint8Array): string {
  const connectionId = request.path_parameters.connection_id;
  const jiraIdentifier = request.headers['x-atlassian-webhook-identifier'];
  if (jiraIdentifier) return `${connectionId}:${jiraIdentifier}`;
  return createHash('sha256').update(connectionId).update('\0').update(rawBody).digest('hex');
}

async function recordDeliveryOnly(
  options: Pick<CreateJiraWebhookProcessorOptions, 'coreDb' | 'recordDeliveryOnly'>,
  deliveryId: string,
): Promise<void> {
  await options.coreDb().transaction(async (tx) => {
    await options.recordDeliveryOnly({tx, provider: JIRA_PROVIDER, deliveryId});
  });
}

async function discardUnavailableConnection(
  options: Pick<CreateJiraWebhookProcessorOptions, 'coreDb' | 'recordDeliveryOnly'>,
  deliveryId: string,
): Promise<WebhookProcessingResult> {
  await recordDeliveryOnly(options, deliveryId);
  return {outcome: 'discarded', reason: 'connection_unavailable', deliveryId};
}

function hasMatchingWebhookId(
  payload: JiraWebhookEnvelopeDto,
  storedWebhookIds: number[],
): boolean {
  return (
    payload.matchedWebhookIds?.some((webhookId) => storedWebhookIds.includes(webhookId)) === true
  );
}
