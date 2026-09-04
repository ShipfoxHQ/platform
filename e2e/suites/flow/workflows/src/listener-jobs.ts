import {createApiClient} from '@shipfox/e2e-core';
import {type LocalRunnerHandle, stopLocalRunner} from '@shipfox/e2e-driver-runner-process';
import {fetchStepLogs} from '@shipfox/e2e-observe-logs';
import type {WorkflowRunObservation} from '@shipfox/e2e-observe-workflows';
import {observeRun} from '@shipfox/e2e-observe-workflows';
import {
  type AttachFn,
  attachLocalRunnerLog,
  collectStepLogAttachmentRequests,
  fetchLogAttachment,
} from './attachments.js';
import {logText} from './expect.js';
import {
  batchedListenerExecutionMatches,
  sendWebhookDeliveryUntilObserved,
} from './listener-helpers.js';
import {waitForRunObservationMatching} from './polling.js';
import {startSuiteLocalRunner} from './runner.js';
import type {SuiteContext} from './suite-context.js';
import {fireManualAndAwaitRun} from './triggers.js';
import {
  attachWebhookTriggerDiagnostics,
  createWebhookConnection,
  postWebhookDelivery,
  type WebhookDiagnosticsRequest,
} from './webhook.js';
import {seedProjectWithApiDefinition} from './workflow-project.js';

export const LISTENER_JOB = 'listen';
const FIRE_SOURCE_PLACEHOLDER = '__FIRE_WEBHOOK_SOURCE__';
const RESOLVE_SOURCE_PLACEHOLDER = '__RESOLVE_WEBHOOK_SOURCE__';

export interface ListenerCase {
  attach: AttachFn;
  client: ReturnType<typeof createApiClient>;
  fireConnection: Awaited<ReturnType<typeof createWebhookConnection>>;
  fireDiagnostics: WebhookDiagnosticsRequest;
  resolveConnection: Awaited<ReturnType<typeof createWebhookConnection>>;
  resolveDiagnostics: WebhookDiagnosticsRequest;
  repo: string;
  runner: LocalRunnerHandle;
  runnerLogFile: string;
  runnerLabel: string;
  token: string;
  uniqueId: string;
  workspaceId: string;
}

async function attachRunObservation(params: {
  attach: AttachFn;
  runId: string | undefined;
  token: string;
}): Promise<void> {
  if (params.runId === undefined) return;
  try {
    const observation = await observeRun({
      runId: params.runId,
      selection: {
        jobs: [{jobKey: LISTENER_JOB, executionSequences: 'all', includeContext: true}],
      },
      token: params.token,
    });
    await params.attach({
      name: 'workflow-observation.json',
      contentType: 'application/json',
      body: JSON.stringify(observation, null, 2),
    });
    for (const request of collectStepLogAttachmentRequests(observation)) {
      await params.attach(await fetchLogAttachment(request, params.token));
    }
  } catch (error) {
    await params.attach({
      name: 'workflow-observation.error.txt',
      contentType: 'text/plain',
      body: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function setupListenerCase(params: {
  suite: SuiteContext;
  testName: string;
  workflowYaml: string;
  attach: AttachFn;
}): Promise<ListenerCase & {definitionId: string}> {
  const token = params.suite.sessionToken;
  const client = createApiClient({token});
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const runnerLabel = `e2e-listener-${params.testName}-${uniqueId}`;
  const repo = `listener-${params.testName}-${uniqueId}`;
  const fireSlug = `listener-fire-${params.testName}-${uniqueId}`;
  const resolveSlug = `listener-resolve-${params.testName}-${uniqueId}`;

  const [fireConnection, resolveConnection] = await Promise.all([
    createWebhookConnection({
      client,
      scenario: params.testName,
      slug: fireSlug,
      uniqueId,
      workspaceId: params.suite.workspaceId,
    }),
    createWebhookConnection({
      client,
      scenario: params.testName,
      slug: resolveSlug,
      uniqueId,
      workspaceId: params.suite.workspaceId,
    }),
  ]);

  const {definition} = await seedProjectWithApiDefinition({
    suite: params.suite,
    token,
    name: params.testName,
    repo,
    runnerLabel,
    workflowYaml: params.workflowYaml,
    configPath: `.shipfox/workflows/${params.testName}.yml`,
    replacements: {
      [FIRE_SOURCE_PLACEHOLDER]: fireSlug,
      [RESOLVE_SOURCE_PLACEHOLDER]: resolveSlug,
    },
  });

  const localRunner = await startSuiteLocalRunner({
    workspaceId: params.suite.workspaceId,
    userToken: token,
    name: `E2E listener ${params.testName} ${uniqueId}`,
    runnerLabel,
  });

  return {
    attach: params.attach,
    client,
    definitionId: definition.id,
    fireConnection,
    fireDiagnostics: {deliveryIds: [], source: fireSlug},
    repo,
    resolveConnection,
    resolveDiagnostics: {deliveryIds: [], source: resolveSlug},
    runner: localRunner.runner,
    runnerLabel,
    runnerLogFile: localRunner.logFile,
    token,
    uniqueId,
    workspaceId: params.suite.workspaceId,
  };
}

export async function cleanupListenerCase(
  testCase: ListenerCase | undefined,
  runId: string | undefined,
): Promise<void> {
  if (testCase === undefined) return;
  await attachRunObservation({attach: testCase.attach, runId, token: testCase.token});
  await attachWebhookTriggerDiagnostics({
    attach: testCase.attach,
    client: testCase.client,
    deliveryIds: testCase.fireDiagnostics.deliveryIds,
    source: testCase.fireDiagnostics.source,
    workspaceId: testCase.workspaceId,
  }).catch(() => undefined);
  await attachWebhookTriggerDiagnostics({
    attach: testCase.attach,
    client: testCase.client,
    deliveryIds: testCase.resolveDiagnostics.deliveryIds,
    source: testCase.resolveDiagnostics.source,
    workspaceId: testCase.workspaceId,
  }).catch(() => undefined);
  await attachLocalRunnerLog(testCase.attach, testCase.runnerLogFile);
}

export async function stopRunner(testCase: ListenerCase | undefined): Promise<void> {
  if (testCase === undefined) return;
  await stopLocalRunner(testCase.runner).catch((error: unknown) => {
    process.stderr.write(`listener-jobs-e2e: stopLocalRunner failed: ${String(error)}\n`);
  });
}

export async function fireManualRun(testCase: ListenerCase & {definitionId: string}) {
  return await fireManualAndAwaitRun({
    client: testCase.client,
    definitionId: testCase.definitionId,
    inputs: {},
    scenario: testCase.repo,
  });
}

export async function sendFire(
  testCase: ListenerCase,
  runId: string,
  label: string,
  message: string,
) {
  const result = await sendWebhookDeliveryUntilObserved({
    client: testCase.client,
    connection: testCase.fireConnection,
    runId,
    token: testCase.token,
    jobKey: LISTENER_JOB,
    deliveryIdPrefix: `${testCase.uniqueId}-${label}`,
    attemptTimeoutMs: 15_000,
    body: (_attempt, deliveryId) => ({message, delivery_id: deliveryId}),
  });
  testCase.fireDiagnostics.deliveryIds.push(...result.deliveryIds);
  return result;
}

export async function sendResolve(testCase: ListenerCase, label: string): Promise<string> {
  const deliveryId = `${testCase.uniqueId}-${label}`;
  testCase.resolveDiagnostics.deliveryIds.push(deliveryId);
  await postWebhookDelivery({
    client: testCase.client,
    connection: testCase.resolveConnection,
    deliveryId,
    webhook: {body: {message: 'resolve', delivery_id: deliveryId}},
  });
  return deliveryId;
}

export async function stepLogText(params: {
  observation: WorkflowRunObservation;
  token: string;
  jobKey: string;
  sequence: number;
  stepKey: string;
}): Promise<string> {
  const execution = params.observation.jobs
    .find((job) => job.key === params.jobKey)
    ?.executions.find((candidate) => candidate.sequence === params.sequence);
  const step = execution?.steps.find((candidate) => candidate.key === params.stepKey);
  if (!step) throw new Error(`Step ${params.jobKey}.${params.sequence}.${params.stepKey} missing`);
  const logs = await fetchStepLogs({
    stepId: step.id,
    attempt: step.current_attempt,
    token: params.token,
  });
  return logText(logs.records);
}

export async function sendBatchAndAwaitMaterialization(params: {
  testCase: ListenerCase;
  runId: string;
  label: string;
  sequence: number;
  timeoutMs: number;
  eventCount?: number | undefined;
  expectedEventCount?: number | undefined;
}): Promise<{deliveryIds: string[]; observation: WorkflowRunObservation}> {
  const eventCount = params.eventCount ?? 2;
  const expectedEventCount = params.expectedEventCount ?? eventCount;
  if (
    !Number.isInteger(eventCount) ||
    eventCount < 1 ||
    !Number.isInteger(expectedEventCount) ||
    expectedEventCount < 1 ||
    expectedEventCount > eventCount
  ) {
    throw new Error(
      `Invalid listener batch counts: eventCount=${eventCount}, expectedEventCount=${expectedEventCount}`,
    );
  }

  const deliveryIds = [
    ...Array.from({length: eventCount}, (_, index) => {
      const suffix = String.fromCharCode('a'.charCodeAt(0) + index);
      return `${params.testCase.uniqueId}-${params.label}-${suffix}`;
    }),
  ];
  for (const deliveryId of deliveryIds) {
    params.testCase.fireDiagnostics.deliveryIds.push(deliveryId);
    await postWebhookDelivery({
      client: params.testCase.client,
      connection: params.testCase.fireConnection,
      deliveryId,
      webhook: {body: {message: deliveryId, delivery_id: deliveryId}},
    });
  }

  const observation = await waitForRunObservationMatching({
    token: params.testCase.token,
    runId: params.runId,
    timeoutMs: params.timeoutMs,
    description: `batched listener deliveries ${deliveryIds.join(', ')}`,
    selection: {
      jobs: [
        {
          jobKey: LISTENER_JOB,
          executionSequences: [params.sequence],
          includeContext: true,
        },
      ],
    },
    matches: (candidate) =>
      batchedListenerExecutionMatches({
        observation: candidate,
        jobKey: LISTENER_JOB,
        sequence: params.sequence,
        deliveryIds: deliveryIds.slice(0, expectedEventCount),
      }),
  });
  return {deliveryIds, observation};
}

export async function sendBatchPairAndAwaitMaterialization(params: {
  testCase: ListenerCase;
  runId: string;
  label: string;
  sequence: number;
  timeoutMs: number;
}): Promise<{deliveryIds: string[]; observation: WorkflowRunObservation}> {
  return await sendBatchAndAwaitMaterialization({...params, eventCount: 2});
}

export const listenerWorkflows = {
  untilResolution: `
name: Listener until
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  listen:
    listening:
      on:
        - source: __FIRE_WEBHOOK_SOURCE__
          event: received
      until:
        - source: __RESOLVE_WEBHOOK_SOURCE__
          event: received
    steps:
      - key: show_event
        env:
          MESSAGE: '\${{ execution.events[0].data.body.message }}'
          DELIVERY_ID: '\${{ execution.events[0].delivery_id }}'
        run: |
          echo "listener_message=$MESSAGE"
          echo "listener_delivery=$DELIVERY_ID"
          echo "message=$MESSAGE" >> "$SHIPFOX_OUTPUT"
    outputs:
      message: '\${{ steps.show_event.outputs.message }}'
  deploy:
    needs: listen
    steps:
      - key: after-listener
        env:
          LAST_MESSAGE: '\${{ jobs.listen.outputs.message }}'
          MESSAGE_COUNT: '\${{ jobs.listen.executions.map(e, e.outputs.message).size() }}'
        run: |
          echo "deploy_after_listener"
          echo "listener_last=$LAST_MESSAGE"
          echo "listener_count=$MESSAGE_COUNT"
`,
  maxExecutions: `
name: Listener max executions
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  listen:
    listening:
      on:
        - source: __FIRE_WEBHOOK_SOURCE__
          event: received
      max_executions: 2
    steps:
      - key: show-event
        env:
          MESSAGE: '\${{ execution.events[0].data.body.message }}'
        run: echo "listener_message=$MESSAGE"
`,
  batch: `
name: Listener batch
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  listen:
    listening:
      on:
        - source: __FIRE_WEBHOOK_SOURCE__
          event: received
      until:
        - source: __RESOLVE_WEBHOOK_SOURCE__
          event: received
      batch:
        max_size: 2
    steps:
      - key: show-batch
        env:
          FIRST_DELIVERY: '\${{ execution.events[0].delivery_id }}'
          SECOND_DELIVERY: '\${{ execution.events[1].delivery_id }}'
        run: |
          echo "batch_first=$FIRST_DELIVERY"
          echo "batch_second=$SECOND_DELIVERY"
`,
  cancelOnResolve: `
name: Listener cancel
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  listen:
    listening:
      on:
        - source: __FIRE_WEBHOOK_SOURCE__
          event: received
      until:
        - source: __RESOLVE_WEBHOOK_SOURCE__
          event: received
      on_resolve: cancel
    steps:
      - key: slow
        run: |
          echo "listener_started"
          sleep 120
          echo "listener_done"
`,
};

export function sessionContinuationWorkflow(params: {provider: string; model: string}): string {
  return `
name: Session continuation
runner: __RUNNER_LABEL__
triggers:
  manual:
    source: manual
    event: fire
jobs:
  plan:
    steps:
      - key: draft
        harness: pi
        provider: ${params.provider}
        model: ${params.model}
        thinking: off
        session: main
        prompt: |
          Prepare the plan and reply with exactly: PLAN_SESSION_SEGMENT
  implement:
    needs: plan
    steps:
      - key: apply
        harness: pi
        provider: ${params.provider}
        model: ${params.model}
        thinking: off
        session: main
        prompt: |
          Implement the plan and reply with exactly: IMPLEMENT_SESSION_SEGMENT
  listen:
    needs: implement
    listening:
      on:
        - source: __FIRE_WEBHOOK_SOURCE__
          event: received
      until:
        - source: __RESOLVE_WEBHOOK_SOURCE__
          event: received
      batch:
        max_size: 2
    steps:
      - key: continue
        harness: pi
        provider: ${params.provider}
        model: ${params.model}
        thinking: off
        session: main
        prompt: |
          Process this event batch and reply with the next session marker.
`;
}
