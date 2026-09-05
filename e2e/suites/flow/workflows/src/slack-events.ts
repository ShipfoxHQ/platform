import {createHmac, randomUUID} from 'node:crypto';
import {config} from '@shipfox/e2e-core';
import {waitForRunByDeliveryId} from '@shipfox/e2e-observe-workflows';

const RUN_LOOKUP_TIMEOUT_MS = 15_000;

export function signSlackHeaders(rawBody: string): Record<string, string> {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret)
    throw new Error('SLACK_SIGNING_SECRET must be configured for Slack event signing.');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac('sha256', signingSecret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest('hex');
  return {
    'x-slack-request-timestamp': timestamp,
    'x-slack-signature': `v0=${signature}`,
  };
}

export function buildAppMentionEnvelope(params: {
  teamId: string;
  channel: string;
  ts: string;
  user: string;
  text: string;
  eventId: string;
}) {
  return {
    type: 'event_callback' as const,
    team_id: params.teamId,
    api_app_id: 'A-e2e-slack',
    event: {
      type: 'app_mention' as const,
      channel: params.channel,
      ts: params.ts,
      user: params.user,
      text: params.text,
    },
    event_id: params.eventId,
    event_time: Math.floor(Date.now() / 1000),
  };
}

export async function triggerSlackAppMentionAndAwaitRun(params: {
  projectId: string;
  workspaceId: string;
  token: string;
  teamId: string;
  channel: string;
  ts: string;
  user: string;
  text: string;
}): Promise<{runId: string; eventId: string; channel: string; ts: string}> {
  const maxAttempts = 8;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const eventId = `Ev${randomUUID().replaceAll('-', '')}`;
    const envelope = buildAppMentionEnvelope({...params, eventId});
    const rawBody = JSON.stringify(envelope);
    await postSignedSlackEvent(rawBody);

    try {
      const run = await waitForRunByDeliveryId({
        projectId: params.projectId,
        deliveryId: eventId,
        token: params.token,
        timeoutMs: RUN_LOOKUP_TIMEOUT_MS,
        workspaceId: params.workspaceId,
      });
      return {runId: run.id, eventId, channel: params.channel, ts: params.ts};
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`No run appeared after ${maxAttempts} signed Slack app mentions.`);
}

async function postSignedSlackEvent(rawBody: string): Promise<void> {
  const response = await fetch(new URL('/webhooks/integrations/slack/events', config.API_URL), {
    method: 'POST',
    body: rawBody,
    headers: {
      ...signSlackHeaders(rawBody),
      'content-type': 'application/json',
    },
  });
  if (!response.ok) {
    throw new Error(`Signed Slack event delivery failed with ${response.status}.`);
  }
}
