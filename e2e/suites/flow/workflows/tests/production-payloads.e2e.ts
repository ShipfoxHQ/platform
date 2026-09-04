import {WORKFLOW_DIAGNOSTIC_TRIGGER_EVENTS_MAX_BYTES} from '@shipfox/api-workflows-dto';
import {PollTimeoutError, pollUntil} from '@shipfox/e2e-core';
import {
  observeRun,
  type WorkflowExecutionObservation,
  type WorkflowRunObservation,
} from '@shipfox/e2e-observe-workflows';
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
import {waitForRunObservationMatching} from '#polling.js';
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
const PRODUCTION_DELIVERY_IDS_LOG_PREFIX = 'production_delivery_ids=';

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

function listenerExecutions(observation: WorkflowRunObservation): WorkflowExecutionObservation[] {
  const job = findListenerJob(observation, LISTENER_JOB);
  if (!job) throw new Error(`Listener job ${LISTENER_JOB} missing`);
  return job.executions;
}

function listenerExecution(
  observation: WorkflowRunObservation,
  sequence: number,
): WorkflowExecutionObservation {
  const execution = findListenerExecutionBySequence({
    observation,
    jobKey: LISTENER_JOB,
    sequence,
  });
  if (!execution) throw new Error(`Listener execution ${sequence} missing`);
  return execution;
}

function oversizedTriggerEventBytes(execution: WorkflowExecutionObservation): number | null {
  const field = execution.context?.oversized_fields.find(
    (candidate) => candidate.field === 'trigger_events',
  );
  return field?.stored_bytes ?? null;
}

function assertOversizedTriggerEvents(
  execution: WorkflowExecutionObservation,
  minimumBytes: number,
): void {
  expect(execution.trigger_events).toEqual([]);
  expect(execution.context?.oversized_fields).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        field: 'trigger_events',
        reason: 'legacy_value_exceeds_inline_limit',
      }),
    ]),
  );
  const storedBytes = oversizedTriggerEventBytes(execution);
  if (storedBytes === null) throw new Error('Oversized trigger event byte count missing');
  expect(storedBytes).toBeGreaterThanOrEqual(minimumBytes);
}

async function assertNoListenerExecutions(params: {
  token: string;
  runId: string;
  timeoutMs: number;
}): Promise<void> {
  let diagnostic = 'no bounded workflow observation observed';
  let observedSuccessfully = false;
  try {
    const unexpected = await pollUntil(
      {
        timeoutMs: params.timeoutMs,
        intervalMs: 250,
        maxIntervalMs: 250,
        describe: () => `no listener executions: ${diagnostic}`,
      },
      async () => {
        const observation = await observeRun({
          runId: params.runId,
          selection: {jobs: [{jobKey: LISTENER_JOB, executionSequences: 'all'}]},
          token: params.token,
        });
        const executions = listenerExecutions(observation);
        observedSuccessfully = true;
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
    if (error instanceof PollTimeoutError && observedSuccessfully) {
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
        selection: {
          jobs: [{jobKey: 'build', includeDefaultExecution: true, stepKeys: ['sized-config']}],
        },
      });
      const build = terminal.jobs.find((job) => job.key === 'build');
      const execution = build?.executions.at(-1);
      const step = execution?.steps.find((candidate) => candidate.key === 'sized-config');
      const attempt = step?.attempt_details.find(
        (candidate) => candidate.attempt === step.current_attempt,
      );
      if (!step || !execution || !attempt) {
        throw new Error('Resolved config step did not execute');
      }

      assertSerializedUtf8ByteLength(
        attempt.config,
        PRODUCTION_RESOLVED_CONFIG_BYTES,
        'resolved config in workflow step attempt detail',
      );
      expect(attempt.config).toEqual(expectedConfig);
      expect(step.status).toBe('succeeded');
      expect(terminal.status).toBe('succeeded');
      await expect(
        stepLogText({
          observation: terminal,
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
      const routed = await waitForTriggerEvent({
        token: testCase.token,
        workspaceId: testCase.workspaceId,
        source: testCase.fireConnection.slug,
        event: 'received',
        outcome: 'routed',
        deliveryId,
        timeoutMs: LISTENER_FLOW_OBSERVATION_TIMEOUT_MS,
      });
      expect(routed.payload).toEqual(fixture.payload);
      const materialized = await waitForListenerExecution({
        token: testCase.token,
        runId,
        jobKey: LISTENER_JOB,
        sequence: 1,
        status: 'succeeded',
        includeContext: true,
        timeoutMs: LISTENER_RUN_TERMINAL_TIMEOUT_MS,
      });
      const execution = listenerExecution(materialized, 1);

      assertOversizedTriggerEvents(execution, PRODUCTION_NORMALIZED_TRIGGER_EVENTS_BYTES);
      expect(PRODUCTION_NORMALIZED_TRIGGER_EVENTS_BYTES).toBeGreaterThan(
        WORKFLOW_DIAGNOSTIC_TRIGGER_EVENTS_MAX_BYTES,
      );

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
        const routed = await waitForTriggerEvent({
          token: listenerCase.token,
          workspaceId: listenerCase.workspaceId,
          source: listenerCase.fireConnection.slug,
          event: 'received',
          outcome: 'routed',
          deliveryId,
          timeoutMs: LISTENER_FLOW_OBSERVATION_TIMEOUT_MS,
        });
        expect(routed.payload).toEqual(fixture.payload);
      }

      const expectedDiagnosticBytes = fixtures.reduce(
        (total, fixture) => total + fixture.serializedBytes,
        0,
      );
      const materialized = await waitForRunObservationMatching({
        token: testCase.token,
        runId,
        timeoutMs: LISTENER_RUN_TERMINAL_TIMEOUT_MS,
        description: 'all byte-sized listener deliveries',
        selection: {
          jobs: [
            {
              jobKey: LISTENER_JOB,
              executionSequences: 'all',
              includeContext: true,
              stepKeys: ['acknowledge'],
            },
          ],
        },
        matches: (observation) => {
          const job = findListenerJob(observation, LISTENER_JOB);
          if (!job) {
            return {matched: false, diagnostic: `listener job ${LISTENER_JOB} missing`};
          }
          const statusMatches = job.executions.every(
            (execution) => execution.status === 'succeeded',
          );
          const diagnosticBytes = job.executions.map(oversizedTriggerEventBytes);
          const bytesMatch =
            diagnosticBytes.every((bytes): bytes is number => bytes !== null) &&
            diagnosticBytes.reduce((total, bytes) => total + (bytes ?? 0), 0) >=
              expectedDiagnosticBytes;
          return {
            matched: statusMatches && bytesMatch,
            diagnostic: `listener deliveries expected=[${deliveryIds.join(', ')}], statuses=[${job.executions.map((execution) => execution.status).join(', ')}], diagnosticBytes=[${diagnosticBytes.join(', ')}], expectedDiagnosticBytes=${expectedDiagnosticBytes}`,
          };
        },
      });
      const executions = listenerExecutions(materialized)
        .slice()
        .sort((left, right) => left.sequence - right.sequence);
      const observedDiagnosticBytes = executions.map(oversizedTriggerEventBytes);

      expect(executions.map((execution) => execution.sequence)).toEqual([1, 2]);
      expect(observedDiagnosticBytes.every((bytes): bytes is number => bytes !== null)).toBe(true);
      expect(
        observedDiagnosticBytes.reduce<number>((total, bytes) => total + (bytes ?? 0), 0),
      ).toBeGreaterThanOrEqual(expectedDiagnosticBytes);
      for (const execution of executions) {
        expect(execution.status).toBe('succeeded');
        expect(execution.context?.oversized_fields).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              field: 'trigger_events',
              reason: 'legacy_value_exceeds_inline_limit',
            }),
          ]),
        );
      }

      const observedDeliveryIds = (
        await Promise.all(
          executions.map(async (execution) => {
            const logs = await stepLogText({
              observation: materialized,
              token: listenerCase.token,
              jobKey: LISTENER_JOB,
              sequence: execution.sequence,
              stepKey: 'acknowledge',
            });
            const deliveryLine = logs
              .split('\n')
              .map((line) => line.trim())
              .find((line) => line.startsWith(PRODUCTION_DELIVERY_IDS_LOG_PREFIX));
            if (!deliveryLine) {
              throw new Error(
                `Listener execution ${execution.sequence} did not log production delivery IDs`,
              );
            }
            return deliveryLine
              .slice(PRODUCTION_DELIVERY_IDS_LOG_PREFIX.length)
              .split(',')
              .filter(Boolean);
          }),
        )
      ).flat();
      expect(observedDeliveryIds).toEqual(deliveryIds);

      await sendResolve(testCase, 'resolve-byte-partition');
      const terminal = await waitForRunTerminalOrFailedRunner({
        runId,
        token: testCase.token,
        timeoutMs: LISTENER_RUN_TERMINAL_TIMEOUT_MS,
        runner: testCase.runner,
        selection: {
          jobs: [{jobKey: LISTENER_JOB, executionSequences: 'all', includeContext: true}],
        },
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
        includeContext: true,
        timeoutMs: LISTENER_RUN_TERMINAL_TIMEOUT_MS,
      });
      assertOversizedTriggerEvents(
        listenerExecution(recovered, 1),
        recoveryFixture.serializedBytes,
      );
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
        selection: {
          jobs: [{jobKey: LISTENER_JOB, executionSequences: 'all', includeContext: true}],
        },
      });

      expect(detail.decisions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            subscription_kind: 'listener',
            decision: 'triggered',
          }),
        ]),
      );
      expect(resolved.jobs.find((job) => job.key === LISTENER_JOB)?.listener_status).toBe(
        'resolved',
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
