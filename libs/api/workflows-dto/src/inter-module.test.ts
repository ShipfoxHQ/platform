import {
  WORKFLOW_EXECUTION_TRIGGER_EVENT_PAGE_LIMIT,
  WORKFLOW_JOB_EXECUTION_PAGE_LIMIT,
  WORKFLOW_JOB_STEP_PAGE_LIMIT,
  WORKFLOW_RUN_ANNOTATIONS_PAGE_LIMIT,
  WORKFLOW_RUN_FAILED_STEP_ATTEMPT_LIMIT,
  WORKFLOW_RUN_JOB_EXPLANATIONS_PAGE_LIMIT,
  WORKFLOW_RUN_OVERVIEW_LARGE_JOB_PAGE_LIMIT,
  WORKFLOW_STEP_ATTEMPT_PAGE_LIMIT,
} from './index.js';
import {workflowsInterModuleContract} from './inter-module.js';

describe('workflowsInterModuleContract', () => {
  test('accepts workspace-scoped execution reads with decoded cursors and filters', () => {
    const workflowRunId = '00000000-0000-4000-8000-000000000001';
    const stepId = '00000000-0000-4000-8000-000000000002';
    const workspaceId = '00000000-0000-4000-8000-000000000003';
    const cursor = {
      createdAt: '2026-08-31T12:00:00.000Z',
      id: '00000000-0000-4000-8000-000000000004',
    };

    const runs = workflowsInterModuleContract.methods.listWorkflowRuns.input.parse({
      workspaceId,
      projectId: '00000000-0000-4000-8000-000000000005',
      limit: 50,
      cursor,
      filters: {
        status: 'failed',
        definitionId: '00000000-0000-4000-8000-000000000006',
        origin: 'dev',
        createdFrom: '2026-08-01T00:00:00.000Z',
        createdTo: '2026-08-31T00:00:00.000Z',
      },
    });
    const detail = workflowsInterModuleContract.methods.getWorkflowRunDetail.input.parse({
      workspaceId,
      workflowRunId,
      attempt: 2,
    });
    const step = workflowsInterModuleContract.methods.getStepAttemptDetail.input.parse({
      workspaceId,
      stepId,
      attempt: 1,
    });

    expect(runs.cursor).toEqual(cursor);
    expect(runs.filters?.status).toBe('failed');
    expect(detail.attempt).toBe(2);
    expect(step.stepId).toBe(stepId);
  });

  test('keeps missing execution reads nullable and bounds latest-attempt inputs', () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const nullRun = workflowsInterModuleContract.methods.getWorkflowRunDetail.output.parse({
      run: null,
    });
    const nullStep = workflowsInterModuleContract.methods.getStepAttemptDetail.output.parse({
      detail: null,
    });
    const latestRun = workflowsInterModuleContract.methods.getLatestRunAttempt.output.parse({
      attempt: null,
    });
    const latestStep = workflowsInterModuleContract.methods.getLatestStepAttempt.output.parse({
      attempt: 3,
    });

    expect(nullRun).toEqual({run: null});
    expect(nullStep).toEqual({detail: null});
    expect(latestRun).toEqual({attempt: null});
    expect(latestStep).toEqual({attempt: 3});
    expect(
      workflowsInterModuleContract.methods.getLatestRunAttempt.input.safeParse({
        workspaceId,
        workflowRunId: 'not-a-uuid',
      }).success,
    ).toBe(false);
  });

  test('defines bounded nullable workflow diagnostic reads with deterministic defaults', () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const workflowRunId = '00000000-0000-4000-8000-000000000002';
    const jobId = '00000000-0000-4000-8000-000000000003';
    const executionId = '00000000-0000-4000-8000-000000000004';
    const stepId = '00000000-0000-4000-8000-000000000005';

    expect(
      workflowsInterModuleContract.methods.getWorkflowRunOverview.input.parse({
        workspaceId,
        workflowRunId,
      }),
    ).toEqual({workspaceId, workflowRunId});
    expect(
      workflowsInterModuleContract.methods.listWorkflowRunAttempts.input.parse({
        workspaceId,
        workflowRunId,
      }).limit,
    ).toBe(25);
    expect(
      workflowsInterModuleContract.methods.listWorkflowRunJobs.input.parse({
        workspaceId,
        workflowRunId,
      }).limit,
    ).toBe(WORKFLOW_RUN_OVERVIEW_LARGE_JOB_PAGE_LIMIT);
    expect(
      workflowsInterModuleContract.methods.listWorkflowJobExecutions.input.parse({
        workspaceId,
        jobId,
      }).limit,
    ).toBe(WORKFLOW_JOB_EXECUTION_PAGE_LIMIT);
    expect(
      workflowsInterModuleContract.methods.listWorkflowExecutionSteps.input.parse({
        workspaceId,
        jobId,
        executionId,
      }).limit,
    ).toBe(WORKFLOW_JOB_STEP_PAGE_LIMIT);
    expect(
      workflowsInterModuleContract.methods.listWorkflowStepAttempts.input.parse({
        workspaceId,
        stepId,
      }).limit,
    ).toBe(WORKFLOW_STEP_ATTEMPT_PAGE_LIMIT);
    expect(
      workflowsInterModuleContract.methods.listExecutionTriggerEvents.input.parse({
        workspaceId,
        jobId,
        executionId,
      }).limit,
    ).toBe(WORKFLOW_EXECUTION_TRIGGER_EVENT_PAGE_LIMIT);
    expect(
      workflowsInterModuleContract.methods.listWorkflowRunAnnotations.input.parse({
        workspaceId,
        workflowRunId,
      }).limit,
    ).toBe(WORKFLOW_RUN_ANNOTATIONS_PAGE_LIMIT);
    expect(
      workflowsInterModuleContract.methods.listWorkflowRunJobExplanations.input.parse({
        workspaceId,
        workflowRunId,
      }).limit,
    ).toBe(WORKFLOW_RUN_JOB_EXPLANATIONS_PAGE_LIMIT);
    expect(
      workflowsInterModuleContract.methods.listFailedStepAttempts.input.parse({
        workspaceId,
        workflowRunId,
      }).limit,
    ).toBe(WORKFLOW_RUN_FAILED_STEP_ATTEMPT_LIMIT);

    for (const method of [
      workflowsInterModuleContract.methods.getWorkflowRunOverview,
      workflowsInterModuleContract.methods.listWorkflowRunAttempts,
      workflowsInterModuleContract.methods.listWorkflowRunJobs,
      workflowsInterModuleContract.methods.getWorkflowJobDetail,
      workflowsInterModuleContract.methods.listWorkflowJobExecutions,
      workflowsInterModuleContract.methods.listWorkflowExecutionSteps,
      workflowsInterModuleContract.methods.listWorkflowStepAttempts,
      workflowsInterModuleContract.methods.getWorkflowRunSource,
      workflowsInterModuleContract.methods.getWorkflowJobExecutionContext,
      workflowsInterModuleContract.methods.listExecutionTriggerEvents,
      workflowsInterModuleContract.methods.getExecutionTriggerEvent,
      workflowsInterModuleContract.methods.getWorkflowStepAttemptDetail,
      workflowsInterModuleContract.methods.listWorkflowRunAnnotations,
      workflowsInterModuleContract.methods.listWorkflowRunJobExplanations,
      workflowsInterModuleContract.methods.listFailedStepAttempts,
    ]) {
      expect(method.output.parse(null)).toBeNull();
    }

    expect(
      workflowsInterModuleContract.methods.listWorkflowRunJobs.output.parse({
        workflow_run_attempt: 3,
        items: [],
        nextCursor: null,
      }),
    ).toEqual({workflow_run_attempt: 3, items: [], nextCursor: null});
    expect(
      workflowsInterModuleContract.methods.listWorkflowRunAnnotations.output.parse({
        workflow_run_attempt: 3,
        items: [],
        nextCursor: null,
      }),
    ).toEqual({workflow_run_attempt: 3, items: [], nextCursor: null});
    expect(
      workflowsInterModuleContract.methods.listWorkflowRunJobExplanations.output.parse({
        workflow_run_attempt: 3,
        items: [],
        nextCursor: null,
      }),
    ).toEqual({workflow_run_attempt: 3, items: [], nextCursor: null});
    expect(
      workflowsInterModuleContract.methods.listFailedStepAttempts.output.parse({
        workflow_run_attempt: 3,
        items: [],
      }),
    ).toEqual({workflow_run_attempt: 3, items: []});
    expect(
      workflowsInterModuleContract.methods.listExecutionTriggerEvents.output.parse({
        items: [
          {
            event_ref: 'event-1',
            delivery_id: 'delivery-1',
            source: 'github',
            event: 'push',
            disposition: 'fire',
            outcome: 'consumed',
            outcome_reason: null,
            received_at: '2026-08-31T12:00:00.000Z',
            stored_payload_bytes: 32,
            normalized_event_bytes: 128,
          },
        ],
        nextCursor: null,
        total: 1,
      }),
    ).toMatchObject({items: [{event_ref: 'event-1'}], nextCursor: null, total: 1});
    expect(
      workflowsInterModuleContract.methods.getExecutionTriggerEvent.output.parse({
        event_ref: 'event-1',
        delivery_id: 'delivery-1',
        source: 'github',
        event: 'push',
        disposition: 'fire',
        outcome: 'consumed',
        outcome_reason: null,
        received_at: '2026-08-31T12:00:00.000Z',
        stored_payload_bytes: 32,
        normalized_event_bytes: 128,
        payload_preview: '{"action":"opened"}',
      }),
    ).toMatchObject({payload_preview: '{"action":"opened"}'});
  });

  test('rejects page limits outside the producer-owned bounds', () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const workflowRunId = '00000000-0000-4000-8000-000000000002';
    const jobId = '00000000-0000-4000-8000-000000000003';
    const executionId = '00000000-0000-4000-8000-000000000004';

    expect(
      workflowsInterModuleContract.methods.listWorkflowRunJobs.input.safeParse({
        workspaceId,
        workflowRunId,
        limit: 101,
      }).success,
    ).toBe(false);
    expect(
      workflowsInterModuleContract.methods.listWorkflowJobExecutions.input.safeParse({
        workspaceId,
        jobId,
        limit: 0,
      }).success,
    ).toBe(false);
    expect(
      workflowsInterModuleContract.methods.listExecutionTriggerEvents.input.safeParse({
        workspaceId,
        jobId,
        executionId,
        limit: 101,
      }).success,
    ).toBe(false);
    expect(
      workflowsInterModuleContract.methods.listFailedStepAttempts.input.safeParse({
        workspaceId,
        workflowRunId,
        limit: 11,
      }).success,
    ).toBe(false);
  });

  test('preserves the run-list date-window validation', () => {
    expect(
      workflowsInterModuleContract.methods.listWorkflowRuns.input.safeParse({
        workspaceId: '00000000-0000-4000-8000-000000000001',
        projectId: '00000000-0000-4000-8000-000000000002',
        limit: 50,
        filters: {
          createdFrom: '2025-01-01T00:00:00.000Z',
          createdTo: '2026-08-31T00:00:00.000Z',
        },
      }).success,
    ).toBe(false);
  });

  test('accepts trigger commands and listener deliveries', () => {
    const start = workflowsInterModuleContract.methods.startRunFromTrigger.input.parse({
      workspaceId: '00000000-0000-4000-8000-000000000001',
      projectId: '00000000-0000-4000-8000-000000000002',
      definitionId: '00000000-0000-4000-8000-000000000003',
      triggerPayload: {
        provider: 'github',
        source: 'github',
        event: 'push',
        deliveryId: 'delivery-1',
        data: {ref: 'refs/heads/main'},
      },
      triggerConnectionId: '00000000-0000-4000-8000-000000000005',
      idempotencyKey: 'subscription-1:event-1',
    });
    const delivery = workflowsInterModuleContract.methods.deliverEventToJobListener.input.parse({
      jobId: '00000000-0000-4000-8000-000000000004',
      disposition: 'fire',
      eventRef: 'event-1',
      deliveryId: 'delivery-1',
      source: 'github',
      event: 'push',
      provider: 'github',
      triggerConnectionId: '00000000-0000-4000-8000-000000000005',
      payload: {ref: 'refs/heads/main'},
      receivedAt: '2026-07-20T12:00:00.000Z',
    });
    const reference =
      workflowsInterModuleContract.methods.resolveWorkflowRunTriggerReference.input.parse({
        workspaceId: '00000000-0000-4000-8000-000000000001',
        triggerConnectionId: '00000000-0000-4000-8000-000000000005',
        triggerPayload: {
          provider: 'github',
          source: 'github',
          event: 'push',
          deliveryId: 'delivery-1',
          data: {ref: 'refs/heads/main'},
        },
      });

    expect(start.idempotencyKey).toBe('subscription-1:event-1');
    expect(start.triggerConnectionId).toBe('00000000-0000-4000-8000-000000000005');
    expect(delivery.disposition).toBe('fire');
    expect(reference.triggerConnectionId).toBe('00000000-0000-4000-8000-000000000005');
    expect(delivery.triggerConnectionId).toBe('00000000-0000-4000-8000-000000000005');
  });

  test('accepts the minimal Logs and agent-tools query payloads', () => {
    const stepId = '00000000-0000-4000-8000-000000000006';
    const logContext = workflowsInterModuleContract.methods.getStepLogContext.input.parse({stepId});
    const jobAttempts = workflowsInterModuleContract.methods.listJobStepAttempts.input.parse({
      jobId: '00000000-0000-4000-8000-000000000010',
    });
    const agentTools = workflowsInterModuleContract.methods.getLeasedAgentToolContext.input.parse({
      jobId: '00000000-0000-4000-8000-000000000007',
      jobExecutionId: '00000000-0000-4000-8000-000000000008',
      runnerSessionId: '00000000-0000-4000-8000-000000000009',
      stepId,
      attempt: 1,
    });

    expect(logContext).toEqual({stepId});
    expect(jobAttempts).toEqual({jobId: '00000000-0000-4000-8000-000000000010'});
    expect(agentTools.attempt).toBe(1);
  });

  test('accepts the session transcript lease context payload', () => {
    const sessionContext =
      workflowsInterModuleContract.methods.getLeasedAgentSessionContext.input.parse({
        jobId: '00000000-0000-4000-8000-000000000007',
        jobExecutionId: '00000000-0000-4000-8000-000000000008',
        runnerSessionId: '00000000-0000-4000-8000-000000000009',
        stepId: '00000000-0000-4000-8000-000000000006',
        attempt: 1,
      });

    expect(sessionContext.attempt).toBe(1);
  });

  test.each([
    ['workspace-not-found', {workspaceId: '00000000-0000-4000-8000-000000000010'}],
    ['workspace-suspended', {workspaceId: '00000000-0000-4000-8000-000000000010'}],
    ['workspace-deleted', {workspaceId: '00000000-0000-4000-8000-000000000010'}],
    ['definition-not-found', {definitionId: '00000000-0000-4000-8000-000000000001'}],
    ['project-mismatch', {}],
    ['agent-config-unresolvable', {definitionId: '00000000-0000-4000-8000-000000000001'}],
    ['agent-integration-materialization-failed', {}],
    [
      'interpolation-unresolvable',
      {
        definitionId: '00000000-0000-4000-8000-000000000001',
        field: 'env',
        source: 'event.ref',
        envKey: 'REF',
      },
    ],
    ['invalid-job-runner-labels', {labels: ['linux', 'gpu']}],
    [
      'workflow-execution-payload-too-large',
      {
        field: 'resolved_config',
        limitBytes: 868_928,
        measuredBytes: 900_000,
        overshootBytes: 31_072,
      },
    ],
  ] as const)('defines the %s start-run failure', (code, details) => {
    const schema = workflowsInterModuleContract.methods.startRunFromTrigger.errors[code];
    const parsed = schema.parse(details);

    expect(parsed).toEqual(details);
  });

  const devInput = {
    workspaceId: '00000000-0000-4000-8000-000000000001',
    projectId: '00000000-0000-4000-8000-000000000002',
    workflowId: '00000000-0000-4000-8000-000000000003',
    model: {
      version: 3 as const,
      model: {
        kind: 'workflow' as const,
        name: 'Dev Workflow',
        triggers: [],
        jobs: [],
        dependencies: [],
      },
    },
    sourceSnapshot: {content: 'name: Dev Workflow\njobs: {}\n', format: 'yaml' as const},
    devSource: {
      ref: 'fix-triage-prompt',
      commit: 'a'.repeat(40),
      configPath: '.shipfox/workflows/triage-sentry.yml',
      initiatedByUserId: '00000000-0000-4000-8000-000000000004',
    },
    triggerPayload: {
      source: 'manual' as const,
      event: 'fire' as const,
      userId: '00000000-0000-4000-8000-000000000005',
    },
  };

  test('accepts a dev run command with a manual payload that has no subscription id', () => {
    const start = workflowsInterModuleContract.methods.startDevRun.input.parse(devInput);

    expect(start.workflowId).toBe(devInput.workflowId);
    expect(start.devSource).toEqual({...devInput.devSource, replayOfEventId: undefined});
    expect(start.triggerPayload).toEqual(devInput.triggerPayload);
  });

  test('accepts a dev run command with a replay id, connection, inputs, and a cron payload without a schedule id', () => {
    const start = workflowsInterModuleContract.methods.startDevRun.input.parse({
      ...devInput,
      devSource: {
        ...devInput.devSource,
        replayOfEventId: '00000000-0000-4000-8000-000000000006',
      },
      triggerConnectionId: '00000000-0000-4000-8000-000000000007',
      triggerPayload: {source: 'cron' as const, event: 'tick' as const},
      inputs: {env: 'staging'},
    });

    expect(start.devSource.replayOfEventId).toBe('00000000-0000-4000-8000-000000000006');
    expect(start.triggerConnectionId).toBe('00000000-0000-4000-8000-000000000007');
    expect(start.inputs).toEqual({env: 'staging'});
  });

  test('rejects a dev run command with an invalid replay event id', () => {
    expect(
      workflowsInterModuleContract.methods.startDevRun.input.safeParse({
        ...devInput,
        devSource: {...devInput.devSource, replayOfEventId: 'not-a-uuid'},
      }).success,
    ).toBe(false);
  });

  test('keeps the manual subscription id and cron schedule id populated on start-run commands', () => {
    const manual = workflowsInterModuleContract.methods.startRunFromTrigger.input.parse({
      workspaceId: devInput.workspaceId,
      projectId: devInput.projectId,
      definitionId: devInput.workflowId,
      triggerPayload: {
        provider: 'manual',
        source: 'manual',
        event: 'fire',
        subscriptionId: '00000000-0000-4000-8000-000000000008',
        userId: devInput.devSource.initiatedByUserId,
      },
      idempotencyKey: 'manual-1',
    });
    const cron = workflowsInterModuleContract.methods.startRunFromTrigger.input.parse({
      workspaceId: devInput.workspaceId,
      projectId: devInput.projectId,
      definitionId: devInput.workflowId,
      triggerPayload: {
        provider: 'cron',
        source: 'cron',
        event: 'tick',
        scheduleId: '00000000-0000-4000-8000-000000000009',
      },
      idempotencyKey: 'cron-1',
    });

    expect(manual.triggerPayload).toMatchObject({subscriptionId: expect.any(String)});
    expect(cron.triggerPayload).toMatchObject({scheduleId: expect.any(String)});
  });

  test.each([
    ['workspace-not-found', {workspaceId: '00000000-0000-4000-8000-000000000010'}],
    ['workspace-suspended', {workspaceId: '00000000-0000-4000-8000-000000000010'}],
    ['workspace-deleted', {workspaceId: '00000000-0000-4000-8000-000000000010'}],
    ['agent-config-unresolvable', {definitionId: '00000000-0000-4000-8000-000000000001'}],
    ['agent-integration-materialization-failed', {}],
    [
      'interpolation-unresolvable',
      {
        definitionId: '00000000-0000-4000-8000-000000000001',
        field: 'env',
        source: 'event.ref',
        envKey: 'REF',
      },
    ],
    ['invalid-job-runner-labels', {labels: ['linux', 'gpu']}],
  ] as const)('defines the %s dev-run failure', (code, details) => {
    const schema = workflowsInterModuleContract.methods.startDevRun.errors[code];
    const parsed = schema.parse(details);

    expect(parsed).toEqual(details);
  });

  test.each([
    ['workspace-not-found', {workspaceId: '00000000-0000-4000-8000-000000000010'}],
    ['workspace-suspended', {workspaceId: '00000000-0000-4000-8000-000000000010'}],
    ['workspace-deleted', {workspaceId: '00000000-0000-4000-8000-000000000010'}],
  ] as const)('defines the %s listener-delivery failure', (code, details) => {
    const schema = workflowsInterModuleContract.methods.deliverEventToJobListener.errors[code];

    expect(schema.parse(details)).toEqual(details);
  });

  test.each([
    'lease-not-active',
    'step-not-found',
    'job-not-found',
    'step-attempt-mismatch',
    'step-not-running',
    'leased-step-not-agent',
    'agent-step-config-invalid',
  ])('defines the %s agent-tools failure', (code) => {
    const schema =
      workflowsInterModuleContract.methods.getLeasedAgentToolContext.errors[
        code as keyof typeof workflowsInterModuleContract.methods.getLeasedAgentToolContext.errors
      ];

    expect(schema.parse({})).toEqual({});
  });
});
