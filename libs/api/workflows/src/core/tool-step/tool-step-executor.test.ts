import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {LogsModuleClient} from '@shipfox/api-logs-dto/inter-module';
import {createWorkflowExpression} from '@shipfox/expression';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {steps as stepsTable} from '#db/schema/steps.js';
import {
  claimToolInvocations,
  getStepAttempts,
  getStepsByJobId,
  getToolInvocationsByJobExecutionId,
} from '#db/workflow-runs.js';
import {arrangeJobWithSteps} from '#test/fixtures/job-with-steps.js';
import {nextStepForJob} from '../job-execution.js';
import {runToolStepExecutorCycle, toolRetryDelayMs} from './tool-step-executor.js';

describe('tool step executor', () => {
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
    const logCall = appendServerRecords.mock.calls.find(([input]) => input.stepId === stepId);
    expect(logCall).toBeDefined();
    const records = logCall?.[0].records ?? [];
    expect(records[0]).toMatchObject({type: 'group_start', parent_group_id: null});
    expect(records.at(-1)).toMatchObject({type: 'group_end'});
    expect(records.filter((record) => record.type === 'output')).toHaveLength(2);
    expect(
      records.find((record) => record.type === 'output' && record.data.includes('ENG-1680')),
    ).toBeDefined();
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

    const secondNow = new Date(firstNow.getTime() + 2_000);
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

async function arrangeToolStep(sensitivity: 'read' | 'write' = 'read'): Promise<{
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
          sensitive: false,
          required_scope: [],
          input_schema: {
            type: 'object',
            properties: {issue: {type: 'string'}},
            required: ['issue'],
            additionalProperties: false,
          },
          with: {issue: 'ENG-1680'},
          output_mappings: {
            identifier: createWorkflowExpression({
              source: 'result.identifier',
              check: {mode: 'syntax'},
            }),
          },
        },
        outputs: {
          result: {type: 'json'},
          identifier: {type: 'string'},
        },
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
