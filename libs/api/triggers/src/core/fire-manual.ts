import {randomUUID} from 'node:crypto';
import {getTriggerSubscriptionById} from '#db/subscriptions.js';
import {
  eventOutcomeCount,
  eventReceivedCount,
  subscriptionTriggeredCount,
} from '#metrics/instance.js';
import {readConfigInputs} from './config.js';
import {
  TriggerSubscriptionNotFoundError,
  TriggerSubscriptionNotManualError,
  TriggerWorkspaceMismatchError,
} from './errors.js';
import {beginTriggerHistory, toReason} from './record-trigger-history.js';
import {isPermanentStartRunError, type WorkflowsModuleClient} from './workflows-client.js';

export interface FireManualSubscriptionParams {
  workflows: WorkflowsModuleClient;
  subscriptionId: string;
  callerWorkspaceId: string;
  userId: string;
  inputs?: Record<string, unknown> | undefined;
}

export async function fireManualSubscription(
  params: FireManualSubscriptionParams,
): Promise<{id: string; name: string}> {
  const subscription = await getTriggerSubscriptionById(params.subscriptionId);
  if (!subscription) throw new TriggerSubscriptionNotFoundError(params.subscriptionId);
  if (subscription.source !== 'manual') {
    throw new TriggerSubscriptionNotManualError(params.subscriptionId, subscription.source);
  }
  // Defence in depth: unreachable from the HTTP route, but required for any direct caller.
  if (subscription.workspaceId !== params.callerWorkspaceId) {
    throw new TriggerWorkspaceMismatchError(
      params.subscriptionId,
      subscription.workspaceId,
      params.callerWorkspaceId,
    );
  }

  // Manual fires have no upstream event id. Use the run id after success; failed
  // attempts need a synthesized ref because there is no run to key on.
  const historyBase = {
    origin: 'manual' as const,
    workspaceId: subscription.workspaceId,
    provider: null,
    source: subscription.source,
    // Manual triggers have no inbound event. Keep the canonical history event
    // for a row that bypassed the projection write-path validation.
    event: subscription.event ?? 'fire',
    replayOfEventId: null,
    deliveryId: null,
    connectionId: null,
    connectionName: null,
    payload: null,
    receivedAt: new Date(),
  };

  eventReceivedCount.add(1, {provider: 'manual'});

  const inputs = params.inputs ?? readConfigInputs(subscription);
  let run: {id: string; name: string};
  try {
    run = await params.workflows.startRunFromTrigger({
      workspaceId: subscription.workspaceId,
      projectId: subscription.projectId,
      definitionId: subscription.workflowDefinitionId,
      triggerPayload: {
        provider: 'manual',
        source: 'manual',
        event: 'fire',
        subscriptionId: subscription.id,
        userId: params.userId,
      },
      ...(inputs === undefined ? {} : {inputs}),
      idempotencyKey: randomUUID(),
    });
  } catch (error) {
    const failure = await beginTriggerHistory({...historyBase, eventRef: randomUUID()});
    await failure.dispatchErrored(subscription, toReason(error));
    if (isPermanentStartRunError(error)) {
      eventOutcomeCount.add(1, {provider: 'manual', outcome: 'errored'});
      await failure.allErrored(1);
    } else {
      eventOutcomeCount.add(1, {provider: 'manual', outcome: 'failed'});
      await failure.failed(1);
    }
    throw error;
  }

  const history = await beginTriggerHistory({...historyBase, eventRef: run.id});
  await history.triggered(subscription, run);
  subscriptionTriggeredCount.add(1, {provider: 'manual'});
  eventOutcomeCount.add(1, {provider: 'manual', outcome: 'routed'});
  await history.routed(1);
  return run;
}
