import {
  WORKFLOWS_JOB_ACTIVATED,
  WORKFLOWS_JOB_EVENT_DELIVERED,
  WORKFLOWS_JOB_EXECUTION_TIMED_OUT,
  WORKFLOWS_JOB_STEPS_SETTLED,
  WORKFLOWS_JOB_TERMINATED,
  WORKFLOWS_STEP_ATTEMPT_TERMINATED,
  WORKFLOWS_STEP_RESTART_ENQUEUED,
  WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED,
  WORKFLOWS_WORKFLOW_RUN_CANCELLED,
  WORKFLOWS_WORKFLOW_RUN_TERMINATED,
  workflowsEventSchemas,
  workflowsJobActivatedSchema,
  workflowsJobEventDeliveredSchema,
  workflowsJobExecutionTimedOutSchema,
  workflowsJobStepsSettledSchema,
  workflowsJobTerminatedSchema,
  workflowsStepAttemptTerminatedSchema,
  workflowsStepRestartEnqueuedSchema,
  workflowsWorkflowRunAttemptCreatedSchema,
  workflowsWorkflowRunCancelledSchema,
  workflowsWorkflowRunTerminatedSchema,
} from './events.js';

const validRunCreated = {
  workflowRunId: 'run-1',
  workflowRunAttemptId: 'attempt-1',
  attempt: 1,
  workspaceId: 'ws-1',
  projectId: 'proj-1',
  definitionId: 'def-1',
};

const validJobTerminated = {
  jobId: 'job-1',
  workflowRunId: 'run-1',
  workflowRunAttemptId: 'attempt-1',
  status: 'succeeded',
  statusReason: null,
};

const validRunTerminated = {
  workflowRunId: 'run-1',
  workflowRunAttemptId: 'attempt-1',
  projectId: 'proj-1',
  status: 'failed',
};

const validRunCancelled = {
  workflowRunId: 'run-1',
  workflowRunAttemptId: 'attempt-1',
  projectId: 'proj-1',
};

const validJobExecutionTimedOut = {
  jobId: 'job-1',
  jobExecutionId: 'execution-1',
  workflowRunAttemptId: 'attempt-1',
};

const validJobActivated = {
  jobId: 'job-1',
  workflowRunId: 'run-1',
  workspaceId: 'ws-1',
  mode: 'listening',
  on: [{source: 'github', event: 'pull_request_review', inputs: {state: 'approved'}}],
  until: [{source: 'github', event: 'pull_request_closed'}],
};

const validJobEventDelivered = {
  jobId: 'job-1',
  disposition: 'fire',
  eventRef: 'delivery-1',
  eventName: 'pull_request_review',
};

const validJobStepsSettled = {
  jobId: 'job-1',
  jobExecutionId: 'execution-1',
  workflowRunId: 'run-1',
  workflowRunAttemptId: 'attempt-1',
  status: 'failed',
};

const validStepRestartEnqueued = {
  jobId: 'job-1',
  workflowRunId: 'run-1',
  workflowRunAttemptId: 'attempt-1',
  failedStepId: 'step-1',
  failedStepAttempt: 2,
  restartFromStepId: 'step-0',
  feedback: 'gate failed',
};

const validStepAttemptTerminated = {
  jobId: 'job-1',
  workflowRunId: 'run-1',
  workflowRunAttemptId: 'attempt-1',
  workspaceId: 'ws-1',
  projectId: 'proj-1',
  stepId: 'step-1',
  attempt: 1,
  status: 'failed',
  logOutcome: 'drained',
};

describe('workflowsJobTerminatedSchema', () => {
  it('parses a valid job-terminated payload unchanged', () => {
    const result = workflowsJobTerminatedSchema.parse(validJobTerminated);

    expect(result).toEqual(validJobTerminated);
  });

  it('rejects a payload missing a required field', () => {
    const {workflowRunId: _runId, ...withoutWorkflowRunId} = validJobTerminated;

    const parse = () => workflowsJobTerminatedSchema.parse(withoutWorkflowRunId);

    expect(parse).toThrow();
  });

  it('rejects a status outside the terminal set', () => {
    const input = {...validJobTerminated, status: 'running'};

    const parse = () => workflowsJobTerminatedSchema.parse(input);

    expect(parse).toThrow();
  });

  it('accepts skipped as a job-only terminal status with a reason', () => {
    const input = {
      ...validJobTerminated,
      status: 'skipped',
      statusReason: 'dependency_not_completed',
    };

    const result = workflowsJobTerminatedSchema.parse(input);

    expect(result).toEqual(input);
  });

  it('accepts a string status reason message', () => {
    const input = {
      ...validJobTerminated,
      status: 'failed',
      statusReason: 'output_too_large',
      statusReasonMessage: 'Job output exceeded the configured size limit.',
    };

    const result = workflowsJobTerminatedSchema.parse(input);

    expect(result).toEqual(input);
  });

  it('accepts a null status reason message', () => {
    const input = {
      ...validJobTerminated,
      status: 'failed',
      statusReason: 'unknown',
      statusReasonMessage: null,
    };

    const result = workflowsJobTerminatedSchema.parse(input);

    expect(result).toEqual(input);
  });

  it('rejects a non-string status reason message', () => {
    const input = {
      ...validJobTerminated,
      status: 'failed',
      statusReason: 'output_too_large',
      statusReasonMessage: 413,
    };

    const parse = () => workflowsJobTerminatedSchema.parse(input);

    expect(parse).toThrow();
  });

  it('strips unknown keys (tolerant of forward-compatible producer additions)', () => {
    const input = {...validJobTerminated, addedLater: 'ignored'};

    const result = workflowsJobTerminatedSchema.parse(input);

    expect(result).toEqual(validJobTerminated);
  });
});

describe('workflowsWorkflowRunTerminatedSchema', () => {
  it('parses a valid run-terminated payload unchanged', () => {
    const result = workflowsWorkflowRunTerminatedSchema.parse(validRunTerminated);

    expect(result).toEqual(validRunTerminated);
  });

  it('rejects a payload missing a required field', () => {
    const {projectId: _projectId, ...withoutProjectId} = validRunTerminated;

    const parse = () => workflowsWorkflowRunTerminatedSchema.parse(withoutProjectId);

    expect(parse).toThrow();
  });

  it('rejects a status outside the terminal set', () => {
    const input = {...validRunTerminated, status: 'running'};

    const parse = () => workflowsWorkflowRunTerminatedSchema.parse(input);

    expect(parse).toThrow();
  });

  it('rejects skipped because runs do not have a skipped terminal status', () => {
    const input = {...validRunTerminated, status: 'skipped'};

    const parse = () => workflowsWorkflowRunTerminatedSchema.parse(input);

    expect(parse).toThrow();
  });

  it('strips unknown keys (tolerant of forward-compatible producer additions)', () => {
    const input = {...validRunTerminated, addedLater: 'ignored'};

    const result = workflowsWorkflowRunTerminatedSchema.parse(input);

    expect(result).toEqual(validRunTerminated);
  });
});

describe('workflowsJobActivatedSchema', () => {
  it('requires at least one on matcher for listening jobs', () => {
    const withoutMatchers = {...validJobActivated, on: []};

    const parse = () => workflowsJobActivatedSchema.parse(withoutMatchers);

    expect(parse).toThrow();
  });

  it('rejects null on matchers for listening jobs', () => {
    const withoutMatchers = {...validJobActivated, on: null};

    const parse = () => workflowsJobActivatedSchema.parse(withoutMatchers);

    expect(parse).toThrow();
  });

  it('allows one-shot jobs without listener matchers', () => {
    const payload = {
      jobId: 'job-1',
      workflowRunId: 'run-1',
      workspaceId: 'ws-1',
      mode: 'one_shot',
    };

    const result = workflowsJobActivatedSchema.parse(payload);

    expect(result).toEqual(payload);
  });

  it('retains resolved listener filter snapshots on job-activated matchers', () => {
    const payload = {
      ...validJobActivated,
      on: [
        {
          source: 'github',
          event: 'pull_request_review',
          filter: 'jobs.build.outputs.pr_number == event.pull_request.number',
          filter_snapshot: {jobs: {build: {outputs: {pr_number: 42}}}},
          filter_output_types: {build: {pr_number: 'int'}},
        },
      ],
      until: [
        {
          source: 'github',
          event: 'pull_request',
          filter: 'jobs.build.outputs.pr_number == event.pull_request.number',
          filter_snapshot: {jobs: {build: {outputs: {pr_number: 42}}}},
          filter_output_types: {build: {pr_number: 'int'}},
        },
      ],
    };

    const result = workflowsJobActivatedSchema.parse(payload);

    expect(result).toEqual(payload);
  });

  it('keeps authoring-shaped matchers compatible when no snapshot is present', () => {
    const payload = {
      ...validJobActivated,
      on: [{source: 'github', event: 'pull_request_review', filter: 'event.action == "opened"'}],
      until: [{source: 'github', event: 'pull_request'}],
    };

    const result = workflowsJobActivatedSchema.parse(payload);

    expect(result).toEqual(payload);
  });
});

describe('workflowsStepRestartEnqueuedSchema', () => {
  it('rejects empty restart feedback', () => {
    const input = {...validStepRestartEnqueued, feedback: ''};

    const parse = () => workflowsStepRestartEnqueuedSchema.parse(input);

    expect(parse).toThrow();
  });
});

describe.each([
  [
    'workflowsWorkflowRunAttemptCreatedSchema',
    workflowsWorkflowRunAttemptCreatedSchema,
    validRunCreated,
    'workflowRunAttemptId',
  ],
  [
    'workflowsWorkflowRunCancelledSchema',
    workflowsWorkflowRunCancelledSchema,
    validRunCancelled,
    'projectId',
  ],
  [
    'workflowsJobExecutionTimedOutSchema',
    workflowsJobExecutionTimedOutSchema,
    validJobExecutionTimedOut,
    'jobId',
  ],
  ['workflowsJobActivatedSchema', workflowsJobActivatedSchema, validJobActivated, 'mode'],
  [
    'workflowsJobEventDeliveredSchema',
    workflowsJobEventDeliveredSchema,
    validJobEventDelivered,
    'eventRef',
  ],
  [
    'workflowsJobStepsSettledSchema',
    workflowsJobStepsSettledSchema,
    validJobStepsSettled,
    'status',
  ],
  [
    'workflowsStepRestartEnqueuedSchema',
    workflowsStepRestartEnqueuedSchema,
    validStepRestartEnqueued,
    'failedStepAttempt',
  ],
  [
    'workflowsStepAttemptTerminatedSchema',
    workflowsStepAttemptTerminatedSchema,
    validStepAttemptTerminated,
    'logOutcome',
  ],
] as const)('%s', (_name, schema, validPayload, requiredKey) => {
  it('parses a valid payload unchanged', () => {
    const result = schema.parse(validPayload);

    expect(result).toEqual(validPayload);
  });

  it('rejects a payload missing a required field', () => {
    const withoutRequiredKey = Object.fromEntries(
      Object.entries(validPayload).filter(([key]) => key !== requiredKey),
    );

    const parse = () => schema.parse(withoutRequiredKey);

    expect(parse).toThrow();
  });
});

describe('workflowsEventSchemas', () => {
  it('registers every workflows publisher event type', () => {
    const registeredTypes = Object.keys(workflowsEventSchemas).sort();

    expect(registeredTypes).toEqual(
      [
        WORKFLOWS_WORKFLOW_RUN_ATTEMPT_CREATED,
        WORKFLOWS_WORKFLOW_RUN_TERMINATED,
        WORKFLOWS_WORKFLOW_RUN_CANCELLED,
        WORKFLOWS_JOB_EXECUTION_TIMED_OUT,
        WORKFLOWS_JOB_ACTIVATED,
        WORKFLOWS_JOB_EVENT_DELIVERED,
        WORKFLOWS_JOB_TERMINATED,
        WORKFLOWS_JOB_STEPS_SETTLED,
        WORKFLOWS_STEP_RESTART_ENQUEUED,
        WORKFLOWS_STEP_ATTEMPT_TERMINATED,
      ].sort(),
    );
  });

  it('does not register retired listener pseudo-entity events', () => {
    const registeredTypes = Object.keys(workflowsEventSchemas);

    expect(registeredTypes).toEqual(
      expect.not.arrayContaining([
        'workflows.listener.started',
        'workflows.listener.resolved',
        'workflows.listener.cancelled',
      ]),
    );
  });
});
