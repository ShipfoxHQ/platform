import {Buffer} from 'node:buffer';
import {Webhooks} from '@octokit/webhooks';
import {
  decodeWebhookBody,
  type GetIntegrationConnectionByIdFn,
  type PublishIntegrationEventReceivedFn,
  type PublishSourcePushFn,
  type PublishSourceRepositoryUpdatedFn,
  type RecordDeliveryOnlyFn,
  type StoredWebhookRequest,
  type WebhookProcessingResult,
} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {config} from '#config.js';
import {handleGithubEvent} from '#core/webhook.js';

const DELIVERY_HEADER = 'x-github-delivery';
const EVENT_HEADER = 'x-github-event';
const SIGNATURE_HEADER = 'x-hub-signature-256';

export interface CreateGithubWebhookProcessorOptions {
  coreDb: () => NodePgDatabase<Record<string, unknown>>;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  publishSourceRepositoryUpdated: PublishSourceRepositoryUpdatedFn;
  publishSourcePush: PublishSourcePushFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  deleteInstallationTokenSecret?:
    | ((params: {workspaceId: string; installationId: number}) => Promise<unknown>)
    | undefined;
}

export interface GithubWebhookProcessor {
  process(request: StoredWebhookRequest): Promise<WebhookProcessingResult>;
}

export function createGithubWebhookProcessor(
  options: CreateGithubWebhookProcessorOptions,
): GithubWebhookProcessor {
  const webhooks = new Webhooks({secret: config.GITHUB_APP_WEBHOOK_SECRET});
  return {process: (request) => processGithubWebhookRequest(options, webhooks, request)};
}

async function processGithubWebhookRequest(
  options: CreateGithubWebhookProcessorOptions,
  webhooks: Webhooks,
  request: StoredWebhookRequest,
): Promise<WebhookProcessingResult> {
  if (request.route_id !== 'github') {
    throw new Error(`GitHub processor cannot process ${request.route_id} requests`);
  }

  const deliveryId = request.headers[DELIVERY_HEADER];
  const event = request.headers[EVENT_HEADER];
  const signature = request.headers[SIGNATURE_HEADER];
  if (!deliveryId || !event || !signature) {
    return {outcome: 'discarded', reason: 'missing_required_input'};
  }

  const rawBody = Buffer.from(decodeWebhookBody(request.body));
  let verified: boolean;
  try {
    verified = await webhooks.verify(rawBody.toString('utf8'), signature);
  } catch (error) {
    logger().warn({deliveryId, err: error}, 'github webhook signature verification threw');
    verified = false;
  }
  if (!verified) return {outcome: 'discarded', reason: 'invalid_signature', deliveryId};

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch (error) {
    logger().warn({deliveryId, err: error}, 'github webhook payload JSON parse failed');
    return {outcome: 'discarded', reason: 'malformed_payload', deliveryId};
  }

  const result = await options.coreDb().transaction(async (tx) =>
    handleGithubEvent({
      tx,
      deliveryId,
      event,
      payload,
      publishIntegrationEventReceived: options.publishIntegrationEventReceived,
      publishSourceRepositoryUpdated: options.publishSourceRepositoryUpdated,
      publishSourcePush: options.publishSourcePush,
      recordDeliveryOnly: options.recordDeliveryOnly,
      getIntegrationConnectionById: options.getIntegrationConnectionById,
    }),
  );

  if (result.installationTokenCleanup && options.deleteInstallationTokenSecret) {
    await options.deleteInstallationTokenSecret(result.installationTokenCleanup);
  }

  return result.outcome.startsWith('duplicate')
    ? {outcome: 'duplicate', deliveryId}
    : {outcome: 'processed', deliveryId};
}
