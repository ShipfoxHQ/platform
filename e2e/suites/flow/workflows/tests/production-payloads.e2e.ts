import {
  WORKFLOW_DIAGNOSTIC_TRIGGER_EVENTS_MAX_BYTES,
  type WorkflowRunDetailResponseDto,
  type WorkflowRunJobExecutionDetailDto,
} from '@shipfox/api-workflows-dto';
import {createApiClient, PollTimeoutError, pollUntil} from '@shipfox/e2e-core';
import {
  findListenerExecutionBySequence,
  findListenerJob,
  waitForListenerExecution,
  waitForListenerResolution,
  waitForListenerStatus,
} from '#listener-helpers.js';
import {
  cleanupListenerCase,
  fireManualRun,
  LISTENER_JOB,
  type ListenerCase,
  sendProductionListenerEvent,
  sendResolve,
  setupListenerCase,
  stepLogText,
  stopRunner,
} from '#listener-jobs.js';
import {waitForRunDetailMatching} from '#polling.js';
import {
  assertSerializedUtf8ByteLength,
  buildProductionListenerEvent,
  buildProductionResolvedStepConfig,
  LISTENER_EXECUTION_EVENT_LIMIT_BYTES,
  LISTENER_FIRE_EVENT_LIMIT_BYTES,
  PRODUCTION_BATCH_EVENT_BYTES,
  PRODUCTION_NORMALIZED_TRIGGER_EVENTS_BYTES,
  PRODUCTION_RESOLVED_CONFIG_BYTES,
  productionPayloadListenerWorkflow,
  productionResolvedConfigWorkflow,
  serializedUtf8ByteLength,
} from '#production-payloads.js';
import {waitForRunTerminalOrFailedRunner} from '#runner.js';
import {waitForTriggerEvent} from '#webhook.js';
import {expect, test} from './fixtures.js';

const LISTENER_FLOW_OBSERVATION_TIMEOUT_MS = 60_000;
const LISTENER_RUN_TERMINAL_TIMEOUT_MS = 180_000;
const LISTENER_NEGATIVE_ASSERTION_TIMEOUT_MS = 2_000;

function attachTestArtifact(testInfo: {
  attach: (name: string, options: {body: string; contentType: string}) => Promise<void>;
}) {
  return async (attachment: {name: string; body: string; contentType: string}) => {
    await testInfo.attach(attachment.name, {
      body: attachment.body,
      contentType: attachment.contentType,
    });
  };
}

function listenerExecutions(
  runDetail: WorkflowRunDetailResponseDto,
): WorkflowRunJobExecutionDetailDto[] {
  const job = findListenerJob(runDetail, LISTENER_JOB);
  if (!job) throw new Error(`Listener job ${LISTENER_JOB} missing`);
  return job.job_executions;
}

function listenerExecution(
  runDetail: WorkflowRunDetailResponseDto,
  sequence: number,
): WorkflowRunJobExecutionDetailDto {
  const execution = findListenerExecutionBySequence({
    runDetail,
    jobKey: LISTENER_JOB,
    sequence,
  });
  if (!execution) throw new Error(`Listener execution ${sequence} missing`);
  return execution;
}

async function assertNoListenerExecutions(params: {
  token: string;
  runId: string;
  timeoutMs: number;
}): Promise<void> {
  const client = createApiClient({token: params.token});
  let diagnostic = 'no workflow run detail response observed';
  try {
    const unexpected = await pollUntil(
      {
        timeoutMs: params.timeoutMs,
        intervalMs: 250,
        maxIntervalMs: 250,
        describe: () => `no listener executions: ${diagnostic}`,
      },
      async () => {
        const runDetail = await client.requestJson<WorkflowRunDetailResponseDto>(
          'get',
          `/workflows/runs/${encodeURIComponent(params.runId)}`,
        );
        const executions = listenerExecutions(runDetail);
        diagnostic = `listener execution count=${executions.length}`;
        return executions.length === 0
          ? null
          : {sequences: executions.map((execution) => execution.sequence)};
      },
    );
    throw new Error(
      `Oversized fire unexpectedly created listener executions: ${unexpected.sequences.join(', ')}`,
    );
  } catch (error) {
    if (error instanceof PollTimeoutError) {
      return;
    }
    throw error;
  }
}

test.describe('production-shaped workflow payloads', () => {
  test('executes the exact 75,644-byte resolved step config through the runner', async ({
    suite,
  }, testInfo) => {
    let testCase: (ListenerCase & {definitionId: string}) | undefined;
    let runId: string | undefined;
    try {
      const expectedConfig = buildProductionResolvedStepConfig();
      testCase = await setupListenerCase({
        suite,
        testName: 'production-resolved-config',
        workflowYaml: productionResolvedConfigWorkflow(),
        attach: attachTestArtifact(testInfo),
      });
      runId = await fireManualRun(testCase);

      const terminal = await waitForRunTerminalOrFailedRunner({
        runId,
        token: testCase.token,
        timeoutMs: LISTENER_RUN_TERMINAL_TIMEOUT_MS,
        runner: testCase.runner,
      });
      const build = terminal.jobs.find((job) => job.key === 'build');
      const execution = build?.job_executions.at(-1);
      const step = execution?.steps.find((candidate) => candidate.key === 'sized-config');
      if (!step || !execution) throw new Error('Resolved config step did not execute');

      assertSerializedUtf8ByteLength(
        step.config,
        PRODUCTION_RESOLVED_CONFIG_BYTES,
        'resolved config in run detail',
      );
      expect(step.config).toEqual(expectedConfig);
      expect(step.status).toBe('succeeded');
      expect(terminal.status).toBe('succeeded');
      await expect(
        stepLogText({
          runDetail: terminal,
          token: testCase.token,
          jobKey: 'build',
          sequence: execution.sequence,
          stepKey: 'sized-config',
        }),
      ).resolves.toContain('resolved_config_bytes=');
    } catch (error) {
      await cleanupListenerCase(testCase, runId);
      throw error;
    } finally {
      await stopRunner(testCase);
    }
  });

  test('runs the exact 97,834-byte normalized trigger event', async ({suite}, testInfo) => {
    let testCase: (ListenerCase & {definitionId: string}) | undefined;
    let runId: string | undefined;
    try {
      testCase = await setupListenerCase({
        suite,
        testName: 'production-normalized-event',
        workflowYaml: productionPayloadListenerWorkflow({batchMaxSize: 1}),
        attach: attachTestArtifact(testInfo),
      });
      runId = await fireManualRun(testCase);
      await waitForListenerStatus({
        token: testCase.token,
        runId,
        jobKey: LISTENER_JOB,
        listenerStatus: 'listening',
        timeoutMs: LISTENER_FLOW_OBSERVATION_TIMEOUT_MS,
      });

      const deliveryId = `${testCase.uniqueId}-exact-event`;
      const fixture = buildProductionListenerEvent({
        source: testCase.fireConnection.slug,
        deliveryId,
        targetBytes: PRODUCTION_NORMALIZED_TRIGGER_EVENTS_BYTES,
      });
      await sendProductionListenerEvent({
        testCase,
        disposition: 'fire',
        deliveryId,
        payload: fixture.payload,
      });
      const materialized = await waitForListenerExecution({
        token: testCase.token,
        runId,
        jobKey: LISTENER_JOB,
        sequence: 1,
        status: 'succeeded',
        timeoutMs: LISTENER_RUN_TERMINAL_TIMEOUT_MS,
      });
      const execution = listenerExecution(materialized, 1);

      assertSerializedUtf8ByteLength(
        execution.trigger_events,
        PRODUCTION_NORMALIZED_TRIGGER_EVENTS_BYTES,
        'normalized trigger_events in execution',
      );
      expect(serializedUtf8ByteLength(execution.trigger_events)).toBe(
        PRODUCTION_NORMALIZED_TRIGGER_EVENTS_BYTES,
      );
      expect(PRODUCTION_NORMALIZED_TRIGGER_EVENTS_BYTES).toBeGreaterThan(
        WORKFLOW_DIAGNOSTIC_TRIGGER_EVENTS_MAX_BYTES,
      );
      expect(execution.trigger_events.map((event) => event.delivery_id)).toEqual([deliveryId]);

      await sendResolve(testCase, 'resolve-exact-event');
      const terminal = await waitForRunTerminalOrFailedRunner({
        runId,
        token: testCase.token,
        timeoutMs: LISTENER_RUN_TERMINAL_TIMEOUT_MS,
        runner: testCase.runner,
      });
      expect(terminal.status).toBe('succeeded');
      expect(findListenerJob(terminal, LISTENER_JOB)?.listener_status).toBe('resolved');
    } catch (error) {
      await cleanupListenerCase(testCase, runId);
      throw error;
    } finally {
      await stopRunner(testCase);
    }
  });

  test('partitions a batch above 1,000,000 bytes in order without losing deliveries', async ({
    suite,
  }, testInfo) => {
    let testCase: (ListenerCase & {definitionId: string}) | undefined;
    let runId: string | undefined;
    try {
      testCase = await setupListenerCase({
        suite,
        testName: 'production-byte-partition',
        workflowYaml: productionPayloadListenerWorkflow({batchMaxSize: 3}),
        attach: attachTestArtifact(testInfo),
      });
      runId = await fireManualRun(testCase);
      await waitForListenerStatus({
        token: testCase.token,
        runId,
        jobKey: LISTENER_JOB,
        listenerStatus: 'listening',
        timeoutMs: LISTENER_FLOW_OBSERVATION_TIMEOUT_MS,
      });

      const listenerCase = testCase;
      if (!listenerCase) throw new Error('Listener case was not started');
      const deliveryIds = ['a', 'b', 'c'].map(
        (suffix) => `${listenerCase.uniqueId}-partition-${suffix}`,
      );
      const fixtures = deliveryIds.map((deliveryId) =>
        buildProductionListenerEvent({
          source: listenerCase.fireConnection.slug,
          deliveryId,
          targetBytes: PRODUCTION_BATCH_EVENT_BYTES,
        }),
      );
      const expectedEvents = fixtures.map((fixture) => fixture.expectedEvent);
      const expectedFirstPartition = expectedEvents.slice(0, 2);
      expect(serializedUtf8ByteLength(expectedEvents)).toBeGreaterThan(
        LISTENER_EXECUTION_EVENT_LIMIT_BYTES,
      );
      expect(serializedUtf8ByteLength(expectedFirstPartition)).toBeLessThanOrEqual(
        LISTENER_EXECUTION_EVENT_LIMIT_BYTES,
      );

      for (const [index, fixture] of fixtures.entries()) {
        const deliveryId = deliveryIds[index];
        if (!deliveryId) throw new Error(`Missing batch delivery at index ${index}`);
        await sendProductionListenerEvent({
          testCase: listenerCase,
          disposition: 'fire',
          deliveryId,
          payload: fixture.payload,
        });
      }

      const materialized = await waitForRunDetailMatching({
        token: testCase.token,
        runId,
        timeoutMs: LISTENER_RUN_TERMINAL_TIMEOUT_MS,
        description: 'all byte-sized listener deliveries',
        matches: (runDetail) => {
          const job = findListenerJob(runDetail, LISTENER_JOB);
          if (!job) {
            return {matched: false, diagnostic: `listener job ${LISTENER_JOB} missing`};
          }
          const observed = job.job_executions.flatMap((execution) =>
            execution.trigger_events.map((event) => event.delivery_id),
          );
          const orderMatches = observed.every(
            (deliveryId, index) => deliveryId === deliveryIds[index],
          );
          const statusMatches = job.job_executions.every(
            (execution) => execution.status === 'succeeded',
          );
          return {
            matched: observed.length === deliveryIds.length && orderMatches && statusMatches,
            diagnostic: `listener deliveries observed=[${observed.join(', ')}], expected=[${deliveryIds.join(', ')}], statuses=[${job.job_executions.map((execution) => execution.status).join(', ')}]`,
          };
        },
      });
      const executions = listenerExecutions(materialized);
      const observedDeliveryIds = executions.flatMap((execution) =>
        execution.trigger_events.map((event) => event.delivery_id),
      );

      expect(executions.length).toBeGreaterThanOrEqual(2);
      expect(observedDeliveryIds).toEqual(deliveryIds);
      expect(new Set(observedDeliveryIds).size).toBe(deliveryIds.length);
      for (const execution of executions) {
        expect(serializedUtf8ByteLength(execution.trigger_events)).toBeLessThanOrEqual(
          LISTENER_EXECUTION_EVENT_LIMIT_BYTES,
        );
      }

      await sendResolve(testCase, 'resolve-byte-partition');
      const terminal = await waitForRunTerminalOrFailedRunner({
        runId,
        token: testCase.token,
        timeoutMs: LISTENER_RUN_TERMINAL_TIMEOUT_MS,
        runner: testCase.runner,
      });
      expect(terminal.status).toBe('succeeded');
      expect(listenerExecutions(terminal).map((execution) => execution.sequence)).toEqual(
        executions.map((execution) => execution.sequence),
      );
    } catch (error) {
      await cleanupListenerCase(testCase, runId);
      throw error;
    } finally {
      await stopRunner(testCase);
    }
  });

  test('rejects an oversized fire delivery without creating a listener execution', async ({
    suite,
  }, testInfo) => {
    let testCase: (ListenerCase & {definitionId: string}) | undefined;
    let runId: string | undefined;
    try {
      testCase = await setupListenerCase({
        suite,
        testName: 'production-oversized-fire',
        workflowYaml: productionPayloadListenerWorkflow(),
        attach: attachTestArtifact(testInfo),
      });
      runId = await fireManualRun(testCase);
      await waitForListenerStatus({
        token: testCase.token,
        runId,
        jobKey: LISTENER_JOB,
        listenerStatus: 'listening',
        timeoutMs: LISTENER_FLOW_OBSERVATION_TIMEOUT_MS,
      });

      const deliveryId = `${testCase.uniqueId}-oversized-fire`;
      const fixture = buildProductionListenerEvent({
        source: testCase.fireConnection.slug,
        deliveryId,
        targetBytes: LISTENER_FIRE_EVENT_LIMIT_BYTES + 1,
      });
      await sendProductionListenerEvent({
        testCase,
        disposition: 'fire',
        deliveryId,
        payload: fixture.payload,
      });
      const detail = await waitForTriggerEvent({
        token: testCase.token,
        workspaceId: testCase.workspaceId,
        source: testCase.fireConnection.slug,
        event: 'received',
        outcome: 'errored',
        deliveryId,
        timeoutMs: LISTENER_FLOW_OBSERVATION_TIMEOUT_MS,
      });

      expect(detail.outcome).toBe('errored');
      expect(detail.decisions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            subscription_kind: 'listener',
            decision: 'rejected',
            diagnostic: expect.objectContaining({
              code: 'listener-event-payload-too-large',
              limit_bytes: LISTENER_FIRE_EVENT_LIMIT_BYTES,
            }),
          }),
        ]),
      );
      await assertNoListenerExecutions({
        token: testCase.token,
        runId,
        timeoutMs: LISTENER_NEGATIVE_ASSERTION_TIMEOUT_MS,
      });

      const recoveryDeliveryId = `${testCase.uniqueId}-oversized-fire-recovery`;
      const recoveryFixture = buildProductionListenerEvent({
        source: testCase.fireConnection.slug,
        deliveryId: recoveryDeliveryId,
        targetBytes: PRODUCTION_BATCH_EVENT_BYTES,
      });
      await sendProductionListenerEvent({
        testCase,
        disposition: 'fire',
        deliveryId: recoveryDeliveryId,
        payload: recoveryFixture.payload,
      });
      const recovered = await waitForListenerExecution({
        token: testCase.token,
        runId,
        jobKey: LISTENER_JOB,
        sequence: 1,
        status: 'succeeded',
        timeoutMs: LISTENER_RUN_TERMINAL_TIMEOUT_MS,
      });
      expect(
        listenerExecution(recovered, 1).trigger_events.map((event) => event.delivery_id),
      ).toEqual([recoveryDeliveryId]);
    } catch (error) {
      await cleanupListenerCase(testCase, runId);
      throw error;
    } finally {
      await stopRunner(testCase);
    }
  });

  test('resolves an equivalently large until delivery without entering execution context', async ({
    suite,
  }, testInfo) => {
    let testCase: (ListenerCase & {definitionId: string}) | undefined;
    let runId: string | undefined;
    try {
      testCase = await setupListenerCase({
        suite,
        testName: 'production-oversized-until',
        workflowYaml: productionPayloadListenerWorkflow(),
        attach: attachTestArtifact(testInfo),
      });
      runId = await fireManualRun(testCase);
      await waitForListenerStatus({
        token: testCase.token,
        runId,
        jobKey: LISTENER_JOB,
        listenerStatus: 'listening',
        timeoutMs: LISTENER_FLOW_OBSERVATION_TIMEOUT_MS,
      });

      const deliveryId = `${testCase.uniqueId}-oversized-until`;
      const fixture = buildProductionListenerEvent({
        source: testCase.resolveConnection.slug,
        deliveryId,
        targetBytes: LISTENER_FIRE_EVENT_LIMIT_BYTES + 1,
      });
      await sendProductionListenerEvent({
        testCase,
        disposition: 'resolve',
        deliveryId,
        payload: fixture.payload,
      });
      const detail = await waitForTriggerEvent({
        token: testCase.token,
        workspaceId: testCase.workspaceId,
        source: testCase.resolveConnection.slug,
        event: 'received',
        outcome: 'routed',
        deliveryId,
        timeoutMs: LISTENER_FLOW_OBSERVATION_TIMEOUT_MS,
      });
      const resolved = await waitForListenerResolution({
        token: testCase.token,
        runId,
        jobKey: LISTENER_JOB,
        status: 'succeeded',
        reason: 'until',
        timeoutMs: LISTENER_FLOW_OBSERVATION_TIMEOUT_MS,
      });
      const terminal = await waitForRunTerminalOrFailedRunner({
        runId,
        token: testCase.token,
        timeoutMs: LISTENER_RUN_TERMINAL_TIMEOUT_MS,
        runner: testCase.runner,
      });

      expect(detail.decisions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            subscription_kind: 'listener',
            decision: 'triggered',
          }),
        ]),
      );
      expect(resolved.jobs.find((job) => job.key === LISTENER_JOB)?.resolution_reason).toBe(
        'until',
      );
      expect(terminal.status).toBe('succeeded');
      expect(listenerExecutions(terminal)).toHaveLength(0);
      expect(
        listenerExecutions(terminal).flatMap((execution) => execution.trigger_events),
      ).toHaveLength(0);
    } catch (error) {
      await cleanupListenerCase(testCase, runId);
      throw error;
    } finally {
      await stopRunner(testCase);
    }
  });
});
