import {
  type AnnotationsInterModuleClient,
  annotationsInterModuleContract,
} from '@shipfox/annotations-dto/inter-module';
import type {
  AgentConfigIssueDto,
  StepErrorReasonDto,
  WorkflowsJobTerminatedEventDto,
  WorkflowsStepAttemptTerminatedEventDto,
} from '@shipfox/api-workflows-dto';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import type {Step, StepAttempt} from '#core/entities/step.js';
import {
  onJobTerminatedFailureAnnotation,
  onStepAttemptTerminatedFailureAnnotation,
} from './on-failure-annotations.js';

const dbMocks = vi.hoisted(() => ({
  getJobExecutionFailureOrigin: vi.fn(),
  getJobScope: vi.fn(),
  getStepAttemptDetail: vi.fn(),
  getWorkflowRunAttemptById: vi.fn(),
}));

const metricMocks = vi.hoisted(() => ({recordWorkflowFailureAnnotationFailed: vi.fn()}));
const loggerWarn = vi.hoisted(() => vi.fn());

vi.mock('#db/index.js', () => dbMocks);
vi.mock('#metrics/instance.js', () => metricMocks);
vi.mock('@shipfox/node-opentelemetry', () => ({logger: () => ({warn: loggerWarn})}));

const replaceOrRemoveAnnotation = vi.fn(async () => ({}));
const annotations = {replaceOrRemoveAnnotation} as unknown as AnnotationsInterModuleClient;
const JOB_EXECUTION_ID = '66666666-6666-4666-8666-666666666666';

type MappedStepErrorReason = Exclude<
  StepErrorReasonDto,
  'agent_config_invalid' | 'invocation_interrupted'
>;

const STEP_FAILURE_CASES = [
  {
    reason: 'checkout_failed',
    type: 'checkout',
    title: 'Repository checkout failed',
    description:
      'Shipfox could not check out the repository. Verify repository access before trying again.',
  },
  {
    reason: 'checkout_auth_failed',
    type: 'checkout',
    title: 'Repository access failed',
    description:
      'Shipfox could not access the repository. Verify the connection and repository permissions before trying again.',
  },
  {
    reason: 'checkout_unavailable',
    type: 'checkout',
    title: 'Repository checkout unavailable',
    description: 'The repository could not be checked out right now. Try again.',
  },
  {
    reason: 'checkout_path_invalid',
    type: 'checkout',
    title: 'Checkout path needs attention',
    description: 'Review the checkout path in the workflow before trying again.',
  },
  {
    reason: 'checkout_destination_occupied',
    type: 'checkout',
    title: 'Checkout path is already in use',
    description: 'Choose another checkout path or use a clean workspace before trying again.',
  },
  {
    reason: 'git_unavailable',
    type: 'checkout',
    title: 'Git is unavailable',
    description:
      'Git is not available on the selected runner. Check the runner setup before trying again.',
  },
  {
    reason: 'workspace_prep_failed',
    type: 'setup',
    title: 'Workspace setup failed',
    description:
      'Shipfox could not prepare the workspace. Try again. If the problem continues, check the runner setup.',
  },
  {
    reason: 'setup_aborted',
    type: 'setup',
    title: 'Workspace setup stopped',
    description: 'Workspace setup did not finish. Try again.',
  },
  {
    reason: 'config_unresolvable',
    type: 'run',
    title: 'Step configuration needs attention',
    description: 'Review the values referenced by this step before trying again.',
  },
  {
    reason: 'output_invalid',
    type: 'run',
    title: 'Step output could not be used',
    description:
      'Review the declared outputs and the values returned by this step before trying again.',
  },
  {
    reason: 'agent_invocation_failed',
    type: 'agent',
    title: 'Agent step failed',
    description:
      'The agent could not complete this step. Review the step logs before trying again.',
  },
  {
    reason: 'agent_harness_unavailable',
    type: 'agent',
    title: 'Agent could not start',
    description:
      'Shipfox could not start the agent. Try again. If the problem continues, check the runner setup.',
  },
  {
    reason: 'agent_inference_credentials_unavailable',
    type: 'agent',
    title: 'Inference credentials are unavailable',
    description:
      'Shipfox could not obtain inference credentials for this agent. Try again. If the problem continues, check the model provider configuration.',
  },
  {
    reason: 'agent_session_key_invalid',
    type: 'agent',
    title: 'Agent session configuration needs attention',
    description: 'Review the session key and mode before trying again.',
  },
  {
    reason: 'agent_session_held',
    type: 'agent',
    title: 'Agent session is busy',
    description: 'Another step is using this session. Try again after that step finishes.',
  },
  {
    reason: 'agent_session_harness_mismatch',
    type: 'agent',
    title: 'Agent session is incompatible',
    description: 'Use the original harness for this session or start a new session.',
  },
  {
    reason: 'agent_session_unavailable',
    type: 'agent',
    title: 'Agent session is unavailable',
    description: 'Start a new session or try again.',
  },
  {
    reason: 'tool_error',
    type: 'tool',
    title: 'Tool call failed',
    description:
      'The connected service could not complete the request. Review the connection and tool inputs before trying again.',
  },
  {
    reason: 'tool_config_invalid',
    type: 'tool',
    title: 'Tool configuration needs attention',
    description: 'Review the connection and tool inputs before trying again.',
  },
] as const satisfies readonly {
  reason: MappedStepErrorReason;
  type: Step['type'];
  title: string;
  description: string;
}[];

const AGENT_CONFIG_FAILURE_CASES = [
  {
    issue: 'step_config_invalid',
    title: 'Agent configuration needs attention',
    description: 'Review the agent step configuration before trying again.',
  },
  {
    issue: 'provider_not_configured',
    title: 'Model provider is not connected',
    description: 'Connect a model provider before running this step again.',
  },
  {
    issue: 'provider_unsupported',
    title: 'Model provider is unavailable',
    description: 'Choose a model provider supported by this Shipfox installation.',
  },
  {
    issue: 'model_unavailable',
    title: 'Model is unavailable',
    description: 'Choose an available model or update the provider access before trying again.',
  },
  {
    issue: 'credentials_invalid',
    title: 'Model provider credentials need attention',
    description: 'Update the model provider credentials before trying again.',
  },
] as const satisfies readonly {
  issue: AgentConfigIssueDto;
  title: string;
  description: string;
}[];

const JOB_FAILURE_CASES = [
  {
    reason: 'timed_out',
    title: 'Job timed out',
    description:
      'The job did not finish within its configured time limit. Review the timeout or workload before trying again.',
  },
  {
    reason: 'runner_lost',
    title: 'Runner connection lost',
    description: 'The runner stopped responding before the job finished. Try the job again.',
  },
  {
    reason: 'condition_errored',
    title: 'Job condition could not be evaluated',
    description: 'Review the job condition and the values it references before trying again.',
  },
  {
    reason: 'output_too_large',
    title: 'Job output is too large',
    description: 'Reduce the declared output before trying again.',
  },
  {
    reason: 'output_invalid',
    title: 'Job output could not be used',
    description: 'Ensure every declared output resolves to a valid JSON value before trying again.',
  },
] as const satisfies readonly {
  reason: NonNullable<WorkflowsJobTerminatedEventDto['statusReason']>;
  title: string;
  description: string;
}[];

describe('failure annotations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('projects a failed step attempt into an error annotation', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      status: 'failed',
      error: {reason: 'agent_invocation_failed', message: 'Provider returned 500'},
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      status: 'failed',
      exitCode: 1,
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 2});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: payload.workspaceId,
        projectId: payload.projectId,
        workflowRunId: payload.workflowRunId,
        workflowRunAttempt: 2,
        workflowRunAttemptId: payload.workflowRunAttemptId,
        jobId: payload.jobId,
        jobExecutionId: JOB_EXECUTION_ID,
        originStepId: payload.stepId,
        originStepAttempt: payload.attempt,
        context: `failure:step:${payload.stepId}`,
        annotation: expect.objectContaining({op: 'replace', style: 'error'}),
      }),
    );
  });

  it.each(STEP_FAILURE_CASES)('uses safe exact copy for $reason', async ({
    reason,
    type,
    title,
    description,
  }) => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      type,
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      error: {reason, message: 'internal runtime detail'},
      exitCode: 73,
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: {
          op: 'replace',
          style: 'error',
          body: [`**${title}**`, '', description].join('\n'),
        },
      }),
    );
  });

  it('explains validation after a successful Slack call without exposing internals', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      type: 'tool',
      config: {tool: {provider: 'slack', sensitivity: 'read'}},
      error: {kind: 'gate_uncheckable', message: 'step produced no exit code'},
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      exitCode: null,
      error: {kind: 'gate_uncheckable', message: 'step produced no exit code'},
      gateResult: {
        passed: false,
        uncheckable: true,
        reason: 'step produced no exit code',
        exit_code: null,
      },
      invocations: [successfulToolInvocation()],
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: {
          op: 'replace',
          style: 'error',
          body: [
            '**Step validation failed**',
            '',
            "The Slack call succeeded, but Shipfox could not evaluate the step's success condition. No workflow configuration change is required.",
          ].join('\n'),
        },
      }),
    );
  });

  it('identifies a successful Slack call before a gate expression error', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      type: 'tool',
      config: {tool: {provider: 'slack', sensitivity: 'read'}},
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      error: {kind: 'gate_uncheckable', message: 'gate expression evaluation failed'},
      exitCode: null,
      gateResult: {
        passed: false,
        uncheckable: true,
        reason: 'gate expression evaluation failed',
        exit_code: null,
      },
      invocations: [successfulToolInvocation()],
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: {
          op: 'replace',
          style: 'error',
          body: [
            '**Step validation failed**',
            '',
            "The Slack call succeeded, but Shipfox could not evaluate the step's success condition. Review the condition and the values it references.",
          ].join('\n'),
        },
      }),
    );
  });

  it('identifies a successful Slack call before a rejected gate', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      type: 'tool',
      config: {tool: {provider: 'slack', sensitivity: 'read'}},
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      error: {kind: 'gate_failed', message: 'gate condition not met'},
      exitCode: null,
      gateResult: {passed: false, source: 'output.ok', exit_code: null},
      invocations: [successfulToolInvocation()],
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: {
          op: 'replace',
          style: 'error',
          body: [
            '**Step validation failed**',
            '',
            "The Slack call succeeded, but the step's success condition was not met. Review the result and success condition.",
          ].join('\n'),
        },
      }),
    );
  });

  it('identifies a successful Slack call before invalid output mapping', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      type: 'tool',
      config: {tool: {provider: 'slack', sensitivity: 'read'}},
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      error: {reason: 'output_invalid', message: 'output path exposed an internal value'},
      exitCode: null,
      invocations: [successfulToolInvocation()],
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: {
          op: 'replace',
          style: 'error',
          body: [
            '**Tool result could not be used**',
            '',
            'The Slack call succeeded, but Shipfox could not use its result as the step output. Review the declared outputs before trying again.',
          ].join('\n'),
        },
      }),
    );
  });

  it('does not present a failed Slack call as a gate failure', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      type: 'tool',
      config: {tool: {provider: 'slack', sensitivity: 'read'}},
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      error: {kind: 'gate_failed', message: 'gate condition not met'},
      exitCode: null,
      gateResult: {passed: false, source: 'output.ok', exit_code: null},
      invocations: [failedToolInvocation()],
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: {
          op: 'replace',
          style: 'error',
          body: [
            '**Tool call failed**',
            '',
            'The connected service could not complete the request. Review the connection and tool inputs before trying again.',
          ].join('\n'),
        },
      }),
    );
  });

  it('uses safe fallback copy instead of an unknown error payload', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      error: {kind: 'unexpected_internal_failure', message: 'database host api-1 failed'},
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      error: {kind: 'unexpected_internal_failure', message: 'database host api-1 failed'},
      exitCode: null,
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: {
          op: 'replace',
          style: 'error',
          body: [
            '**Step failed**',
            '',
            'Shipfox could not complete this step. Try again or review the step logs.',
          ].join('\n'),
        },
      }),
    );
  });

  it('warns before retrying an interrupted write tool without exposing its error', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      type: 'tool',
      config: {tool: {provider: 'github', sensitivity: 'write'}},
      error: {reason: 'invocation_interrupted', message: 'request stream closed at byte 391'},
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      error: {reason: 'invocation_interrupted', message: 'request stream closed at byte 391'},
      exitCode: null,
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: {
          op: 'replace',
          style: 'error',
          body: [
            '**Tool call outcome is uncertain**',
            '',
            'The connected service may have completed the request. Check it before trying again.',
          ].join('\n'),
        },
      }),
    );
  });

  it.each(
    AGENT_CONFIG_FAILURE_CASES,
  )('explains persisted agent configuration issue $issue', async ({issue, title, description}) => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      type: 'agent',
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      error: {
        reason: 'agent_config_invalid',
        agentConfigIssue: issue,
        message: 'provider lookup returned an internal configuration detail',
      },
      exitCode: null,
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: {
          op: 'replace',
          style: 'error',
          body: [`**${title}**`, '', description].join('\n'),
        },
      }),
    );
  });

  it('removes a stale step failure annotation after a successful terminal event', async () => {
    const payload = stepAttemptTerminatedPayload({attempt: 2, status: 'succeeded'});
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      status: 'succeeded',
      currentAttempt: 2,
      error: null,
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      attempt: 2,
      status: 'succeeded',
      exitCode: 0,
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        context: `failure:step:${payload.stepId}`,
        annotation: {op: 'remove'},
      }),
    );
  });

  it('does not resurrect a failure when an older failed event arrives after recovery', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      status: 'succeeded',
      currentAttempt: 2,
      error: null,
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      attempt: 1,
      status: 'failed',
      exitCode: 1,
      error: {reason: 'agent_invocation_failed', message: 'old failure'},
    });
    const recoveredStep = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      status: 'succeeded',
      currentAttempt: 2,
      error: null,
    });
    const recoveredAttempt = stepAttemptEntity({
      stepId: recoveredStep.id,
      attempt: 2,
      status: 'succeeded',
      exitCode: 0,
      error: null,
    });
    dbMocks.getStepAttemptDetail.mockResolvedValueOnce({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getStepAttemptDetail.mockResolvedValueOnce({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step: recoveredStep,
      attempt: recoveredAttempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        context: `failure:step:${payload.stepId}`,
        annotation: {op: 'remove'},
      }),
    );
  });

  it('projects the canonical current attempt when an older failure event arrives late', async () => {
    const payload = stepAttemptTerminatedPayload();
    const oldStep = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      status: 'failed',
      currentAttempt: 2,
      error: {reason: 'agent_invocation_failed', message: 'old step error'},
    });
    const oldAttempt = stepAttemptEntity({
      stepId: oldStep.id,
      attempt: 1,
      status: 'failed',
      error: {reason: 'agent_invocation_failed', message: 'old failure'},
    });
    const currentStep = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      status: 'failed',
      currentAttempt: 2,
      error: {reason: 'agent_invocation_failed', message: 'current step error'},
    });
    const currentAttempt = stepAttemptEntity({
      stepId: currentStep.id,
      attempt: 2,
      status: 'failed',
      error: {reason: 'agent_invocation_failed', message: 'current failure'},
      exitCode: 2,
    });
    dbMocks.getStepAttemptDetail.mockResolvedValueOnce({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step: oldStep,
      attempt: oldAttempt,
    });
    dbMocks.getStepAttemptDetail.mockResolvedValueOnce({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step: currentStep,
      attempt: currentAttempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        originStepAttempt: 2,
        annotation: expect.objectContaining({
          op: 'replace',
          body: expect.stringContaining('Agent step failed'),
        }),
      }),
    );
  });

  it('skips first successful attempts without reading projection history', async () => {
    const payload = stepAttemptTerminatedPayload({status: 'succeeded'});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(dbMocks.getStepAttemptDetail).not.toHaveBeenCalled();
    expect(dbMocks.getWorkflowRunAttemptById).not.toHaveBeenCalled();
    expect(replaceOrRemoveAnnotation).not.toHaveBeenCalled();
  });

  it.each(JOB_FAILURE_CASES)('uses safe exact job copy for $reason', async ({
    reason,
    title,
    description,
  }) => {
    const payload = jobTerminatedPayload({
      status: reason === 'condition_errored' ? 'skipped' : 'failed',
      statusReason: reason,
      statusReasonMessage: 'internal scheduler detail with host and process information',
    });
    dbMocks.getJobScope.mockResolvedValue({
      workspaceId: '44444444-4444-4444-8444-444444444444',
      projectId: '55555555-5555-4555-8555-555555555555',
      triggerReference: null,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 3});
    dbMocks.getJobExecutionFailureOrigin.mockResolvedValue({
      jobExecutionId: payload.jobExecutionId,
      stepId: '77777777-7777-4777-8777-777777777777',
      stepName: 'Run tests',
      stepStatus: 'failed',
      stepAttempt: 2,
      stepError: {reason: 'agent_invocation_failed', message: 'internal step detail'},
      attemptStatus: 'failed',
      attemptError: {reason: 'agent_invocation_failed', message: 'internal attempt detail'},
      attemptExitCode: 73,
    });

    await onJobTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: {
          op: 'replace',
          style: 'error',
          body: [
            `**${title}**`,
            '',
            'The job stopped while processing **Run tests**.',
            '',
            description,
          ].join('\n'),
        },
      }),
    );
  });

  it('projects a job failure from the current execution origin', async () => {
    const payload = jobTerminatedPayload({
      status: 'failed',
      statusReason: 'output_too_large',
      statusReasonMessage:
        'Job output "payload" exceeds the per-value size limit of 16384 bytes (measured 16385 bytes; overshoot 1 bytes).',
    });
    dbMocks.getJobScope.mockResolvedValue({
      workspaceId: '44444444-4444-4444-8444-444444444444',
      projectId: '55555555-5555-4555-8555-555555555555',
      triggerReference: null,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 3});
    dbMocks.getJobExecutionFailureOrigin.mockResolvedValue({
      jobExecutionId: payload.jobExecutionId,
      stepId: '77777777-7777-4777-8777-777777777777',
      stepName: 'Run tests',
      stepStatus: 'failed',
      stepAttempt: 2,
      stepError: {reason: 'agent_invocation_failed', message: 'Provider returned 500'},
      attemptStatus: 'failed',
      attemptError: {reason: 'agent_invocation_failed', message: 'Provider returned 500'},
      attemptExitCode: 1,
    });

    await onJobTerminatedFailureAnnotation(annotations)(payload);

    expect(dbMocks.getJobExecutionFailureOrigin).toHaveBeenCalledWith(payload.jobExecutionId);
    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        jobExecutionId: payload.jobExecutionId,
        originStepId: '77777777-7777-4777-8777-777777777777',
        originStepAttempt: 2,
        context: `failure:job:${payload.jobId}`,
        annotation: expect.objectContaining({
          op: 'replace',
          body: expect.stringContaining('Run tests'),
        }),
      }),
    );
    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: expect.objectContaining({
          body: [
            '**Job output is too large**',
            '',
            'The job stopped while processing **Run tests**.',
            '',
            'Reduce the declared output before trying again.',
          ].join('\n'),
        }),
      }),
    );
  });

  it('explains an invalid job output without exposing its status message', async () => {
    const payload = jobTerminatedPayload({
      statusReason: 'output_invalid',
      statusReasonMessage: 'Job output "payload" cannot be persisted as JSON: undefined.',
    });
    dbMocks.getJobScope.mockResolvedValue({
      workspaceId: '44444444-4444-4444-8444-444444444444',
      projectId: '55555555-5555-4555-8555-555555555555',
      triggerReference: null,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 3});
    dbMocks.getJobExecutionFailureOrigin.mockResolvedValue({
      jobExecutionId: payload.jobExecutionId,
      stepId: '77777777-7777-4777-8777-777777777777',
      stepName: 'Run tests',
      stepStatus: 'succeeded',
      stepAttempt: 1,
      stepError: null,
      attemptStatus: 'succeeded',
      attemptError: null,
      attemptExitCode: 0,
    });

    await onJobTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: expect.objectContaining({
          body: [
            '**Job output could not be used**',
            '',
            'The job stopped while processing **Run tests**.',
            '',
            'Ensure every declared output resolves to a valid JSON value before trying again.',
          ].join('\n'),
        }),
      }),
    );
  });

  it('projects a condition evaluation error from a skipped job', async () => {
    const payload = jobTerminatedPayload({status: 'skipped', statusReason: 'condition_errored'});
    dbMocks.getJobScope.mockResolvedValue({
      workspaceId: '44444444-4444-4444-8444-444444444444',
      projectId: '55555555-5555-4555-8555-555555555555',
      triggerReference: null,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 3});
    dbMocks.getJobExecutionFailureOrigin.mockResolvedValue({
      jobExecutionId: payload.jobExecutionId,
      stepId: '77777777-7777-4777-8777-777777777777',
      stepName: 'Run tests',
      stepStatus: 'skipped',
      stepAttempt: 1,
      stepError: null,
      attemptStatus: null,
      attemptError: null,
      attemptExitCode: null,
    });

    await onJobTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        context: `failure:job:${payload.jobId}`,
        annotation: expect.objectContaining({op: 'replace', style: 'error'}),
      }),
    );
  });

  it('uses the first step as the origin when a job fails before any attempt starts', async () => {
    const payload = jobTerminatedPayload({status: 'failed'});
    dbMocks.getJobScope.mockResolvedValue({
      workspaceId: '44444444-4444-4444-8444-444444444444',
      projectId: '55555555-5555-4555-8555-555555555555',
      triggerReference: null,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});
    dbMocks.getJobExecutionFailureOrigin.mockResolvedValue({
      jobExecutionId: payload.jobExecutionId,
      stepId: '77777777-7777-4777-8777-777777777777',
      stepName: 'Checkout',
      stepStatus: 'pending',
      stepAttempt: 1,
      stepError: null,
      attemptStatus: null,
      attemptError: null,
      attemptExitCode: null,
    });

    await onJobTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        originStepId: '77777777-7777-4777-8777-777777777777',
        originStepAttempt: 1,
        annotation: expect.objectContaining({
          body: expect.stringContaining('before **Checkout** started'),
        }),
      }),
    );
  });

  it('does not guess an execution for legacy terminal events without an execution id', async () => {
    const payload = jobTerminatedPayload({jobExecutionId: undefined});

    await onJobTerminatedFailureAnnotation(annotations)(payload);

    expect(dbMocks.getJobExecutionFailureOrigin).not.toHaveBeenCalled();
    expect(replaceOrRemoveAnnotation).not.toHaveBeenCalled();
  });

  it('does not project a duplicate job card for a step failure', async () => {
    const payload = jobTerminatedPayload({statusReason: 'step_failed'});

    await onJobTerminatedFailureAnnotation(annotations)(payload);

    expect(dbMocks.getJobScope).not.toHaveBeenCalled();
    expect(dbMocks.getWorkflowRunAttemptById).not.toHaveBeenCalled();
    expect(dbMocks.getJobExecutionFailureOrigin).not.toHaveBeenCalled();
    expect(replaceOrRemoveAnnotation).not.toHaveBeenCalled();
  });

  it('skips successful jobs without reading projection history', async () => {
    const payload = jobTerminatedPayload({status: 'succeeded', statusReason: null});

    await onJobTerminatedFailureAnnotation(annotations)(payload);

    expect(dbMocks.getJobScope).not.toHaveBeenCalled();
    expect(dbMocks.getWorkflowRunAttemptById).not.toHaveBeenCalled();
    expect(dbMocks.getJobExecutionFailureOrigin).not.toHaveBeenCalled();
    expect(replaceOrRemoveAnnotation).not.toHaveBeenCalled();
  });

  it('records and logs lookup failures without changing the terminal outcome', async () => {
    const error = new Error('database unavailable');
    dbMocks.getStepAttemptDetail.mockRejectedValueOnce(error);

    await expect(
      onStepAttemptTerminatedFailureAnnotation(annotations)(stepAttemptTerminatedPayload()),
    ).resolves.toBeUndefined();

    expect(metricMocks.recordWorkflowFailureAnnotationFailed).toHaveBeenCalledWith('lookup');
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({error, reason: 'lookup'}),
      'Failed to project workflow failure annotation',
    );
  });

  it('records and logs annotation write failures without throwing', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({id: payload.stepId, jobExecutionId: JOB_EXECUTION_ID});
    const attempt = stepAttemptEntity({stepId: step.id});
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});
    const error = new Error('annotation service unavailable');
    replaceOrRemoveAnnotation.mockRejectedValueOnce(error);

    await expect(
      onStepAttemptTerminatedFailureAnnotation(annotations)(payload),
    ).resolves.toBeUndefined();

    expect(metricMocks.recordWorkflowFailureAnnotationFailed).toHaveBeenCalledWith('write');
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({error, reason: 'write'}),
      'Failed to project workflow failure annotation',
    );
  });

  it('classifies published annotation budget failures separately from write failures', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({id: payload.stepId, jobExecutionId: JOB_EXECUTION_ID});
    const attempt = stepAttemptEntity({stepId: step.id});
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});
    const error = createInterModuleKnownError(
      annotationsInterModuleContract.methods.replaceOrRemoveAnnotation,
      'annotation-count-limit-exceeded',
      {maxAnnotations: 10},
    );
    replaceOrRemoveAnnotation.mockRejectedValueOnce(error);

    await expect(
      onStepAttemptTerminatedFailureAnnotation(annotations)(payload),
    ).resolves.toBeUndefined();

    expect(metricMocks.recordWorkflowFailureAnnotationFailed).toHaveBeenCalledWith('budget');
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({error, reason: 'budget'}),
      'Failed to project workflow failure annotation',
    );
  });
});

function stepAttemptTerminatedPayload(
  overrides: Partial<WorkflowsStepAttemptTerminatedEventDto> = {},
): WorkflowsStepAttemptTerminatedEventDto {
  return {
    jobId: '11111111-1111-4111-8111-111111111111',
    workflowRunId: '22222222-2222-4222-8222-222222222222',
    workflowRunAttemptId: '33333333-3333-4333-8333-333333333333',
    workspaceId: '44444444-4444-4444-8444-444444444444',
    projectId: '55555555-5555-4555-8555-555555555555',
    stepId: '77777777-7777-4777-8777-777777777777',
    attempt: 1,
    status: 'failed',
    logOutcome: 'drained',
    ...overrides,
  };
}

function jobTerminatedPayload(
  overrides: Partial<WorkflowsJobTerminatedEventDto> = {},
): WorkflowsJobTerminatedEventDto {
  return {
    jobId: '11111111-1111-4111-8111-111111111111',
    jobExecutionId: JOB_EXECUTION_ID,
    workflowRunId: '22222222-2222-4222-8222-222222222222',
    workflowRunAttemptId: '33333333-3333-4333-8333-333333333333',
    status: 'failed',
    statusReason: 'timed_out',
    ...overrides,
  };
}

function stepEntity(overrides: Partial<Step> = {}): Step {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    jobExecutionId: JOB_EXECUTION_ID,
    key: 'run',
    name: 'Run tests',
    sourceLocation: null,
    status: 'failed',
    statusReason: null,
    evaluationTrace: null,
    type: 'run',
    config: {run: 'pnpm test'},
    condition: null,
    configPlan: null,
    authoredConfig: {run: 'pnpm test'},
    error: {reason: 'agent_invocation_failed', message: 'Provider returned 500'},
    position: 1,
    version: 1,
    currentAttempt: 1,
    createdAt: new Date('2026-08-05T12:00:00.000Z'),
    updatedAt: new Date('2026-08-05T12:00:00.000Z'),
    ...overrides,
  };
}

function stepAttemptEntity(overrides: Partial<StepAttempt> = {}): StepAttempt {
  return {
    id: '88888888-8888-4888-8888-888888888888',
    stepId: '77777777-7777-4777-8777-777777777777',
    attempt: 1,
    executionOrder: 1,
    status: 'failed',
    config: {run: 'pnpm test'},
    evaluationTrace: null,
    output: null,
    response: null,
    error: null,
    exitCode: 1,
    gateResult: null,
    restartFeedback: null,
    logOutcome: 'drained',
    invocations: [],
    startedAt: new Date('2026-08-05T12:00:00.000Z'),
    finishedAt: new Date('2026-08-05T12:01:00.000Z'),
    createdAt: new Date('2026-08-05T12:00:00.000Z'),
    ...overrides,
  };
}

function successfulToolInvocation(): StepAttempt['invocations'][number] {
  return {
    call_index: 0,
    started_at: '2026-09-02T07:25:28.000Z',
    finished_at: '2026-09-02T07:25:28.879Z',
    outcome: 'success',
  };
}

function failedToolInvocation(): StepAttempt['invocations'][number] {
  return {
    call_index: 0,
    started_at: '2026-09-02T07:25:28.000Z',
    finished_at: '2026-09-02T07:25:28.879Z',
    outcome: 'error',
    error_code: 'provider_error',
  };
}
