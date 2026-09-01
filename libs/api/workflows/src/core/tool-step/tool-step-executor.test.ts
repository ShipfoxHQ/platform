import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {MAX_RECORD_DATA_BYTES} from '@shipfox/api-logs-dto';
import {type LogsModuleClient, logsInterModuleContract} from '@shipfox/api-logs-dto/inter-module';
import {createWorkflowExpression} from '@shipfox/expression';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {createOutboxRegistry} from '@shipfox/node-module';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {stepAttempts as stepAttemptsTable} from '#db/schema/step-attempts.js';
import {steps as stepsTable} from '#db/schema/steps.js';
import {toolInvocations as toolInvocationsTable} from '#db/schema/tool-invocations.js';
import {
  claimToolInvocations,
  getStepAttempts,
  getStepsByJobId,
  getToolInvocationsByJobExecutionId,
  MAX_TOOL_STEP_CALLS_PER_ATTEMPT,
  retryToolInvocation,
} from '#db/workflow-runs.js';
import {arrangeJobWithSteps} from '#test/fixtures/job-with-steps.js';
import {nextStepForJob} from '../job-execution.js';
import {
  createToolStepExecutor,
  runToolStepExecutorCycle,
  toolRetryDelayMs,
} from './tool-step-executor.js';

const metricMocks = vi.hoisted(() => ({
  recordWorkflowToolInvocationDuration: vi.fn(),
  recordWorkflowToolInvocationLogAppendFailure: vi.fn(),
  recordWorkflowToolInvocationReclaims: vi.fn(),
}));

vi.mock('#metrics/instance.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#metrics/instance.js')>()),
  recordWorkflowToolInvocationReclaims: metricMocks.recordWorkflowToolInvocationReclaims,
}));

describe('tool step executor', () => {
  beforeEach(() => {
    metricMocks.recordWorkflowToolInvocationReclaims.mockClear();
  });

  test('claims a queued tool, calls the integration, logs it, and settles the step', async () => {
    const {jobId, stepId, connectionId} = await arrangeToolStep();
    const callTool = vi.fn<IntegrationsModuleClient['callTool']>().mockResolvedValue({
      outcome: 'success' as const,
      result: {identifier: 'ENG-1680', title: 'Executor'},
      content: [{type: 'text', text: 'ignored'}],
    });
    const appendServerRecords = vi
      .fn<LogsModuleClient['appendServerRecords']>()
      .mockResolvedValue({committedLength: 0, capped: false});

    await nextStepForJob(jobId);
    const didWork = await runToolStepExecutorCycle({
      integrations: {callTool} as unknown as IntegrationsModuleClient,
      logs: {appendServerRecords} as unknown as LogsModuleClient,
      signal: new AbortController().signal,
      claimOwner: 'executor-test',
      concurrency: 8,
      callTimeoutMs: 30_000,
    });

    expect(didWork).toBe(true);
    expect(metricMocks.recordWorkflowToolInvocationReclaims).not.toHaveBeenCalled();
    expect(callTool).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: expect.any(String),
        connectionId,
        tool: expect.objectContaining({
          id: 'issue_read',
          provider: 'fake',
          sensitivity: 'read',
        }),
        arguments: {issue: 'ENG-1680'},
        caller: expect.objectContaining({
          kind: 'tool_step',
          projectId: expect.any(String),
          jobExecutionId: expect.any(String),
          stepId,
          stepAttempt: 1,
          callIndex: 0,
        }),
      }),
      expect.objectContaining({signal: expect.any(AbortSignal)}),
    );
    const toolCall = callTool.mock.calls.find(
      ([input]) => input.caller.kind === 'tool_step' && input.caller.stepId === stepId,
    );
    expect(toolCall?.[0].tool).not.toHaveProperty('method');

    const [step] = await getStepsByJobId(jobId);
    expect(step).toMatchObject({id: stepId, status: 'succeeded'});
    const [attempt] = await getStepAttempts(jobId);
    expect(attempt).toMatchObject({
      status: 'succeeded',
      output: {
        result: {identifier: 'ENG-1680', title: 'Executor'},
        identifier: 'ENG-1680',
      },
    });
    expect(attempt?.invocations).toEqual([
      expect.objectContaining({call_index: 0, outcome: 'success'}),
    ]);
    expect(attempt?.invocations[0]).not.toHaveProperty('error_code');

    const [invocation] = await getToolInvocationsByJobExecutionIdForJob(jobId);
    expect(invocation).toMatchObject({
      status: 'settled',
      callIndex: 0,
      claimedBy: null,
      claimExpiresAt: null,
      lastErrorCode: null,
    });
    const logCalls = appendServerRecords.mock.calls.filter(([input]) => input.stepId === stepId);
    const records = logCalls.flatMap(([input]) => input.records);
    expect(records[0]).toMatchObject({type: 'group_start', parent_group_id: null});
    expect(records.at(-1)).toMatchObject({type: 'group_end'});
    expect(records.filter((record) => record.type === 'output')).toHaveLength(2);
    expect(
      records.find((record) => record.type === 'output' && record.data.includes('ENG-1680')),
    ).toBeDefined();
  });

  test('uses a JSON text content block when the provider result is null', async () => {
    const {jobId} = await arrangeToolStep();
    const callTool = vi.fn<IntegrationsModuleClient['callTool']>().mockResolvedValue({
      outcome: 'success' as const,
      result: null,
      content: [{type: 'text', text: '{"identifier":"ENG-1"}'}],
    });
    const appendServerRecords = vi
      .fn<LogsModuleClient['appendServerRecords']>()
      .mockResolvedValue({committedLength: 0, capped: false});

    await nextStepForJob(jobId);
    await runToolStepExecutorCycle({
      integrations: {callTool} as unknown as IntegrationsModuleClient,
      logs: {appendServerRecords} as unknown as LogsModuleClient,
      signal: new AbortController().signal,
      claimOwner: 'executor-test',
      concurrency: 8,
      callTimeoutMs: 30_000,
    });

    const [attempt] = await getStepAttempts(jobId);
    expect(attempt).toMatchObject({
      status: 'succeeded',
      output: {
        result: {identifier: 'ENG-1'},
        identifier: 'ENG-1',
      },
    });
  });

  test('recovers from a cycle failure and stops cleanly', async () => {
    const cycleRecovered = deferred();
    const waitForStop = deferred();
    const error = new Error('temporary cycle failure');
    const runCycle = vi
      .fn<(signal: AbortSignal) => Promise<boolean>>()
      .mockRejectedValueOnce(error)
      .mockImplementationOnce(() => {
        cycleRecovered.resolve();
        return Promise.resolve(false);
      });
    const logError = vi.fn();
    const wait = vi.fn(async (ms: number, signal: AbortSignal) => {
      if (ms === 1_000) return;
      waitForStop.resolve();
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), {once: true});
      });
    });
    const {service} = createToolStepExecutor({
      integrations: {} as unknown as IntegrationsModuleClient,
      logs: {} as unknown as LogsModuleClient,
      options: {pollMs: 1, runCycle, wait, logError},
    });

    const running = await service.start({outboxRegistry: createOutboxRegistry()});
    await cycleRecovered.promise;
    await waitForStop.promise;
    await running.stop();

    expect(logError).toHaveBeenCalledWith(error);
    expect(runCycle).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(1_000, expect.any(AbortSignal));
  });

  test('settles before a slow log append can lose the invocation claim', async () => {
    const {jobId} = await arrangeToolStep('write');
    const appendStarted = deferred();
    const releaseAppend = deferred();
    let blockFirstAppend = true;
    const callTool = vi.fn<IntegrationsModuleClient['callTool']>().mockResolvedValue({
      outcome: 'success' as const,
      result: {identifier: 'ENG-1680'},
      content: [],
    });
    const appendServerRecords = vi
      .fn<LogsModuleClient['appendServerRecords']>()
      .mockImplementation(async () => {
        if (blockFirstAppend) {
          blockFirstAppend = false;
          appendStarted.resolve();
          await releaseAppend.promise;
        }
        return {committedLength: 0, capped: false};
      });

    await nextStepForJob(jobId);
    const firstCycle = runToolStepExecutorCycle({
      integrations: {callTool} as unknown as IntegrationsModuleClient,
      logs: {appendServerRecords} as unknown as LogsModuleClient,
      signal: new AbortController().signal,
      claimOwner: 'executor-one',
      concurrency: 8,
      callTimeoutMs: 30_000,
    });
    await appendStarted.promise;
    const [invocation] = await getToolInvocationsByJobExecutionIdForJob(jobId);
    if (!invocation) throw new Error('Expected a tool invocation');
    await db()
      .update(toolInvocationsTable)
      .set({claimExpiresAt: new Date(Date.now() - 1)})
      .where(eq(toolInvocationsTable.id, invocation.id));

    await runToolStepExecutorCycle({
      integrations: {callTool} as unknown as IntegrationsModuleClient,
      logs: {appendServerRecords} as unknown as LogsModuleClient,
      signal: new AbortController().signal,
      claimOwner: 'executor-two',
      concurrency: 8,
      callTimeoutMs: 30_000,
    });
    releaseAppend.resolve();
    await firstCycle;

    expect(callTool).toHaveBeenCalledTimes(1);
    const [step] = await getStepsByJobId(jobId);
    expect(step).toMatchObject({status: 'succeeded'});
  });

  test('reclaims an expired read invocation into the next call index', async () => {
    const {jobId} = await arrangeToolStep('read');
    await nextStepForJob(jobId);
    const [queued] = await getToolInvocationsByJobExecutionIdForJob(jobId);
    if (!queued) throw new Error('Expected a queued invocation');

    const firstNow = new Date();
    const first = await claimToolInvocations({
      limit: 1,
      now: firstNow,
      claimOwner: 'executor-one',
      claimExpiresAt: new Date(firstNow.getTime() + 1_000),
    });
    expect(first.claims).toHaveLength(1);

    // Keep the requeued row due in the future on the real clock so this test
    // does not leak work into later executor-cycle tests.
    const secondNow = new Date(Date.now() + 2_000);
    const second = await claimToolInvocations({
      limit: 1,
      now: secondNow,
      claimOwner: 'executor-two',
      claimExpiresAt: new Date(secondNow.getTime() + 1_000),
    });
    expect(second.claims).toHaveLength(0);
    expect(second.requeued).toBe(1);

    const [invocation] = await getToolInvocationsByJobExecutionIdForJob(jobId);
    expect(invocation).toMatchObject({
      status: 'queued',
      callIndex: 1,
      lastErrorCode: 'invocation_interrupted',
      claimedBy: null,
      claimExpiresAt: null,
    });
    const [attempt] = await getStepAttempts(jobId);
    expect(attempt?.invocations).toEqual([
      expect.objectContaining({call_index: 0, error_code: 'invocation_interrupted'}),
      expect.objectContaining({call_index: 1, next_due_at: secondNow.toISOString()}),
    ]);
  });

  test('records a requeued reclaim when an expired read invocation is found by the executor', async () => {
    const {jobId} = await arrangeToolStep('read');
    await nextStepForJob(jobId);
    const [queued] = await getToolInvocationsByJobExecutionIdForJob(jobId);
    if (!queued) throw new Error('Expected a queued invocation');

    const firstNow = new Date();
    const [claimed] = (
      await claimToolInvocations({
        limit: 1,
        now: firstNow,
        claimOwner: 'executor-one',
        claimExpiresAt: new Date(firstNow.getTime() + 1_000),
      })
    ).claims;
    if (!claimed) throw new Error('Expected a claimed invocation');
    await db()
      .update(toolInvocationsTable)
      .set({claimExpiresAt: new Date(Date.now() - 1)})
      .where(eq(toolInvocationsTable.id, claimed.invocation.id));

    const didReclaim = await runToolStepExecutorCycle({
      integrations: {} as unknown as IntegrationsModuleClient,
      logs: {} as unknown as LogsModuleClient,
      signal: new AbortController().signal,
      claimOwner: 'executor-two',
      concurrency: 8,
      callTimeoutMs: 30_000,
    });

    expect(didReclaim).toBe(true);
    await db()
      .update(toolInvocationsTable)
      .set({dueAt: new Date(Date.now() + 60_000)})
      .where(eq(toolInvocationsTable.id, claimed.invocation.id));
    expect(metricMocks.recordWorkflowToolInvocationReclaims).toHaveBeenCalledWith('requeued', 1);
    expect(metricMocks.recordWorkflowToolInvocationReclaims).not.toHaveBeenCalledWith(
      'failed',
      expect.any(Number),
    );
  });

  test('retries a rate-limited read and settles the next call', async () => {
    const {jobId} = await arrangeToolStep('read');
    const callTool = vi
      .fn<IntegrationsModuleClient['callTool']>()
      .mockResolvedValueOnce({
        outcome: 'error' as const,
        code: 'rate-limited',
        message: 'Try again later',
      })
      .mockResolvedValueOnce({
        outcome: 'success' as const,
        result: {identifier: 'ENG-1680'},
        content: [],
      });
    const appendServerRecords = vi
      .fn<LogsModuleClient['appendServerRecords']>()
      .mockResolvedValue({committedLength: 0, capped: false});

    await nextStepForJob(jobId);
    await runToolStepExecutorCycle({
      integrations: {callTool} as unknown as IntegrationsModuleClient,
      logs: {appendServerRecords} as unknown as LogsModuleClient,
      signal: new AbortController().signal,
      claimOwner: 'executor-test',
      concurrency: 8,
      callTimeoutMs: 30_000,
    });

    const [queued] = await getToolInvocationsByJobExecutionIdForJob(jobId);
    expect(queued).toMatchObject({status: 'queued', callIndex: 1, lastErrorCode: 'rate-limited'});
    const [attemptAfterRetry] = await getStepAttempts(jobId);
    expect(attemptAfterRetry?.invocations).toEqual([
      expect.objectContaining({call_index: 0, error_code: 'rate-limited'}),
      expect.objectContaining({call_index: 1, next_due_at: expect.any(String)}),
    ]);

    await db()
      .update(toolInvocationsTable)
      .set({dueAt: new Date(Date.now() - 1)})
      .where(eq(toolInvocationsTable.id, queued?.id ?? ''));

    await runToolStepExecutorCycle({
      integrations: {callTool} as unknown as IntegrationsModuleClient,
      logs: {appendServerRecords} as unknown as LogsModuleClient,
      signal: new AbortController().signal,
      claimOwner: 'executor-test',
      concurrency: 8,
      callTimeoutMs: 30_000,
    });

    expect(callTool).toHaveBeenCalledTimes(2);
    const [step] = await getStepsByJobId(jobId);
    expect(step).toMatchObject({status: 'succeeded'});
    const [invocation] = await getToolInvocationsByJobExecutionIdForJob(jobId);
    expect(invocation).toMatchObject({status: 'settled', callIndex: 1, lastErrorCode: null});
    const [attempt] = await getStepAttempts(jobId);
    expect(attempt?.invocations).toEqual([
      expect.objectContaining({call_index: 0, outcome: 'error', error_code: 'rate-limited'}),
      expect.objectContaining({call_index: 1, outcome: 'success'}),
    ]);
  });

  test('settles an expired write invocation as interrupted without calling the provider', async () => {
    const {jobId} = await arrangeToolStep('write');
    await nextStepForJob(jobId);
    const [claimed] = (
      await claimToolInvocations({
        limit: 1,
        now: new Date(),
        claimOwner: 'executor-one',
        claimExpiresAt: new Date(Date.now() + 1_000),
      })
    ).claims;
    if (!claimed) throw new Error('Expected a claimed invocation');
    await db()
      .update(toolInvocationsTable)
      .set({claimExpiresAt: new Date(Date.now() - 1)})
      .where(eq(toolInvocationsTable.id, claimed.invocation.id));

    const callTool = vi.fn<IntegrationsModuleClient['callTool']>();
    const appendServerRecords = vi
      .fn<LogsModuleClient['appendServerRecords']>()
      .mockResolvedValue({committedLength: 0, capped: false});
    await runToolStepExecutorCycle({
      integrations: {callTool} as unknown as IntegrationsModuleClient,
      logs: {appendServerRecords} as unknown as LogsModuleClient,
      signal: new AbortController().signal,
      claimOwner: 'executor-two',
      concurrency: 8,
      callTimeoutMs: 30_000,
    });

    expect(callTool).not.toHaveBeenCalled();
    expect(metricMocks.recordWorkflowToolInvocationReclaims).toHaveBeenCalledWith('failed', 1);
    expect(metricMocks.recordWorkflowToolInvocationReclaims).not.toHaveBeenCalledWith(
      'requeued',
      expect.any(Number),
    );
    const [step] = await getStepsByJobId(jobId);
    expect(step).toMatchObject({status: 'failed', error: {code: 'invocation_interrupted'}});
    const [invocation] = await getToolInvocationsByJobExecutionIdForJob(jobId);
    expect(invocation).toMatchObject({
      status: 'settled',
      lastErrorCode: 'invocation_interrupted',
    });
    const [attempt] = await getStepAttempts(jobId);
    expect(attempt?.invocations).toEqual([
      expect.objectContaining({call_index: 0, error_code: 'invocation_interrupted'}),
    ]);
  });

  test('settles a provider error after the final allowed call without retrying', async () => {
    const {jobId} = await arrangeToolStep('read');
    await nextStepForJob(jobId);
    const [invocation] = await getToolInvocationsByJobExecutionIdForJob(jobId);
    if (!invocation) throw new Error('Expected a tool invocation');
    await db()
      .update(toolInvocationsTable)
      .set({callIndex: MAX_TOOL_STEP_CALLS_PER_ATTEMPT - 1, dueAt: new Date(Date.now() - 1)})
      .where(eq(toolInvocationsTable.id, invocation.id));

    const callTool = vi.fn<IntegrationsModuleClient['callTool']>().mockResolvedValue({
      outcome: 'error' as const,
      code: 'provider-timeout',
      message: 'Provider timed out',
    });
    const appendServerRecords = vi
      .fn<LogsModuleClient['appendServerRecords']>()
      .mockResolvedValue({committedLength: 0, capped: false});
    await runToolStepExecutorCycle({
      integrations: {callTool} as unknown as IntegrationsModuleClient,
      logs: {appendServerRecords} as unknown as LogsModuleClient,
      signal: new AbortController().signal,
      claimOwner: 'executor-test',
      concurrency: 8,
      callTimeoutMs: 30_000,
    });

    expect(callTool).toHaveBeenCalledTimes(1);
    const [step] = await getStepsByJobId(jobId);
    expect(step).toMatchObject({status: 'failed', error: {code: 'provider-timeout'}});
    const [settled] = await getToolInvocationsByJobExecutionIdForJob(jobId);
    expect(settled).toMatchObject({status: 'settled', callIndex: 2});
  });

  test('does not call a provider when a queued invocation belongs to a cancelled step', async () => {
    const {jobId, stepId} = await arrangeToolStep();
    await nextStepForJob(jobId);
    await db().update(stepsTable).set({status: 'cancelled'}).where(eq(stepsTable.id, stepId));

    const callTool = vi.fn<IntegrationsModuleClient['callTool']>();
    const appendServerRecords = vi
      .fn<LogsModuleClient['appendServerRecords']>()
      .mockResolvedValue({committedLength: 0, capped: false});
    await runToolStepExecutorCycle({
      integrations: {callTool} as unknown as IntegrationsModuleClient,
      logs: {appendServerRecords} as unknown as LogsModuleClient,
      signal: new AbortController().signal,
      claimOwner: 'executor-test',
      concurrency: 8,
      callTimeoutMs: 30_000,
    });

    expect(callTool).not.toHaveBeenCalled();
    const [invocation] = await getToolInvocationsByJobExecutionIdForJob(jobId);
    expect(invocation).toMatchObject({status: 'settled', lastErrorCode: null});
  });

  test('leaves a shutdown-aborted read invocation for reclaim', async () => {
    const {jobId} = await arrangeToolStep('read');
    const controller = new AbortController();
    const callTool = vi
      .fn<IntegrationsModuleClient['callTool']>()
      .mockImplementationOnce((_input, options) => {
        controller.abort();
        throw options?.signal?.reason ?? new Error('Provider call aborted');
      })
      .mockResolvedValueOnce({
        outcome: 'success' as const,
        result: {identifier: 'ENG-1680'},
        content: [],
      });
    const appendServerRecords = vi
      .fn<LogsModuleClient['appendServerRecords']>()
      .mockResolvedValue({committedLength: 0, capped: false});

    await nextStepForJob(jobId);
    await runToolStepExecutorCycle({
      integrations: {callTool} as unknown as IntegrationsModuleClient,
      logs: {appendServerRecords} as unknown as LogsModuleClient,
      signal: controller.signal,
      claimOwner: 'executor-test',
      concurrency: 8,
      callTimeoutMs: 30_000,
    });

    const [invocation] = await getToolInvocationsByJobExecutionIdForJob(jobId);
    expect(invocation).toMatchObject({
      status: 'in_flight',
      claimedBy: 'executor-test',
    });
    expect(appendServerRecords).not.toHaveBeenCalled();

    if (!invocation) throw new Error('Expected a tool invocation');
    await db()
      .update(toolInvocationsTable)
      .set({claimExpiresAt: new Date(Date.now() - 1)})
      .where(eq(toolInvocationsTable.id, invocation.id));

    const didReclaim = await runToolStepExecutorCycle({
      integrations: {callTool} as unknown as IntegrationsModuleClient,
      logs: {appendServerRecords} as unknown as LogsModuleClient,
      signal: new AbortController().signal,
      claimOwner: 'executor-two',
      concurrency: 8,
      callTimeoutMs: 30_000,
    });
    expect(didReclaim).toBe(true);
    const [queued] = await getToolInvocationsByJobExecutionIdForJob(jobId);
    expect(queued).toMatchObject({status: 'queued', callIndex: 1});

    await runToolStepExecutorCycle({
      integrations: {callTool} as unknown as IntegrationsModuleClient,
      logs: {appendServerRecords} as unknown as LogsModuleClient,
      signal: new AbortController().signal,
      claimOwner: 'executor-two',
      concurrency: 8,
      callTimeoutMs: 30_000,
    });
    expect(callTool).toHaveBeenCalledTimes(2);
    const [step] = await getStepsByJobId(jobId);
    expect(step).toMatchObject({status: 'succeeded'});
  });

  test('does not transition an invocation after its running attempt is gone', async () => {
    const {jobId} = await arrangeToolStep();
    await nextStepForJob(jobId);
    const [claim] = (
      await claimToolInvocations({
        limit: 1,
        now: new Date(),
        claimOwner: 'executor-one',
        claimExpiresAt: new Date(Date.now() + 1_000),
      })
    ).claims;
    if (!claim) throw new Error('Expected a claimed invocation');

    await db()
      .update(stepAttemptsTable)
      .set({status: 'failed', finishedAt: new Date()})
      .where(eq(stepAttemptsTable.id, claim.attempt.id));

    const retried = await retryToolInvocation({
      invocationId: claim.invocation.id,
      stepAttemptId: claim.invocation.stepAttemptId,
      claimOwner: 'executor-one',
      callIndex: claim.invocation.callIndex,
      dueAt: new Date(),
      errorCode: 'provider-timeout',
      finishedAt: new Date(),
      durationMs: 10,
    });

    expect(retried).toBe(false);
    const [invocation] = await getToolInvocationsByJobExecutionIdForJob(jobId);
    expect(invocation).toMatchObject({
      status: 'in_flight',
      claimedBy: 'executor-one',
      callIndex: 0,
    });
  });

  test('settles a provider failure through the step attempt history', async () => {
    const {jobId, stepId} = await arrangeToolStep();
    const callTool = vi.fn<IntegrationsModuleClient['callTool']>().mockResolvedValue({
      outcome: 'error' as const,
      code: 'connection_not_found',
      message: 'Connection not found',
    });
    const appendServerRecords = vi
      .fn<LogsModuleClient['appendServerRecords']>()
      .mockResolvedValue({committedLength: 0, capped: false});

    await nextStepForJob(jobId);
    await runToolStepExecutorCycle({
      integrations: {callTool} as unknown as IntegrationsModuleClient,
      logs: {appendServerRecords} as unknown as LogsModuleClient,
      signal: new AbortController().signal,
      claimOwner: 'executor-test',
      concurrency: 8,
      callTimeoutMs: 30_000,
    });

    const [step] = await getStepsByJobId(jobId);
    expect(step).toMatchObject({
      id: stepId,
      status: 'failed',
      error: {code: 'connection_not_found', reason: 'tool_error'},
    });
    const [attempt] = await getStepAttempts(jobId);
    expect(attempt).toMatchObject({
      status: 'failed',
      error: {code: 'connection_not_found', reason: 'tool_error'},
    });
    expect(attempt?.invocations).toEqual([
      expect.objectContaining({
        call_index: 0,
        outcome: 'error',
        error_code: 'connection_not_found',
      }),
    ]);
  });

  test('maps a raw provider timeout to a retryable provider-timeout error', async () => {
    const {jobId} = await arrangeToolStep('write');
    const callTool = vi.fn<IntegrationsModuleClient['callTool']>().mockImplementation(
      async (_input, options) =>
        new Promise((_, reject) => {
          const signal = options?.signal;
          if (!signal) {
            reject(new Error('Expected an abort signal'));
            return;
          }
          signal.addEventListener('abort', () => reject(signal.reason), {once: true});
        }),
    );
    const appendServerRecords = vi
      .fn<LogsModuleClient['appendServerRecords']>()
      .mockResolvedValue({committedLength: 0, capped: false});

    await nextStepForJob(jobId);
    await runToolStepExecutorCycle({
      integrations: {callTool} as unknown as IntegrationsModuleClient,
      logs: {appendServerRecords} as unknown as LogsModuleClient,
      signal: new AbortController().signal,
      claimOwner: 'executor-test',
      concurrency: 8,
      callTimeoutMs: 5,
    });

    const [step] = await getStepsByJobId(jobId);
    expect(step).toMatchObject({status: 'failed', error: {code: 'provider-timeout'}});
    const [attempt] = await getStepAttempts(jobId);
    expect(attempt?.invocations).toEqual([
      expect.objectContaining({call_index: 0, error_code: 'provider-timeout'}),
    ]);
  });

  test('records output mapping failures as output_invalid', async () => {
    const {jobId} = await arrangeToolStep('read', {outputMappings: {identifier: {}}});
    const callTool = vi.fn<IntegrationsModuleClient['callTool']>().mockResolvedValue({
      outcome: 'success' as const,
      result: {identifier: 'ENG-1680'},
      content: [],
    });
    const appendServerRecords = vi
      .fn<LogsModuleClient['appendServerRecords']>()
      .mockResolvedValue({committedLength: 0, capped: false});

    await nextStepForJob(jobId);
    await runToolStepExecutorCycle({
      integrations: {callTool} as unknown as IntegrationsModuleClient,
      logs: {appendServerRecords} as unknown as LogsModuleClient,
      signal: new AbortController().signal,
      claimOwner: 'executor-test',
      concurrency: 8,
      callTimeoutMs: 30_000,
    });

    const [step] = await getStepsByJobId(jobId);
    expect(step).toMatchObject({
      status: 'failed',
      error: {code: 'output_invalid', reason: 'output_invalid'},
    });
  });

  test('preserves a __proto__ output mapping as ordinary output data', async () => {
    const outputMappings: Record<string, unknown> = {};
    Object.defineProperty(outputMappings, '__proto__', {
      enumerable: true,
      value: createWorkflowExpression({
        source: 'result.identifier',
        check: {mode: 'syntax'},
      }),
    });
    const {jobId} = await arrangeToolStep('read', {
      outputMappings,
      includeOutputs: false,
    });
    const callTool = vi.fn<IntegrationsModuleClient['callTool']>().mockResolvedValue({
      outcome: 'success' as const,
      result: {identifier: 'ENG-1680'},
      content: [],
    });
    const appendServerRecords = vi
      .fn<LogsModuleClient['appendServerRecords']>()
      .mockResolvedValue({committedLength: 0, capped: false});

    await nextStepForJob(jobId);
    await runToolStepExecutorCycle({
      integrations: {callTool} as unknown as IntegrationsModuleClient,
      logs: {appendServerRecords} as unknown as LogsModuleClient,
      signal: new AbortController().signal,
      claimOwner: 'executor-test',
      concurrency: 8,
      callTimeoutMs: 30_000,
    });

    const [attempt] = await getStepAttempts(jobId);
    expect(Object.hasOwn(attempt?.output ?? {}, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(attempt?.output ?? {}, '__proto__')?.value).toBe(
      'ENG-1680',
    );
  });

  test('redacts sensitive tool arguments and results from durable logs', async () => {
    const {jobId, stepId} = await arrangeToolStep('write', {
      sensitive: true,
      arguments: {issue: 'argument-secret'},
    });
    const callTool = vi.fn<IntegrationsModuleClient['callTool']>().mockResolvedValue({
      outcome: 'success' as const,
      result: {identifier: 'result-secret'},
      content: [],
    });
    const appendServerRecords = vi
      .fn<LogsModuleClient['appendServerRecords']>()
      .mockResolvedValue({committedLength: 0, capped: false});

    await nextStepForJob(jobId);
    await runToolStepExecutorCycle({
      integrations: {callTool} as unknown as IntegrationsModuleClient,
      logs: {appendServerRecords} as unknown as LogsModuleClient,
      signal: new AbortController().signal,
      claimOwner: 'executor-test',
      concurrency: 8,
      callTimeoutMs: 30_000,
    });

    const records = appendServerRecords.mock.calls
      .filter(([input]) => input.stepId === stepId)
      .flatMap(([input]) => input.records);
    const logData = records
      .filter((record) => record.type === 'output')
      .map((record) => record.data)
      .join('\n');
    expect(logData).toContain('sensitive tool arguments redacted');
    expect(logData).toContain('sensitive tool result redacted');
    expect(logData).not.toContain('argument-secret');
    expect(logData).not.toContain('result-secret');
  });

  test('appends a large log group one record at a time', async () => {
    const {jobId, stepId} = await arrangeToolStep();
    const callTool = vi.fn<IntegrationsModuleClient['callTool']>().mockResolvedValue({
      outcome: 'success' as const,
      result: {identifier: 'ENG-1680', value: '😀'.repeat(300_000)},
      content: [],
    });
    const appendServerRecords = vi
      .fn<LogsModuleClient['appendServerRecords']>()
      .mockImplementation((input) => {
        if (input.records.length > 1) throw new Error('append body too large');
        return Promise.resolve({committedLength: 0, capped: false});
      });

    await nextStepForJob(jobId);
    await runToolStepExecutorCycle({
      integrations: {callTool} as unknown as IntegrationsModuleClient,
      logs: {appendServerRecords} as unknown as LogsModuleClient,
      signal: new AbortController().signal,
      claimOwner: 'executor-test',
      concurrency: 8,
      callTimeoutMs: 30_000,
    });

    const records = appendServerRecords.mock.calls
      .filter(([input]) => input.stepId === stepId)
      .flatMap(([input]) => input.records);
    expect(appendServerRecords).toHaveBeenCalled();
    expect(appendServerRecords.mock.calls.every(([input]) => input.records.length === 1)).toBe(
      true,
    );
    expect(
      records
        .filter((record) => record.type === 'output')
        .every((record) => Buffer.byteLength(record.data, 'utf8') <= MAX_RECORD_DATA_BYTES),
    ).toBe(true);
    expect(
      records.some((record) => record.type === 'output' && record.data.includes('[truncated]')),
    ).toBe(true);
    expect(records.at(-1)).toMatchObject({type: 'group_end'});
  });

  test('preserves a BOM at a log chunk boundary', async () => {
    const {jobId, stepId} = await arrangeToolStep('read', {outputMappings: {}});
    const jsonPrefix = '{\n  "value": "';
    const value =
      'x'.repeat(MAX_RECORD_DATA_BYTES - new TextEncoder().encode(jsonPrefix).length) +
      '\uFEFFpreserved';
    const callTool = vi.fn<IntegrationsModuleClient['callTool']>().mockResolvedValue({
      outcome: 'success' as const,
      result: {value},
      content: [],
    });
    const appendServerRecords = vi
      .fn<LogsModuleClient['appendServerRecords']>()
      .mockResolvedValue({committedLength: 0, capped: false});

    await nextStepForJob(jobId);
    await runToolStepExecutorCycle({
      integrations: {callTool} as unknown as IntegrationsModuleClient,
      logs: {appendServerRecords} as unknown as LogsModuleClient,
      signal: new AbortController().signal,
      claimOwner: 'executor-test',
      concurrency: 8,
      callTimeoutMs: 30_000,
    });

    const output = appendServerRecords.mock.calls
      .filter(([input]) => input.stepId === stepId)
      .flatMap(([input]) => input.records)
      .filter((record) => record.type === 'output')
      .map((record) => record.data)
      .join('');
    expect(output).toContain('\uFEFFpreserved');
  });

  test('stops a log group when its first append fails', async () => {
    const {jobId} = await arrangeToolStep();
    const callTool = vi.fn<IntegrationsModuleClient['callTool']>().mockResolvedValue({
      outcome: 'success' as const,
      result: {identifier: 'ENG-1680'},
      content: [],
    });
    const appendError = createInterModuleKnownError(
      logsInterModuleContract.methods.appendServerRecords,
      'append-body-too-large',
      {maxBytes: 1},
    );
    const appendServerRecords = vi
      .fn<LogsModuleClient['appendServerRecords']>()
      .mockRejectedValue(appendError);

    await nextStepForJob(jobId);
    await runToolStepExecutorCycle({
      integrations: {callTool} as unknown as IntegrationsModuleClient,
      logs: {appendServerRecords} as unknown as LogsModuleClient,
      signal: new AbortController().signal,
      claimOwner: 'executor-test',
      concurrency: 8,
      callTimeoutMs: 30_000,
    });

    expect(appendServerRecords).toHaveBeenCalledTimes(1);
    const [step] = await getStepsByJobId(jobId);
    expect(step).toMatchObject({status: 'succeeded'});
  });

  test('retries rate limits for writes and provider failures only for reads', () => {
    expect(toolRetryDelayMs({code: 'rate-limited', sensitivity: 'write', callIndex: 0})).toBe(
      1_000,
    );
    expect(
      toolRetryDelayMs({
        code: 'rate-limited',
        sensitivity: 'read',
        callIndex: 1,
        retryAfterSeconds: 180,
      }),
    ).toBe(120_000);
    expect(
      toolRetryDelayMs({code: 'provider-timeout', sensitivity: 'write', callIndex: 0}),
    ).toBeUndefined();
    expect(
      toolRetryDelayMs({code: 'provider-timeout', sensitivity: 'read', callIndex: 2}),
    ).toBeUndefined();
  });
});

async function arrangeToolStep(
  sensitivity: 'read' | 'write' = 'read',
  options: {
    arguments?: Record<string, unknown>;
    includeOutputs?: boolean;
    outputMappings?: Record<string, unknown>;
    sensitive?: boolean;
  } = {},
): Promise<{
  jobId: string;
  stepId: string;
  connectionId: string;
}> {
  const {jobId, steps} = await arrangeJobWithSteps(1);
  const step = steps[0];
  if (!step) throw new Error('Expected a workflow step');
  const connectionId = crypto.randomUUID();
  await db()
    .update(stepsTable)
    .set({
      type: 'tool',
      config: {
        tool: {
          connection_id: connectionId,
          connection_slug: 'fake-main',
          provider: 'fake',
          id: 'issue_read',
          sensitivity,
          sensitive: options.sensitive ?? false,
          required_scope: [],
          input_schema: {
            type: 'object',
            properties: {issue: {type: 'string'}},
            required: ['issue'],
            additionalProperties: false,
          },
          with: options.arguments ?? {issue: 'ENG-1680'},
          output_mappings: options.outputMappings ?? {
            identifier: createWorkflowExpression({
              source: 'result.identifier',
              check: {mode: 'syntax'},
            }),
          },
        },
        ...(options.includeOutputs === false
          ? {}
          : {
              outputs: {
                result: {type: 'json'},
                identifier: {type: 'string'},
              },
            }),
      },
      configPlan: null,
    })
    .where(eq(stepsTable.id, step.id));
  return {jobId, stepId: step.id, connectionId};
}

async function getToolInvocationsByJobExecutionIdForJob(jobId: string) {
  const [step] = await getStepsByJobId(jobId);
  if (!step) throw new Error('Expected a workflow step');
  return getToolInvocationsByJobExecutionId(step.jobExecutionId);
}

function deferred(): {promise: Promise<void>; resolve: () => void} {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {promise, resolve: resolvePromise};
}
