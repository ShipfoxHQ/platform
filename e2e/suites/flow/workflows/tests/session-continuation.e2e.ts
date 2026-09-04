import {message, startFakeOpenAiModelProvider} from '@shipfox/e2e-driver-model-provider';
import type {WorkflowRunObservation} from '@shipfox/e2e-observe-workflows';
import {
  createOpenAiCompatibleCustomProvider,
  deleteModelProviderConfig,
} from '@shipfox/e2e-setup-agent';
import {
  waitForListenerExecution,
  waitForListenerResolution,
  waitForListenerStatus,
} from '#listener-helpers.js';
import {
  cleanupListenerCase,
  fireManualRun,
  LISTENER_JOB,
  type ListenerCase,
  sendBatchAndAwaitMaterialization,
  sendResolve,
  sessionContinuationWorkflow,
  setupListenerCase,
  stopRunner,
} from '#listener-jobs.js';
import {waitForRunTerminalOrFailedRunner} from '#runner.js';
import {expect, test} from './fixtures.js';

const SESSION_MODEL_MAX_OUTPUT_TOKENS = 64;
const SESSION_FLOW_OBSERVATION_TIMEOUT_MS = 60_000;
const SESSION_RUN_TERMINAL_TIMEOUT_MS = 180_000;
const SESSION_TEST_TIMEOUT_MS = 600_000;

const SESSION_RESPONSES = [
  'PLAN_SESSION_SEGMENT',
  'IMPLEMENT_SESSION_SEGMENT',
  'LISTENER_BATCH_SEGMENT',
  'LISTENER_BATCH_SEGMENT_TWO',
] as const;

test('resumes one Pi session across jobs and listening event batches', async ({
  suite,
}, testInfo) => {
  test.setTimeout(SESSION_TEST_TIMEOUT_MS);
  const uniqueId = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  const fakeModelProvider = await startFakeOpenAiModelProvider({
    runId: `${suite.runId}-session-continuation-${uniqueId}`,
  });

  let providerId: string | undefined;
  let testCase: (ListenerCase & {definitionId: string}) | undefined;
  let runId: string | undefined;
  try {
    const script = await fakeModelProvider.createScript({
      id: `${suite.runId}-session-continuation-${uniqueId}`,
      model: `deterministic-session-${uniqueId}`,
      responses: [
        message('provider probe ok'),
        ...SESSION_RESPONSES.map((content) => message(content)),
      ],
      assertions: [
        {kind: 'model', equals: `deterministic-session-${uniqueId}`},
        {
          kind: 'message_content_includes',
          value: SESSION_RESPONSES[0],
          minRequestIndex: 2,
        },
        {
          kind: 'message_content_includes',
          value: SESSION_RESPONSES[1],
          minRequestIndex: 3,
        },
        {
          kind: 'message_content_includes',
          value: SESSION_RESPONSES[2],
          minRequestIndex: 4,
        },
      ],
    });
    const provider = await createOpenAiCompatibleCustomProvider({
      workspaceId: suite.workspaceId,
      sessionToken: suite.sessionToken,
      providerId: `fake-openai-session-${uniqueId}`,
      displayName: `Fake OpenAI Session ${uniqueId}`,
      baseUrl: script.modelProviderBaseUrl,
      model: script.model,
      modelMetadata: {max_output_tokens: SESSION_MODEL_MAX_OUTPUT_TOKENS},
    });
    providerId = provider.provider_id;

    testCase = await setupListenerCase({
      suite,
      testName: 'session-continuation',
      workflowYaml: sessionContinuationWorkflow({
        provider: provider.provider_id,
        model: script.model,
      }),
      attach: (attachment) =>
        testInfo.attach(attachment.name, {
          body: attachment.body,
          contentType: attachment.contentType,
        }),
    });
    runId = await fireManualRun(testCase);

    await waitForListenerStatus({
      token: testCase.token,
      runId,
      jobKey: LISTENER_JOB,
      listenerStatus: 'listening',
      timeoutMs: SESSION_FLOW_OBSERVATION_TIMEOUT_MS,
    });

    const firstBatch = await sendBatchAndAwaitMaterialization({
      testCase,
      runId,
      label: 'first-batch',
      sequence: 1,
      timeoutMs: SESSION_FLOW_OBSERVATION_TIMEOUT_MS,
      eventCount: 4,
      expectedEventCount: 2,
    });
    await waitForListenerExecution({
      token: testCase.token,
      runId,
      jobKey: LISTENER_JOB,
      sequence: 1,
      status: 'succeeded',
      timeoutMs: SESSION_FLOW_OBSERVATION_TIMEOUT_MS,
    });

    await waitForListenerExecution({
      token: testCase.token,
      runId,
      jobKey: LISTENER_JOB,
      sequence: 2,
      status: 'succeeded',
      timeoutMs: SESSION_FLOW_OBSERVATION_TIMEOUT_MS,
    });

    await sendResolve(testCase, 'resolve');
    const resolved = await waitForListenerResolution({
      token: testCase.token,
      runId,
      jobKey: LISTENER_JOB,
      status: 'succeeded',
      reason: 'until',
      timeoutMs: SESSION_FLOW_OBSERVATION_TIMEOUT_MS,
    });
    const terminal = await waitForRunTerminalOrFailedRunner({
      runId,
      token: testCase.token,
      timeoutMs: SESSION_RUN_TERMINAL_TIMEOUT_MS,
      runner: testCase.runner,
      selection: {
        jobs: [
          {jobKey: 'plan', includeDefaultExecution: true, stepKeys: ['draft']},
          {jobKey: 'implement', includeDefaultExecution: true, stepKeys: ['apply']},
          {
            jobKey: LISTENER_JOB,
            executionSequences: 'all',
            includeContext: true,
            stepKeys: ['continue'],
          },
        ],
      },
    });

    assertSessionRun({
      firstBatch,
      terminal,
      resolved,
    });

    const requests = await fakeModelProvider.getRequests(script.id);
    expect(requests).toHaveLength(5);
    expect(requests.map((request) => request.assertion_failures)).toEqual([[], [], [], [], []]);
    expect(requests.map((request) => request.message_roles.includes('assistant'))).toEqual([
      false,
      false,
      true,
      true,
      true,
    ]);
  } catch (error) {
    await cleanupListenerCase(testCase, runId);
    throw error;
  } finally {
    await stopRunner(testCase);
    if (providerId !== undefined) {
      await deleteModelProviderConfig({
        workspaceId: suite.workspaceId,
        sessionToken: suite.sessionToken,
        providerId,
      }).catch(() => undefined);
    }
    await fakeModelProvider.stop().catch((error: unknown) => {
      process.stderr.write(
        `session-continuation-e2e: stopFakeOpenAiModelProvider failed: ${String(error)}\n`,
      );
    });
  }
});

function assertSessionRun(params: {
  firstBatch: Awaited<ReturnType<typeof sendBatchAndAwaitMaterialization>>;
  terminal: WorkflowRunObservation;
  resolved: WorkflowRunObservation;
}): void {
  const plan = sessionStep(params.terminal, 'plan', 1, 'draft');
  const implement = sessionStep(params.terminal, 'implement', 1, 'apply');
  const firstListener = sessionStep(params.terminal, LISTENER_JOB, 1, 'continue');
  const secondListener = sessionStep(params.terminal, LISTENER_JOB, 2, 'continue');

  expect(params.terminal.status).toBe('succeeded');
  expect(params.terminal.jobs.find((job) => job.key === 'plan')?.status).toBe('succeeded');
  expect(params.terminal.jobs.find((job) => job.key === 'implement')?.status).toBe('succeeded');

  const listen = params.terminal.jobs.find((job) => job.key === LISTENER_JOB);
  expect(listen?.status).toBe('succeeded');
  expect(listen?.listener_status).toBe('resolved');
  expect(listen?.executions.map((execution) => execution.sequence)).toEqual([1, 2]);
  expect(listen?.executions.map((execution) => execution.status)).toEqual([
    'succeeded',
    'succeeded',
  ]);
  expect(params.firstBatch.deliveryIds).toHaveLength(4);
  expect(listen?.executions[0]?.trigger_events.map((event) => event.delivery_id)).toEqual(
    params.firstBatch.deliveryIds.slice(0, 2),
  );
  expect(listen?.executions[1]?.trigger_events.map((event) => event.delivery_id)).toEqual(
    params.firstBatch.deliveryIds.slice(2),
  );
  expect(params.resolved.jobs.find((job) => job.key === LISTENER_JOB)?.listener_status).toBe(
    'resolved',
  );

  expect(plan.response?.trim()).toBe(SESSION_RESPONSES[0]);
  expect(implement.response?.trim()).toBe(SESSION_RESPONSES[1]);
  expect(firstListener.response?.trim()).toBe(SESSION_RESPONSES[2]);
  expect(secondListener.response?.trim()).toBe(SESSION_RESPONSES[3]);

  const descriptors = [plan, implement, firstListener, secondListener].map((step) => {
    if (step.session === undefined || step.session === null) {
      throw new Error(`Step ${step.key ?? '<unnamed>'} did not record a session descriptor`);
    }
    return step.session;
  });
  expect(descriptors.map((descriptor) => descriptor.key)).toEqual(['main', 'main', 'main', 'main']);
  expect(descriptors.map((descriptor) => descriptor.mode)).toEqual([
    'resume',
    'resume',
    'resume',
    'resume',
  ]);
  expect(descriptors.map((descriptor) => descriptor.segment)).toEqual([0, 1, 2, 3]);
  expect(new Set(descriptors.map((descriptor) => descriptor.id)).size).toBe(1);
}

function sessionStep(
  run: WorkflowRunObservation,
  jobKey: string,
  sequence: number,
  stepKey: string,
) {
  const job = run.jobs.find((candidate) => candidate.key === jobKey);
  if (!job) throw new Error(`Job ${jobKey} missing from workflow observation`);
  const execution = job.executions.find((candidate) => candidate.sequence === sequence);
  if (!execution)
    throw new Error(`Job ${jobKey} execution ${sequence} missing from workflow observation`);
  const step = execution.steps.find((candidate) => candidate.key === stepKey);
  if (!step)
    throw new Error(`Step ${jobKey}.${sequence}.${stepKey} missing from workflow observation`);
  return step;
}
