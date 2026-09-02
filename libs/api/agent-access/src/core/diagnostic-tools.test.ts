import {
  type AgentAccessEnvelopeDto,
  agentAccessEnvelopeSchema,
  getStepAttemptResultSchema,
  getTriggerEventFacetsResultSchema,
  getTriggerEventResultSchema,
  getWorkflowRunResultSchema,
} from '@shipfox/api-agent-access-dto';
import type {AgentAccessContext} from '@shipfox/api-auth-context';
import type {TriggersInterModuleClient} from '@shipfox/api-triggers-dto/inter-module';
import {triggersInterModuleContract} from '@shipfox/api-triggers-dto/inter-module';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import {createAgentAccessDiagnosticTools} from './diagnostic-tools.js';
import {serializedAgentAccessEnvelopeByteLength} from './response.js';

const workspaceId = uuid(1);
const runId = uuid(2);
const stepId = uuid(3);
const eventId = uuid(4);
const isoDate = '2026-08-01T00:00:00.000Z';
const context: AgentAccessContext = {
  userId: uuid(5),
  workspaceId,
  scopes: ['read'],
  credential: {kind: 'pat', patId: uuid(6)},
};

describe('diagnostic agent-access tools', () => {
  test('resolves the latest run attempt and projects only diagnostic fields', async () => {
    const mocks = clients();
    mocks.workflows.getLatestRunAttempt.mockResolvedValue({attempt: 2});
    mocks.workflows.getWorkflowRunDetail.mockResolvedValue({
      run: workflowRun({
        run_attempt: {...workflowRun().run_attempt, attempt: 2},
      }),
    });

    const response = await tool(mocks, 'get_workflow_run').execute({
      context,
      arguments: {run_id: runId},
    });
    const result = expectSuccess<WorkflowRunResult>(response);

    expect(mocks.workflows.getLatestRunAttempt).toHaveBeenCalledWith({
      workspaceId,
      workflowRunId: runId,
    });
    expect(mocks.workflows.getWorkflowRunDetail).toHaveBeenCalledWith({
      workspaceId,
      workflowRunId: runId,
      attempt: 2,
      diagnostic: {jobs: 10, executions: 1, steps: 20, attempts: 1},
    });
    expect(result).toMatchObject({
      id: runId,
      inputs: JSON.stringify({prompt: 'data'}),
      run_attempt: {attempt: 2},
      jobs: [
        {
          key: 'job-1',
          job_executions: [
            {
              steps: [
                {
                  attempts: [
                    {gate_result: {kind: 'passed', passed: true, source: 'exit 0', exit_code: 0}},
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(result).not.toHaveProperty('trigger_payload');
    expect(result).not.toHaveProperty('source_snapshot');
    expect(result.jobs[0]?.job_executions[0]?.steps[0]).not.toHaveProperty('config');
    expect(result.jobs[0]?.job_executions[0]?.steps[0]?.attempts[0]).not.toHaveProperty('output');
    expect(result.jobs[0]?.job_executions[0]?.steps[0]?.error).toMatchObject({
      code: 'runner.failed',
    });
    expect(getWorkflowRunResultSchema.safeParse(result).success).toBe(true);
  });

  test('applies workflow reductions in order and keeps the response under the ceiling', async () => {
    const mocks = clients();
    const stepCount = (jobIndex: number, executionIndex: number) => {
      if (jobIndex === 0 && executionIndex === 1) return 21;
      if (jobIndex === 10) return 1;
      return 20;
    };
    const jobs = Array.from({length: 11}, (_, jobIndex) => ({
      ...sourceJob(jobIndex + 1),
      job_executions: Array.from({length: jobIndex === 0 ? 2 : 1}, (_, executionIndex) => ({
        ...sourceExecution(jobIndex * 2 + executionIndex + 1),
        sequence: executionIndex + 1,
        steps: Array.from({length: stepCount(jobIndex, executionIndex)}, (_, stepIndex) => ({
          ...sourceStep(jobIndex * 100 + executionIndex * 25 + stepIndex + 1),
          position: stepIndex + 1,
          name: 'x'.repeat(512),
          attempts:
            jobIndex === 0 && executionIndex === 1 && stepIndex === 0
              ? [sourceAttempt(1), sourceAttempt(2)].reverse()
              : [sourceAttempt(1)],
        })).reverse(),
      })).reverse(),
    })).reverse();
    mocks.workflows.getWorkflowRunDetail.mockResolvedValue({run: workflowRun({jobs})});

    const response = await tool(mocks, 'get_workflow_run').execute({
      context,
      arguments: {run_id: runId, attempt: 1},
    });
    const result = expectSuccess<WorkflowRunResult>(response);

    expect(response).toMatchObject({
      ok: true,
      response_truncated: true,
      response_total_bytes: expect.any(Number),
    });
    expect(result.jobs).toHaveLength(10);
    expect(result.jobs_truncated).toBe(true);
    expect(result.jobs_total_count).toBe(11);
    expect(result.jobs[0]?.job_executions).toHaveLength(1);
    expect(result.jobs[0]?.job_executions_truncated).toBe(true);
    expect(result.jobs[0]?.job_executions_total_count).toBe(2);
    expect(result.jobs[0]?.job_executions[0]?.steps).toHaveLength(20);
    expect(result.jobs[0]?.job_executions[0]?.steps_truncated).toBe(true);
    expect(result.jobs[0]?.job_executions[0]?.steps_total_count).toBe(21);
    expect(result.jobs[0]?.job_executions[0]?.steps[0]?.attempts).toHaveLength(1);
    expect(result.jobs[0]?.job_executions[0]?.steps[0]?.attempts_truncated).toBe(true);
    expect(result.jobs[0]?.job_executions[0]?.steps[0]?.attempts_total_count).toBe(2);
    expect(result.jobs[0]?.key).toBe('job-1');
    expect(result.jobs[0]?.job_executions[0]?.sequence).toBe(2);
    expect(result.jobs[0]?.job_executions[0]?.steps[0]?.position).toBe(1);
    expect(result.jobs[0]?.job_executions[0]?.steps[0]?.attempts[0]?.attempt).toBe(2);
    expect(serializedAgentAccessEnvelopeByteLength(response)).toBeLessThanOrEqual(128 * 1024);
    expect(getWorkflowRunResultSchema.safeParse(result).success).toBe(true);
  });

  test('stops structural reduction after the first fitting stage', async () => {
    const mocks = clients();
    const jobs = Array.from({length: 3}, (_, jobIndex) => ({
      ...sourceJob(jobIndex + 1),
      job_executions: [
        {
          ...sourceExecution(jobIndex + 1),
          steps: Array.from({length: 21}, (_, stepIndex) => ({
            ...sourceStep(jobIndex * 100 + stepIndex + 1),
            name: 'step '.concat('x'.repeat(512)),
            attempts: [
              {...sourceAttempt(1), restart_feedback: 'feedback '.concat('x'.repeat(512))},
              {...sourceAttempt(2), restart_feedback: 'feedback '.concat('x'.repeat(512))},
            ],
          })),
        },
      ],
    }));
    mocks.workflows.getWorkflowRunDetail.mockResolvedValue({run: workflowRun({jobs})});

    const response = await tool(mocks, 'get_workflow_run').execute({
      context,
      arguments: {run_id: runId, attempt: 1},
    });
    const result = expectSuccess<WorkflowRunResult>(response);
    const execution = result.jobs[0]?.job_executions[0];
    const step = execution?.steps[0];

    expect(response).toMatchObject({ok: true, response_truncated: true});
    expect(result.jobs).toHaveLength(3);
    expect(result).not.toHaveProperty('jobs_truncated');
    expect(result.jobs[0]?.job_executions).toHaveLength(1);
    expect(result.jobs[0]).not.toHaveProperty('job_executions_truncated');
    expect(execution?.steps).toHaveLength(21);
    expect(execution).not.toHaveProperty('steps_truncated');
    expect(step?.attempts).toHaveLength(1);
    expect(step?.attempts_truncated).toBe(true);
    expect(serializedAgentAccessEnvelopeByteLength(response)).toBeLessThanOrEqual(128 * 1024);
  });

  test('caps step configs and evaluation traces as serialized, inert data', async () => {
    const mocks = clients();
    mocks.workflows.getLatestStepAttempt.mockResolvedValue({attempt: 3});
    mocks.workflows.getStepAttemptDetail.mockResolvedValue({
      detail: {
        step_id: stepId,
        attempt: 3,
        authored_config: {prompt: '🙂'.repeat(20_000)},
        config: {resolved: '🙂'.repeat(20_000)},
        session: {id: uuid(20), key: 'session', mode: 'resume', segment: 1},
        evaluation_trace: Array.from({length: 55}, (_, index) => ({
          expression: 'expression '.concat('🙂'.repeat(400)),
          roots: Array.from({length: 12}, (_, rootIndex) => `root-${rootIndex}`),
          fill_target: 'target',
          evaluated_at: isoDate,
          field: `field-${index}`,
          value: 'trace value'.repeat(200),
          reference: true,
        })),
      },
    });

    const response = await tool(mocks, 'get_step_attempt').execute({
      context,
      arguments: {step_id: stepId},
    });
    const result = expectSuccess<StepAttemptResult>(response);

    expect(mocks.workflows.getLatestStepAttempt).toHaveBeenCalledWith({
      workspaceId,
      stepId,
    });
    expect(mocks.workflows.getStepAttemptDetail).toHaveBeenCalledWith({
      workspaceId,
      stepId,
      attempt: 3,
    });
    expect(result).not.toHaveProperty('session');
    expect(result.authored_config_truncated).toBe(true);
    expect(result.config_truncated).toBe(true);
    expect(result.evaluation_trace_truncated).toBe(true);
    expect(result.evaluation_trace_dropped).toBe(5);
    expect(result.evaluation_trace).toHaveLength(51);
    expect(new TextEncoder().encode(result.authored_config).byteLength).toBeLessThanOrEqual(
      16 * 1024,
    );
    expect(new TextEncoder().encode(result.config).byteLength).toBeLessThanOrEqual(16 * 1024);
    expect(() => JSON.parse(result.authored_config)).not.toThrow();
    expect(() => JSON.parse(result.config)).not.toThrow();
    expect(getStepAttemptResultSchema.safeParse(result).success).toBe(true);
    expect(serializedAgentAccessEnvelopeByteLength(response)).toBeLessThanOrEqual(128 * 1024);
  });

  test('aggregates an existing evaluation-trace truncation marker', async () => {
    const mocks = clients();
    mocks.workflows.getStepAttemptDetail.mockResolvedValue({
      detail: {
        step_id: stepId,
        attempt: 1,
        authored_config: null,
        config: {},
        session: null,
        evaluation_trace: [
          {truncated: true, dropped: 7},
          ...Array.from({length: 51}, (_, index) => ({
            expression: `expression-${index}`,
            roots: [],
            fill_target: 'target',
            evaluated_at: isoDate,
            field: 'field',
          })),
        ],
      },
    });

    const response = await tool(mocks, 'get_step_attempt').execute({
      context,
      arguments: {step_id: stepId, attempt: 1},
    });
    const result = expectSuccess<StepAttemptResult>(response);
    const marker = result.evaluation_trace?.at(-1);

    expect(result.evaluation_trace).toHaveLength(51);
    expect(marker).toEqual({truncated: true, dropped: 8});
    expect(result.evaluation_trace_dropped).toBe(8);
    expect(getStepAttemptResultSchema.safeParse(result).success).toBe(true);
  });

  test('preserves runner error phases, configuration issues, and gate diagnostics', async () => {
    const mocks = clients();
    const step = {
      ...sourceStep(1),
      error: {
        message: 'provider is not configured',
        code: 'runner.config',
        reason: 'agent_config_invalid',
        agent_config_issue: 'provider_not_configured',
        category: 'setup',
      },
      attempts: [
        {
          ...sourceAttempt(1),
          gate_result: {
            kind: 'uncheckable',
            passed: false,
            uncheckable: true,
            reason: 'gate could not be evaluated',
            exit_code: 1,
          },
        },
      ],
    };
    mocks.workflows.getWorkflowRunDetail.mockResolvedValue({
      run: workflowRun({
        jobs: [
          {
            ...sourceJob(1),
            job_executions: [
              {
                ...sourceExecution(1),
                steps: [
                  step,
                  {
                    ...sourceStep(2),
                    attempts: [
                      {
                        ...sourceAttempt(2),
                        gate_result: {kind: 'unknown', data: {diagnostic: 'value'}},
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    });

    const response = await tool(mocks, 'get_workflow_run').execute({
      context,
      arguments: {run_id: runId, attempt: 1},
    });
    const result = expectSuccess<WorkflowRunResult>(response);
    const projectedStep = result.jobs[0]?.job_executions[0]?.steps[0];
    const projectedAttempt = projectedStep?.attempts[0];

    expect(projectedStep?.error).toMatchObject({
      code: 'runner.config',
      reason: 'agent_config_invalid',
      agent_config_issue: 'provider_not_configured',
      category: 'setup',
    });
    expect(projectedAttempt?.gate_result).toEqual({
      kind: 'uncheckable',
      passed: false,
      uncheckable: true,
      reason: 'gate could not be evaluated',
      exit_code: 1,
    });
    expect(projectedStep?.attempts).toHaveLength(1);
    expect(projectedStep?.attempts[0]?.gate_result).toEqual({
      kind: 'uncheckable',
      passed: false,
      uncheckable: true,
      reason: 'gate could not be evaluated',
      exit_code: 1,
    });
    expect(result.jobs[0]?.job_executions[0]?.steps[1]?.attempts[0]?.gate_result).toEqual({
      kind: 'unknown',
      diagnostic: JSON.stringify({diagnostic: 'value'}),
    });
    expect(getWorkflowRunResultSchema.safeParse(result).success).toBe(true);
  });

  test('bounds runner labels and dependencies without changing their ordering', async () => {
    const mocks = clients();
    mocks.workflows.getWorkflowRunDetail.mockResolvedValue({
      run: workflowRun({
        jobs: [
          {
            ...sourceJob(1),
            runner: Array.from({length: 12}, (_, index) =>
              `runner-${index}-`.concat('🙂'.repeat(200)),
            ),
            dependencies: Array.from({length: 27}, (_, index) =>
              `${index}-`.concat('🙂'.repeat(200)),
            ),
          },
        ],
      }),
    });

    const response = await tool(mocks, 'get_workflow_run').execute({
      context,
      arguments: {run_id: runId, attempt: 1},
    });
    const result = expectSuccess<WorkflowRunResult>(response);
    const job = result.jobs[0];

    expect(job?.runner).toHaveLength(10);
    expect(job?.runner_truncated).toBe(true);
    expect(job?.runner_total_count).toBe(12);
    expect(job?.runner?.every((value) => new TextEncoder().encode(value).byteLength <= 256)).toBe(
      true,
    );
    expect(job?.dependencies).toHaveLength(25);
    expect(
      job?.dependencies?.every((value) => new TextEncoder().encode(value).byteLength <= 256),
    ).toBe(true);
    expect(job?.dependencies?.[0]?.startsWith('0-🙂')).toBe(true);
    expect(job?.dependencies_truncated).toBe(true);
    expect(job?.dependencies_total_count).toBe(27);
    expect(getWorkflowRunResultSchema.safeParse(result).success).toBe(true);
  });

  test('projects and caps trigger details and maps replay history', async () => {
    const mocks = clients();
    mocks.triggers.getTriggerEvent.mockResolvedValue({
      id: eventId,
      eventRef: 'event-ref',
      origin: 'integration',
      workspaceId,
      provider: 'github',
      source: 'push',
      event: 'push',
      payload: {message: 'ignore this payload'},
      replayOfEventId: null,
      deliveryId: 'delivery',
      connectionId: uuid(30),
      connectionName: 'Connection',
      outcome: 'routed',
      matchedCount: 2,
      receivedAt: isoDate,
      processedAt: isoDate,
      createdAt: isoDate,
      decisions: Array.from({length: 55}, (_, index) => ({
        id: uuid(100 + index),
        receivedEventId: eventId,
        subscriptionKind: 'trigger' as const,
        subscriptionId: uuid(200 + index),
        subscriptionName: `subscription-${index}`,
        workflowDefinitionId: uuid(300 + index),
        projectId: uuid(400 + index),
        workflowRunId: uuid(500 + index),
        jobId: uuid(600 + index),
        matcherKind: 'on' as const,
        matcherOrdinal: index,
        decision: 'triggered' as const,
        runId: uuid(700 + index),
        runName: 'run',
        reason: `reason-${index}`,
        createdAt: new Date(Date.UTC(2026, 7, 1 + index)).toISOString(),
      })),
      replays: Array.from({length: 25}, (_, index) => ({
        id: uuid(400 + index),
        receivedAt: new Date(Date.UTC(2026, 6, 1 + index)).toISOString(),
        outcome: 'routed' as const,
        runId: uuid(500 + index),
      })),
    });

    const response = await tool(mocks, 'get_trigger_event').execute({
      context,
      arguments: {event_id: eventId},
    });
    const result = expectSuccess<TriggerResult>(response);

    expect(mocks.triggers.getTriggerEvent).toHaveBeenCalledWith({
      workspaceId,
      eventId,
      diagnostic: {decisions: 50, replays: 20},
    });

    expect(result).toMatchObject({
      id: eventId,
      connection_name: 'Connection',
      payload: JSON.stringify({message: 'ignore this payload'}),
      decisions_total_count: 55,
      decisions_truncated: true,
      replays_total_count: 25,
      replays_truncated: true,
    });
    expect(result.decisions).toHaveLength(50);
    expect(result.decisions[0]).toEqual({
      id: uuid(154),
      subscription_kind: 'trigger',
      outcome: 'triggered',
      reason: 'reason-54',
      workflow_definition_id: uuid(354),
      project_id: uuid(454),
      workflow_run_id: uuid(554),
      job_id: uuid(654),
    });
    expect(result.replays).toHaveLength(20);
    expect(result.replays[0]).toMatchObject({
      id: uuid(424),
      workflow_run_id: uuid(524),
    });
    expect(result).not.toHaveProperty('event_ref');
    expect(result).not.toHaveProperty('delivery_id');
    expect(getTriggerEventResultSchema.safeParse(result).success).toBe(true);
  });

  test('caps facet discovery and returns schema-valid not-found errors', async () => {
    const mocks = clients();
    mocks.triggers.getTriggerEventFacets.mockResolvedValue({
      sources: Array.from({length: 60}, (_, index) => ({value: '🙂'.repeat(200), count: index})),
      events: [{value: 'push', count: 3}],
      origins: [{value: 'integration', count: 3}],
    });

    const facetsResponse = await tool(mocks, 'get_trigger_event_facets').execute({
      context,
      arguments: {},
    });
    const facets = expectSuccess<FacetsResult>(facetsResponse);

    expect(mocks.triggers.getTriggerEventFacets).toHaveBeenCalledWith({workspaceId});
    expect(facets.sources).toHaveLength(50);
    expect(new TextEncoder().encode(facets.sources[0]?.value ?? '').byteLength).toBe(256);
    expect(getTriggerEventFacetsResultSchema.safeParse(facets).success).toBe(true);

    mocks.workflows.getLatestRunAttempt.mockResolvedValue({attempt: null});
    const notFound = await tool(mocks, 'get_workflow_run').execute({
      context,
      arguments: {run_id: runId},
    });

    expect(notFound).toEqual({ok: false, error: {code: 'not-found'}});
    expect(agentAccessEnvelopeSchema.safeParse(notFound).success).toBe(true);
    expect(mocks.workflows.getWorkflowRunDetail).not.toHaveBeenCalled();
  });

  test('returns not-found without a detail read when the latest step attempt is absent', async () => {
    const mocks = clients();
    mocks.workflows.getLatestStepAttempt.mockResolvedValue({attempt: null});

    const response = await tool(mocks, 'get_step_attempt').execute({
      context,
      arguments: {step_id: stepId},
    });

    expect(response).toEqual({ok: false, error: {code: 'not-found'}});
    expect(mocks.workflows.getStepAttemptDetail).not.toHaveBeenCalled();
  });

  test('returns not-found when the selected step attempt detail is absent', async () => {
    const mocks = clients();
    mocks.workflows.getStepAttemptDetail.mockResolvedValue({detail: null});

    const response = await tool(mocks, 'get_step_attempt').execute({
      context,
      arguments: {step_id: stepId, attempt: 2},
    });

    expect(response).toEqual({ok: false, error: {code: 'not-found'}});
    expect(mocks.workflows.getStepAttemptDetail).toHaveBeenCalledWith({
      workspaceId,
      stepId,
      attempt: 2,
    });
  });

  test('accepts the maximum valid attempt without changing producer inputs', async () => {
    const mocks = clients();
    const attempt = 2_147_483_647;
    mocks.workflows.getWorkflowRunDetail.mockResolvedValue({
      run: workflowRun({run_attempt: {...workflowRun().run_attempt, attempt}}),
    });

    const response = await tool(mocks, 'get_workflow_run').execute({
      context,
      arguments: {run_id: runId, attempt},
    });

    expect(response.ok).toBe(true);
    expect(mocks.workflows.getLatestRunAttempt).not.toHaveBeenCalled();
    expect(mocks.workflows.getWorkflowRunDetail).toHaveBeenCalledWith({
      workspaceId,
      workflowRunId: runId,
      attempt,
      diagnostic: {jobs: 10, executions: 1, steps: 20, attempts: 1},
    });
  });

  test('rejects malformed identifiers and attempts before calling producers', async () => {
    const mocks = clients();
    const workflowTool = tool(mocks, 'get_workflow_run');
    const stepTool = tool(mocks, 'get_step_attempt');

    await expect(
      workflowTool.execute({context, arguments: {run_id: 'not-a-uuid', attempt: 1}}),
    ).resolves.toEqual({ok: false, error: {code: 'invalid-request'}});
    await expect(
      workflowTool.execute({context, arguments: {run_id: runId, attempt: 0}}),
    ).resolves.toEqual({ok: false, error: {code: 'invalid-request'}});
    await expect(
      workflowTool.execute({context, arguments: {run_id: runId, unexpected: true}}),
    ).resolves.toEqual({ok: false, error: {code: 'invalid-request'}});
    await expect(stepTool.execute({context, arguments: {step_id: 'not-a-uuid'}})).resolves.toEqual({
      ok: false,
      error: {code: 'invalid-request'},
    });
    await expect(
      stepTool.execute({context, arguments: {step_id: stepId, attempt: 2_147_483_648}}),
    ).resolves.toEqual({ok: false, error: {code: 'invalid-request'}});
    await expect(
      stepTool.execute({context, arguments: {step_id: stepId, extra: true}}),
    ).resolves.toEqual({ok: false, error: {code: 'invalid-request'}});

    expect(mocks.workflows.getLatestRunAttempt).not.toHaveBeenCalled();
    expect(mocks.workflows.getLatestStepAttempt).not.toHaveBeenCalled();
    expect(mocks.workflows.getWorkflowRunDetail).not.toHaveBeenCalled();
  });

  test('projects dev-run provenance without exposing the source snapshot', async () => {
    const mocks = clients();
    mocks.workflows.getWorkflowRunDetail.mockResolvedValue({
      run: workflowRun({
        origin: 'dev',
        dev_source: {
          ref: 'refs/heads/feature',
          commit: '0123456789abcdef',
          config_path: '.shipfox/workflow.yml',
          initiated_by_user_id: uuid(600),
          replay_of_event_id: eventId,
        },
      }),
    });

    const response = await tool(mocks, 'get_workflow_run').execute({
      context,
      arguments: {run_id: runId, attempt: 1},
    });
    const result = expectSuccess<WorkflowRunResult>(response);

    expect(result.dev_source).toEqual({
      ref: 'refs/heads/feature',
      commit: '0123456789abcdef',
      config_path: '.shipfox/workflow.yml',
      initiated_by_user_id: uuid(600),
      replay_of_event_id: eventId,
    });
    expect(result).not.toHaveProperty('source_snapshot');
    expect(getWorkflowRunResultSchema.safeParse(result).success).toBe(true);
  });

  test('orders shuffled jobs and reports producer-provided status totals', async () => {
    const mocks = clients();
    mocks.workflows.getWorkflowRunDetail.mockResolvedValue({
      run: workflowRun({
        jobs: [
          {...sourceJob(3), position: 3, status: 'succeeded'},
          {...sourceJob(1), position: 1, status: 'failed'},
          {...sourceJob(2), position: 2, status: 'running'},
        ],
        job_status_counts: [
          {status: 'succeeded', count: 4},
          {status: 'failed', count: 2},
          {status: 'running', count: 1},
        ],
      }),
    });

    const response = await tool(mocks, 'get_workflow_run').execute({
      context,
      arguments: {run_id: runId, attempt: 1},
    });
    const result = expectSuccess<WorkflowRunResult>(response);

    expect(result.jobs.map((job) => job.key)).toEqual(['job-1', 'job-2', 'job-3']);
    expect(result.job_status_counts).toEqual([
      {status: 'running', count: 1},
      {status: 'succeeded', count: 4},
      {status: 'failed', count: 2},
    ]);
  });

  test('translates a trigger producer not-found error without leaking its details', async () => {
    const mocks = clients();
    mocks.triggers.getTriggerEvent.mockRejectedValue(
      createInterModuleKnownError(
        triggersInterModuleContract.methods.getTriggerEvent,
        'trigger-event-not-found',
        {eventId},
      ),
    );

    const response = await tool(mocks, 'get_trigger_event').execute({
      context,
      arguments: {event_id: eventId},
    });

    expect(response).toEqual({ok: false, error: {code: 'not-found'}});
  });
});

function clients() {
  return {
    workflows: {
      getLatestRunAttempt: vi.fn(),
      getWorkflowRunDetail: vi.fn(),
      getLatestStepAttempt: vi.fn(),
      getStepAttemptDetail: vi.fn(),
    } as unknown as WorkflowsModuleClient & {
      getLatestRunAttempt: ReturnType<typeof vi.fn>;
      getWorkflowRunDetail: ReturnType<typeof vi.fn>;
      getLatestStepAttempt: ReturnType<typeof vi.fn>;
      getStepAttemptDetail: ReturnType<typeof vi.fn>;
    },
    triggers: {
      getTriggerEvent: vi.fn(),
      getTriggerEventFacets: vi.fn(),
    } as unknown as TriggersInterModuleClient & {
      getTriggerEvent: ReturnType<typeof vi.fn>;
      getTriggerEventFacets: ReturnType<typeof vi.fn>;
    },
  };
}

function tool(mocks: ReturnType<typeof clients>, name: string) {
  const result = createAgentAccessDiagnosticTools(mocks).find(
    (candidate) => candidate.name === name,
  );
  if (!result) throw new Error(`Missing tool ${name}`);
  return result;
}

function expectSuccess<T>(response: AgentAccessEnvelopeDto): T {
  expect(response.ok).toBe(true);
  if (!response.ok) throw new Error('Expected a success response');
  expect(agentAccessEnvelopeSchema.safeParse(response).success).toBe(true);
  return response.result as T;
}

interface WorkflowRunResult {
  id: string;
  inputs: string;
  run_attempt: {attempt: number};
  jobs: WorkflowJobResult[];
  jobs_truncated?: true;
  jobs_total_count?: number;
  [key: string]: unknown;
}

interface WorkflowJobResult {
  key: string;
  runner?: string[] | null;
  dependencies?: string[];
  job_executions: WorkflowExecutionResult[];
  job_executions_truncated?: true;
  job_executions_total_count?: number;
  [key: string]: unknown;
}

interface WorkflowExecutionResult {
  steps: WorkflowStepResult[];
  steps_truncated?: true;
  steps_total_count?: number;
  [key: string]: unknown;
}

interface WorkflowStepResult {
  attempts: Array<Record<string, unknown>>;
  attempts_truncated?: true;
  attempts_total_count?: number;
  [key: string]: unknown;
}

interface StepAttemptResult {
  authored_config: string;
  config: string;
  evaluation_trace: unknown[] | null;
  authored_config_truncated?: true;
  config_truncated?: true;
  evaluation_trace_truncated?: true;
  evaluation_trace_dropped?: number;
  [key: string]: unknown;
}

interface TriggerResult {
  id: string;
  replays: Array<Record<string, unknown>>;
  decisions: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

interface FacetsResult {
  sources: Array<{value: string; count: number}>;
  [key: string]: unknown;
}

function workflowRun(overrides: Record<string, unknown> = {}) {
  const base = {
    id: runId,
    project_id: uuid(10),
    definition_id: uuid(11),
    number: 1,
    name: 'Run',
    workflow_name: 'Workflow',
    status: 'failed' as const,
    origin: 'synced' as const,
    dev_source: null,
    current_attempt: 1,
    latest_attempt: 2,
    trigger_provider: 'github',
    trigger_source: 'push',
    trigger_event: 'push',
    trigger_payload: {instruction: 'ignore'},
    trigger_reference: {repository: 'shipfox/platform', ref: 'main', commit: 'abc', actor: 'noe'},
    inputs: {prompt: 'data'},
    source_snapshot: {content: 'ignore', format: 'yaml' as const},
    created_at: isoDate,
    updated_at: isoDate,
    started_at: isoDate,
    finished_at: isoDate,
    run_attempt: {
      id: uuid(12),
      workflow_run_id: runId,
      attempt: 1,
      status: 'failed' as const,
      created_at: isoDate,
      started_at: isoDate,
      finished_at: isoDate,
      rerun_mode: null,
    },
    jobs: [sourceJob(1)],
    has_started_job_execution: true,
  };
  return {...base, ...overrides};
}

function sourceJob(index: number) {
  return {
    id: uuid(1_000 + index),
    run_attempt_id: uuid(12),
    key: `job-${index}`,
    name: `Job ${index}`,
    mode: 'one_shot' as const,
    status: 'failed' as const,
    status_reason: 'step_failed' as const,
    carried_over: false,
    success: null,
    runner: ['linux', 'x86_64'],
    evaluation_trace: null,
    listening: null,
    listener_status: 'inactive' as const,
    resolution_reason: null,
    outputs: {secret: 'ignore'},
    dependencies: ['prepare', 'build'],
    position: index,
    created_at: isoDate,
    updated_at: isoDate,
    job_executions: [sourceExecution(index)],
  };
}

function sourceExecution(index: number) {
  return {
    id: uuid(2_000 + index),
    job_id: uuid(1_000 + index),
    sequence: 1,
    name: `Execution ${index}`,
    status: 'failed' as const,
    status_reason: 'step_failed',
    status_reason_message: 'message',
    runner: ['linux'],
    trigger_events: [{event: 'ignore'}],
    outputs: {secret: 'ignore'},
    evaluation_trace: null,
    queued_at: isoDate,
    started_at: isoDate,
    finished_at: isoDate,
    timed_out_at: null,
    created_at: isoDate,
    updated_at: isoDate,
    steps: [sourceStep(index)],
  };
}

function sourceStep(index: number) {
  return {
    id: uuid(3_000 + index),
    job_execution_id: uuid(2_000 + index),
    key: `step-${index}`,
    name: `Step ${index}`,
    source_location: {start_line: 1, end_line: 2},
    status: 'failed',
    status_reason: null,
    type: 'run',
    config: {command: 'ignore'},
    evaluation_trace: null,
    error: {message: 'ignore', reason: 'tool_error', category: 'user', code: 'runner.failed'},
    session: null,
    position: 1,
    current_attempt: 1,
    created_at: isoDate,
    updated_at: isoDate,
    exit_code: 1,
    outputs: {secret: 'ignore'},
    response: 'ignore',
    gate_result: {kind: 'passed' as const, passed: true as const, source: 'exit 0', exit_code: 0},
    attempts: [sourceAttempt(1)],
  };
}

function sourceAttempt(attempt: number) {
  return {
    id: uuid(4_000 + attempt),
    step_id: uuid(3_000 + attempt),
    attempt,
    execution_order: attempt,
    status: 'failed',
    exit_code: 1,
    output: {secret: 'ignore'},
    outputs: {secret: 'ignore'},
    response: 'ignore',
    error: {message: 'ignore'},
    gate_result: {kind: 'passed' as const, passed: true as const, source: 'exit 0', exit_code: 0},
    restart_feedback: 'restart feedback',
    invocations: [],
    started_at: isoDate,
    finished_at: isoDate,
  };
}

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}
