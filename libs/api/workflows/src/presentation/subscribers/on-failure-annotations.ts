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
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {logger} from '@shipfox/node-opentelemetry';
import type {JobStatusReason} from '#core/entities/job.js';
import type {Step, StepAttempt} from '#core/entities/step.js';
import {GATE_EVALUATION_ERROR_REASON} from '#core/step-transition/evaluate-gate.js';
import {
  getJobExecutionFailureOrigin,
  getJobScope,
  getStepAttemptDetail,
  getWorkflowRunAttemptById,
} from '#db/index.js';
import {recordWorkflowFailureAnnotationFailed} from '#metrics/instance.js';

const JOB_FAILURE_ANNOTATION_REASONS = new Set([
  'timed_out',
  'runner_lost',
  'condition_errored',
  'output_too_large',
  'output_invalid',
]);

interface FailureCopy {
  readonly title: string;
  readonly description: string;
}

const STEP_FAILURE_COPY: Readonly<
  Record<
    Exclude<StepErrorReasonDto, 'agent_config_invalid' | 'invocation_interrupted'>,
    FailureCopy
  >
> = {
  checkout_failed: {
    title: 'Repository checkout failed',
    description:
      'Shipfox could not check out the repository. Verify repository access before trying again.',
  },
  checkout_auth_failed: {
    title: 'Repository access failed',
    description:
      'Shipfox could not access the repository. Verify the connection and repository permissions before trying again.',
  },
  checkout_unavailable: {
    title: 'Repository checkout unavailable',
    description: 'The repository could not be checked out right now. Try again.',
  },
  checkout_path_invalid: {
    title: 'Checkout path needs attention',
    description: 'Review the checkout path in the workflow before trying again.',
  },
  checkout_destination_occupied: {
    title: 'Checkout path is already in use',
    description: 'Choose another checkout path or use a clean workspace before trying again.',
  },
  git_unavailable: {
    title: 'Git is unavailable',
    description:
      'Git is not available on the selected runner. Check the runner setup before trying again.',
  },
  workspace_prep_failed: {
    title: 'Workspace setup failed',
    description:
      'Shipfox could not prepare the workspace. Try again. If the problem continues, check the runner setup.',
  },
  setup_aborted: {
    title: 'Workspace setup stopped',
    description: 'Workspace setup did not finish. Try again.',
  },
  config_unresolvable: {
    title: 'Step configuration needs attention',
    description: 'Review the values referenced by this step before trying again.',
  },
  output_invalid: {
    title: 'Step output could not be used',
    description:
      'Review the declared outputs and the values returned by this step before trying again.',
  },
  diagnostic_too_large: {
    title: 'Step diagnostic is too large',
    description: 'Reduce the step diagnostic before trying again.',
  },
  execution_payload_too_large: {
    title: 'Step execution payload is too large',
    description: 'Reduce the workflow value required to execute this step before trying again.',
  },
  step_result_too_large: {
    title: 'Step result is too large',
    description: 'Reduce the value returned by this step before trying again.',
  },
  agent_invocation_failed: {
    title: 'Agent step failed',
    description:
      'The agent could not complete this step. Review the step logs before trying again.',
  },
  agent_harness_unavailable: {
    title: 'Agent could not start',
    description:
      'Shipfox could not start the agent. Try again. If the problem continues, check the runner setup.',
  },
  agent_inference_credentials_unavailable: {
    title: 'Inference credentials are unavailable',
    description:
      'Shipfox could not obtain inference credentials for this agent. Try again. If the problem continues, check the model provider configuration.',
  },
  agent_session_key_invalid: {
    title: 'Agent session configuration needs attention',
    description: 'Review the session key and mode before trying again.',
  },
  agent_session_held: {
    title: 'Agent session is busy',
    description: 'Another step is using this session. Try again after that step finishes.',
  },
  agent_session_harness_mismatch: {
    title: 'Agent session is incompatible',
    description: 'Use the original harness for this session or start a new session.',
  },
  agent_session_unavailable: {
    title: 'Agent session is unavailable',
    description: 'Start a new session or try again.',
  },
  tool_error: {
    title: 'Tool call failed',
    description:
      'The connected service could not complete the request. Review the connection and tool inputs before trying again.',
  },
  tool_config_invalid: {
    title: 'Tool configuration needs attention',
    description: 'Review the connection and tool inputs before trying again.',
  },
};

const AGENT_CONFIG_FAILURE_COPY: Readonly<Record<AgentConfigIssueDto, FailureCopy>> = {
  step_config_invalid: {
    title: 'Agent configuration needs attention',
    description: 'Review the agent step configuration before trying again.',
  },
  provider_not_configured: {
    title: 'Model provider is not connected',
    description: 'Connect a model provider before running this step again.',
  },
  provider_unsupported: {
    title: 'Model provider is unavailable',
    description: 'Choose a model provider supported by this Shipfox installation.',
  },
  model_unavailable: {
    title: 'Model is unavailable',
    description: 'Choose an available model or update the provider access before trying again.',
  },
  credentials_invalid: {
    title: 'Model provider credentials need attention',
    description: 'Update the model provider credentials before trying again.',
  },
};

const JOB_FAILURE_COPY: Readonly<Partial<Record<JobStatusReason, FailureCopy>>> = {
  timed_out: {
    title: 'Job timed out',
    description:
      'The job did not finish within its configured time limit. Review the timeout or workload before trying again.',
  },
  runner_lost: {
    title: 'Runner connection lost',
    description: 'The runner stopped responding before the job finished. Try the job again.',
  },
  condition_errored: {
    title: 'Job condition could not be evaluated',
    description: 'Review the job condition and the values it references before trying again.',
  },
  output_too_large: {
    title: 'Job output is too large',
    description: 'Reduce the declared output before trying again.',
  },
  output_invalid: {
    title: 'Job output could not be used',
    description: 'Ensure every declared output resolves to a valid JSON value before trying again.',
  },
};

const PROVIDER_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  gitea: 'Gitea',
  github: 'GitHub',
  jira: 'Jira',
  linear: 'Linear',
  sentry: 'Sentry',
  slack: 'Slack',
};

export function onStepAttemptTerminatedFailureAnnotation(
  annotations: AnnotationsInterModuleClient,
) {
  return async (payload: WorkflowsStepAttemptTerminatedEventDto): Promise<void> => {
    // A first successful/cancelled attempt cannot have a stale failure annotation.
    // Keep later terminal attempts on the lookup path so recovery removes the
    // annotation created by an earlier failed attempt.
    if (payload.status !== undefined && payload.status !== 'failed' && payload.attempt === 1) {
      return;
    }

    try {
      const detail = await getCurrentStepAttemptDetail(payload);
      if (!detail || detail.attempt.attempt !== detail.step.currentAttempt) return;

      const runAttempt = await getWorkflowRunAttemptById(payload.workflowRunAttemptId);
      if (!runAttempt) return;

      await writeFailureAnnotation({
        annotations,
        target: {
          workspaceId: payload.workspaceId,
          projectId: payload.projectId,
          workflowRunId: payload.workflowRunId,
          workflowRunAttempt: runAttempt.attempt,
          workflowRunAttemptId: payload.workflowRunAttemptId,
          jobId: payload.jobId,
          jobExecutionId: detail.step.jobExecutionId,
          originStepId: detail.step.id,
          originStepAttempt: detail.attempt.attempt,
        },
        context: failureContext('step', detail.step.id),
        failed: currentStepAttemptFailed(detail),
        body: stepFailureBody(detail.step, detail.attempt),
      });
    } catch (error) {
      recordFailureAnnotationFailure(error, 'lookup', {
        stepId: payload.stepId,
        jobId: payload.jobId,
      });
    }
  };
}

async function getCurrentStepAttemptDetail(payload: WorkflowsStepAttemptTerminatedEventDto) {
  const initialDetail = await getStepAttemptDetail({
    stepId: payload.stepId,
    attempt: payload.attempt,
  });
  if (!initialDetail) return undefined;

  // The detail query joins the requested attempt to the step's current projection. A
  // delayed event can therefore return an old attempt alongside a newer step status. Read
  // the canonical current attempt before deciding whether to replace or remove the card.
  if (initialDetail.attempt.attempt === initialDetail.step.currentAttempt) return initialDetail;
  return getStepAttemptDetail({
    stepId: initialDetail.step.id,
    attempt: initialDetail.step.currentAttempt,
  });
}

function currentStepAttemptFailed(
  detail: NonNullable<Awaited<ReturnType<typeof getStepAttemptDetail>>>,
): boolean {
  if (detail.step.status === 'failed') return true;
  if (detail.attempt.status !== 'failed') return false;
  return detail.step.status !== 'succeeded' && detail.step.status !== 'cancelled';
}

export function onJobTerminatedFailureAnnotation(annotations: AnnotationsInterModuleClient) {
  return async (payload: WorkflowsJobTerminatedEventDto): Promise<void> => {
    // Step failures already have a step-scoped annotation. Job-scoped annotations
    // are reserved for terminal causes where no step-level failure card exists.
    const isConditionEvaluationFailure =
      payload.status === 'skipped' && payload.statusReason === 'condition_errored';
    if (
      (payload.status !== 'failed' && !isConditionEvaluationFailure) ||
      !JOB_FAILURE_ANNOTATION_REASONS.has(payload.statusReason ?? '')
    ) {
      return;
    }

    try {
      const [scope, runAttempt] = await Promise.all([
        getJobScope(payload.jobId),
        getWorkflowRunAttemptById(payload.workflowRunAttemptId),
      ]);
      if (!scope || !runAttempt || !payload.jobExecutionId) return;

      const origin = await getJobExecutionFailureOrigin(payload.jobExecutionId);
      if (!origin) return;

      await writeFailureAnnotation({
        annotations,
        target: {
          workspaceId: scope.workspaceId,
          projectId: scope.projectId,
          workflowRunId: payload.workflowRunId,
          workflowRunAttempt: runAttempt.attempt,
          workflowRunAttemptId: payload.workflowRunAttemptId,
          jobId: payload.jobId,
          jobExecutionId: origin.jobExecutionId,
          originStepId: origin.stepId,
          originStepAttempt: origin.stepAttempt,
        },
        context: failureContext('job', payload.jobId),
        failed: true,
        body: jobFailureBody(payload.statusReason, origin),
      });
    } catch (error) {
      recordFailureAnnotationFailure(error, 'lookup', {jobId: payload.jobId});
    }
  };
}

type FailureAnnotationTarget = {
  workspaceId: string;
  projectId: string;
  workflowRunId: string;
  workflowRunAttempt: number;
  workflowRunAttemptId: string;
  jobId: string;
  jobExecutionId: string;
  originStepId: string;
  originStepAttempt: number;
};

/**
 * Failure annotations are a best-effort projection. The workflow terminal fact is authoritative;
 * projection lookup and writes are swallowed so they cannot change the workflow outcome. Every
 * swallowed error emits a reason-labelled metric and a structured warning for operations.
 */
async function writeFailureAnnotation(params: {
  annotations: AnnotationsInterModuleClient;
  target: FailureAnnotationTarget;
  context: string;
  failed: boolean;
  body: string;
}): Promise<void> {
  try {
    await params.annotations.replaceOrRemoveAnnotation({
      ...params.target,
      context: params.context,
      annotation: params.failed
        ? {op: 'replace', style: 'error', body: params.body}
        : {op: 'remove'},
    });
  } catch (error) {
    const reason = isInterModuleKnownError(
      annotationsInterModuleContract.methods.replaceOrRemoveAnnotation,
      error,
    )
      ? 'budget'
      : 'write';
    recordFailureAnnotationFailure(error, reason, params.target);
  }
}

function failureContext(kind: 'job' | 'step', id: string): string {
  return `failure:${kind}:${id}`;
}

function stepFailureBody(step: Step, attempt: StepAttempt): string {
  const copy = stepFailureCopy(step, attempt);
  const details = stepFailureSizeDetails(attempt.error ?? step.error);
  return [
    `**${copy.title}**`,
    '',
    copy.description,
    ...(details === undefined ? [] : ['', details]),
  ].join('\n');
}

function stepFailureSizeDetails(error: Record<string, unknown> | null): string | undefined {
  if (!error) return undefined;
  const measuredBytes = error.measuredBytes;
  const limitBytes = error.limitBytes;
  if (
    typeof measuredBytes !== 'number' ||
    !Number.isFinite(measuredBytes) ||
    typeof limitBytes !== 'number' ||
    !Number.isFinite(limitBytes)
  ) {
    return undefined;
  }
  return `Measured ${measuredBytes} bytes; limit ${limitBytes} bytes.`;
}

function jobFailureBody(
  reason: JobStatusReason | null,
  origin: {
    stepName: string;
    attemptStatus: string | null;
  },
): string {
  const progress = origin.attemptStatus
    ? `The job stopped while processing **${origin.stepName}**.`
    : `The job stopped before **${origin.stepName}** started.`;
  const copy =
    (reason === null ? undefined : JOB_FAILURE_COPY[reason]) ??
    ({
      title: 'Job could not finish',
      description: 'Try the job again. If the problem continues, contact support.',
    } satisfies FailureCopy);
  return [`**${copy.title}**`, '', progress, '', copy.description].join('\n');
}

function stepFailureCopy(step: Step, attempt: StepAttempt): FailureCopy {
  const error = attempt.error ?? step.error;
  const reason = errorReason(error);
  const toolFailure = toolStepFailureCopy(step, attempt, error, reason);
  if (toolFailure !== undefined) return toolFailure;

  const gateFailure = gateFailureCopy(attempt, reason);
  if (gateFailure !== undefined) return gateFailure;

  if (reason === 'agent_config_invalid') return agentConfigFailureCopy(error);
  if (reason === 'invocation_interrupted') return interruptedToolFailureCopy(step);

  return knownStepFailureCopy(reason);
}

function toolStepFailureCopy(
  step: Step,
  attempt: StepAttempt,
  error: Record<string, unknown> | null,
  reason: string | undefined,
): FailureCopy | undefined {
  if (step.type !== 'tool') return undefined;
  if (successfulToolCall(attempt)) {
    return successfulToolFailureCopy(step, attempt, error, reason);
  }
  return reason === 'gate_failed' || gateConditionFailed(attempt)
    ? STEP_FAILURE_COPY.tool_error
    : undefined;
}

function successfulToolFailureCopy(
  step: Step,
  attempt: StepAttempt,
  error: Record<string, unknown> | null,
  reason: string | undefined,
): FailureCopy | undefined {
  if (gateCouldNotUseToolResult(attempt, error)) {
    return {
      title: 'Step validation failed',
      description: `The ${toolCallName(step)} succeeded, but Shipfox could not evaluate the step's success condition. No workflow configuration change is required.`,
    };
  }

  if (gateEvaluationFailed(attempt)) {
    return {
      title: 'Step validation failed',
      description: `The ${toolCallName(step)} succeeded, but Shipfox could not evaluate the step's success condition. Review the condition and the values it references.`,
    };
  }

  if (reason === 'gate_failed' || gateConditionFailed(attempt)) {
    return {
      title: 'Step validation failed',
      description: `The ${toolCallName(step)} succeeded, but the step's success condition was not met. Review the result and success condition.`,
    };
  }

  if (reason === 'output_invalid') {
    return {
      title: 'Tool result could not be used',
      description: `The ${toolCallName(step)} succeeded, but Shipfox could not use its result as the step output. Review the declared outputs before trying again.`,
    };
  }

  return undefined;
}

function gateFailureCopy(
  attempt: StepAttempt,
  reason: string | undefined,
): FailureCopy | undefined {
  if (reason === 'gate_failed' || gateConditionFailed(attempt)) {
    return {
      title: 'Step validation failed',
      description:
        "The step completed, but its success condition was not met. Review the step's result and success condition before trying again.",
    };
  }

  return reason === 'gate_uncheckable'
    ? {
        title: 'Step validation failed',
        description:
          "Shipfox could not evaluate the step's success condition. Review the condition and the values it references before trying again.",
      }
    : undefined;
}

function agentConfigFailureCopy(error: Record<string, unknown> | null): FailureCopy {
  const fallback = {
    title: 'Agent configuration needs attention',
    description: 'Review the agent step configuration before trying again.',
  } satisfies FailureCopy;
  const issue = errorString(error, 'agentConfigIssue');
  return issue === undefined
    ? fallback
    : (AGENT_CONFIG_FAILURE_COPY[issue as AgentConfigIssueDto] ?? fallback);
}

function interruptedToolFailureCopy(step: Step): FailureCopy {
  return toolSensitivity(step) === 'write'
    ? {
        title: 'Tool call outcome is uncertain',
        description:
          'The connected service may have completed the request. Check it before trying again.',
      }
    : {
        title: 'Tool call was interrupted',
        description: 'Shipfox could not confirm the result. Try again.',
      };
}

function knownStepFailureCopy(reason: string | undefined): FailureCopy {
  return reason === undefined
    ? {
        title: 'Step failed',
        description: 'Shipfox could not complete this step. Try again or review the step logs.',
      }
    : (STEP_FAILURE_COPY[reason as keyof typeof STEP_FAILURE_COPY] ?? {
        title: 'Step failed',
        description: 'Shipfox could not complete this step. Try again or review the step logs.',
      });
}

function successfulToolCall(attempt: StepAttempt): boolean {
  return attempt.invocations.some((invocation) => invocation.outcome === 'success');
}

function gateCouldNotUseToolResult(
  attempt: StepAttempt,
  error: Record<string, unknown> | null,
): boolean {
  return (
    errorReason(error) === 'gate_uncheckable' &&
    (errorString(error, 'message') === 'step produced no exit code' ||
      errorString(attempt.gateResult, 'reason') === 'step produced no exit code')
  );
}

function gateConditionFailed(attempt: StepAttempt): boolean {
  return attempt.gateResult?.passed === false && attempt.gateResult.uncheckable !== true;
}

function gateEvaluationFailed(attempt: StepAttempt): boolean {
  return errorString(attempt.gateResult, 'reason') === GATE_EVALUATION_ERROR_REASON;
}

function errorReason(error: Record<string, unknown> | null): string | undefined {
  return errorString(error, 'reason') ?? errorString(error, 'kind');
}

function errorString(error: Record<string, unknown> | null, key: string): string | undefined {
  const value = error?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function toolCallName(step: Step): string {
  const provider = toolProvider(step);
  return provider === undefined ? 'tool call' : `${provider} call`;
}

function toolProvider(step: Step): string | undefined {
  const tool = step.config.tool;
  if (tool === null || typeof tool !== 'object' || Array.isArray(tool)) return undefined;
  const provider = 'provider' in tool ? tool.provider : undefined;
  return typeof provider === 'string' ? PROVIDER_DISPLAY_NAMES[provider] : undefined;
}

function toolSensitivity(step: Step): string | undefined {
  const tool = step.config.tool;
  if (tool === null || typeof tool !== 'object' || Array.isArray(tool)) return undefined;
  const sensitivity = 'sensitivity' in tool ? tool.sensitivity : undefined;
  return typeof sensitivity === 'string' ? sensitivity : undefined;
}

function recordFailureAnnotationFailure(
  error: unknown,
  reason: 'lookup' | 'budget' | 'write',
  context: Record<string, string | number>,
): void {
  recordWorkflowFailureAnnotationFailed(reason);
  logger().warn({error, reason, ...context}, 'Failed to project workflow failure annotation');
}
