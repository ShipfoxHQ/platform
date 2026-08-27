import {harnessSchema} from '@shipfox/api-agent-dto';
import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import {agentInterModuleContract} from '@shipfox/api-agent-dto/inter-module';
import type {
  AgentStepSessionDescriptorDto,
  AgentStepSessionIntentDto,
  LogOutcomeDto,
} from '@shipfox/api-workflows-dto';
import {
  coerceStepOutputs,
  evaluatePlannedPredicateAtSite,
  type StepOutputCoercionError,
} from '@shipfox/expression';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {type Tx, withTransaction} from '#db/db.js';
import {
  countStepAttempts,
  dispatchStepWithCompletedConfig,
  finishStepAttempt,
  getDirectDependencyJobContexts,
  getJobExecutionById,
  getLatestJobExecutionByJobId,
  getStepAttemptsByJobExecutionId,
  getStepsByJobExecutionIdForUpdate,
  getWorkflowContextForJob,
  insertRunningStepAttempt,
  markStepRunning,
  markStepSkipped,
  settleJobFailed,
  writeJobStepsSettledOutbox,
} from '#db/workflow-runs.js';
import {
  recordWorkflowJobExecutionStepsSettled,
  recordWorkflowStepRestartEnqueued,
} from '#metrics/instance.js';
import {createAgentDefaultsResolver} from './agent-defaults.js';
import {defaultStepConditionTrace, explicitConditionTrace} from './condition-trace.js';
import type {JobExecution} from './entities/job-execution.js';
import type {PersistedEvaluationTraceEntry, Step, StepStatusReason} from './entities/step.js';
import {
  AgentConfigUnresolvableError,
  AgentStepSessionClaimError,
  InterpolationUnresolvableError,
  JobNotFoundError,
  StepAttemptAheadError,
  StepNotFoundError,
  StepNotRunningError,
  ToolConfigInvalidError,
} from './errors.js';
import {readAgentStepSessionIntent} from './step-config/agent.js';
import {assembleStepDispatchContext} from './step-config/assemble-run-context.js';
import {completeStepDispatchConfig} from './step-config/complete-step-dispatch-config.js';
import type {WorkflowEvaluationContext} from './step-config/workflow-evaluation-context.js';
import {
  applyStepTransition,
  type StepProgressionMetrics,
  type StepProgressionOutcome,
} from './step-transition/apply-step-transition.js';
import {
  decideStepTransition,
  deriveCompletion,
  isTerminal,
  type StepTransitionDecision,
} from './step-transition/decide-step-transition.js';
import {
  evaluateGate,
  evaluateGateFeedback,
  gateResultPayload,
  readStepGate,
} from './step-transition/evaluate-gate.js';
import {readStepOutputs} from './step-transition/read-step-outputs.js';
import type {RuntimeCompletionStatus} from './workflow-scheduling/runtime-dag.js';

type CompletionStatus = RuntimeCompletionStatus;

type ReportedStepResult = {
  readonly status: 'succeeded' | 'failed';
  readonly error: Record<string, unknown> | null;
  readonly output: Record<string, unknown> | null;
  readonly response: string | null;
  readonly exitCode: number | null;
};

export type NextStep =
  | {kind: 'step'; step: Step; dispatched: boolean}
  | {kind: 'done'; status: CompletionStatus};

interface PendingSessionClaim {
  readonly kind: 'session-claim';
  readonly jobExecutionId: string;
  readonly jobId: string;
  readonly stepId: string;
  readonly attempt: number;
  readonly stepAttemptId: string | undefined;
  readonly session: AgentStepSessionIntentDto;
  readonly config: Record<string, unknown>;
  readonly evaluationTrace: readonly PersistedEvaluationTraceEntry[] | null;
  readonly workflowContext: Awaited<ReturnType<typeof getWorkflowContextForJob>>;
  readonly agent?: AgentInterModuleClient | undefined;
}

type NextStepResolution = NextStep | PendingSessionClaim;

type DispatchConfigError =
  | InterpolationUnresolvableError
  | AgentConfigUnresolvableError
  | AgentStepSessionClaimError
  | ToolConfigInvalidError;

interface PendingStepDispatchParams {
  readonly jobExecutionId: string;
  readonly pending: Step;
  readonly jobExecution: JobExecution;
  readonly context: WorkflowEvaluationContext;
  readonly tx: Tx;
  readonly agent?: AgentInterModuleClient | undefined;
  readonly workflowContext: Awaited<ReturnType<typeof getWorkflowContextForJob>>;
}

interface ResolvePendingStepParams {
  readonly jobExecutionId: string;
  readonly steps: Step[];
  readonly jobExecution: JobExecution;
  readonly attempts: Awaited<ReturnType<typeof getStepAttemptsByJobExecutionId>>;
  readonly jobs: Awaited<ReturnType<typeof getDirectDependencyJobContexts>>;
  readonly vars: Record<string, string> | undefined;
  readonly tx: Tx;
  readonly agent?: AgentInterModuleClient | undefined;
  readonly workflowContext: Awaited<ReturnType<typeof getWorkflowContextForJob>>;
}

type StepConditionOutcome =
  | {kind: 'run'}
  | {
      kind: 'skip';
      statusReason: StepStatusReason;
      evaluationTrace: readonly PersistedEvaluationTraceEntry[];
    };

async function nextStepForJobExecutionInTransaction(
  jobExecutionId: string,
  tx: Tx,
  agent?: AgentInterModuleClient | undefined,
): Promise<NextStepResolution> {
  const steps = await getStepsByJobExecutionIdForUpdate(jobExecutionId, tx);
  const hasNoSteps = steps.length === 0;

  // An unknown or step-less execution has nothing to progress; rejecting it stops
  // a bad id from deriving a vacuous 'succeeded' completion below.
  if (hasNoSteps) throw new JobNotFoundError(jobExecutionId);

  // Re-deliver the in-flight step rather than advancing, so a retried pull
  // cannot skip a step.
  const running = steps.find((step) => step.status === 'running');
  const hasRunningStep = running !== undefined;
  if (hasRunningStep) {
    const session =
      running.type === 'agent' ? readAgentStepSessionIntent(running.config) : undefined;
    if (session !== undefined) {
      const jobExecution = await getJobExecutionById(jobExecutionId, tx);
      if (!jobExecution) throw new JobNotFoundError(jobExecutionId);

      const attempts = await getStepAttemptsByJobExecutionId(jobExecutionId, tx);
      const currentAttempt = attempts.find(
        (attempt) => attempt.stepId === running.id && attempt.attempt === running.currentAttempt,
      );
      const stepAttemptId =
        currentAttempt?.status === 'running'
          ? currentAttempt.id
          : await insertRunningStepAttempt(
              {
                jobExecutionId,
                stepId: running.id,
                attempt: running.currentAttempt,
                config: running.config,
                evaluationTrace: running.evaluationTrace,
              },
              tx,
            );
      const workflowContext = await getWorkflowContextForJob(jobExecution.jobId, tx);

      return {
        kind: 'session-claim',
        jobExecutionId,
        jobId: jobExecution.jobId,
        stepId: running.id,
        attempt: running.currentAttempt,
        stepAttemptId,
        session,
        config: running.config,
        evaluationTrace: currentAttempt?.evaluationTrace ?? running.evaluationTrace,
        workflowContext,
        agent,
      };
    }
    return {kind: 'step', step: running, dispatched: false};
  }

  const firstPending = steps.find((step) => step.status === 'pending');
  const hasPendingStep = firstPending !== undefined;
  if (!hasPendingStep) return {kind: 'done', status: deriveCompletion(steps)};

  const jobExecution = await getJobExecutionById(jobExecutionId, tx);
  if (!jobExecution) throw new JobNotFoundError(jobExecutionId);

  const attempts = await getStepAttemptsByJobExecutionId(jobExecutionId, tx);
  const jobs = await getDirectDependencyJobContexts(jobExecution.jobId, tx);
  const workflowContext = await getWorkflowContextForJob(jobExecution.jobId, tx);

  return resolveNextPendingStep({
    jobExecutionId,
    steps,
    jobExecution,
    attempts,
    jobs,
    vars: workflowContext.vars ?? undefined,
    workflowContext,
    tx,
    agent,
  });
}

async function resolveNextPendingStep({
  jobExecutionId,
  steps,
  jobExecution,
  attempts,
  jobs,
  vars,
  workflowContext,
  tx,
  agent,
}: ResolvePendingStepParams): Promise<NextStepResolution> {
  let skippedAny = false;
  let currentSteps = steps;

  while (true) {
    const pending = currentSteps.find((step) => step.status === 'pending');
    if (pending === undefined) {
      const status = deriveCompletion(currentSteps);
      if (skippedAny) {
        await writeJobStepsSettledOutbox(tx, {
          jobId: jobExecution.jobId,
          jobExecutionId,
          status,
        });
        recordWorkflowJobExecutionStepsSettled(status);
      }
      return {kind: 'done', status};
    }

    const context = assembleStepDispatchContext({
      steps: currentSteps,
      attempts,
      targetStepId: pending.id,
      jobExecution,
      jobs,
      vars,
    });
    const condition = evaluateStepCondition({step: pending, context});
    if (condition.kind === 'run') {
      return dispatchPendingStep({
        jobExecutionId,
        pending,
        jobExecution,
        context,
        workflowContext,
        tx,
        agent,
      });
    }

    const skipped = await markStepSkipped(
      {
        jobExecutionId,
        stepId: pending.id,
        statusReason: condition.statusReason,
        evaluationTrace: condition.evaluationTrace,
      },
      tx,
    );
    const skippedStep = skipped ?? {
      ...pending,
      status: 'skipped' as const,
      statusReason: condition.statusReason,
      evaluationTrace: condition.evaluationTrace,
      error: null,
    };
    currentSteps = currentSteps.map((step) => (step.id === pending.id ? skippedStep : step));
    skippedAny = true;
  }
}

async function dispatchPendingStep(params: PendingStepDispatchParams): Promise<NextStepResolution> {
  const hasConfigPlan = params.pending.configPlan !== null || params.pending.type === 'tool';
  if (hasConfigPlan) return dispatchPendingStepWithConfigPlan(params);

  // A fully resolved agent step still carries a session intent in its config.
  // Route it through the claim path even though no other field needs dispatch
  // completion.
  const hasSessionIntent =
    params.pending.type === 'agent' && params.pending.config.session !== undefined;
  if (hasSessionIntent) return dispatchPendingStepWithConfigPlan(params);

  const marked = await markStepRunning(
    {jobExecutionId: params.jobExecutionId, stepId: params.pending.id},
    params.tx,
  );
  return {kind: 'step', step: marked ?? params.pending, dispatched: true};
}

async function dispatchPendingStepWithConfigPlan({
  jobExecutionId,
  pending,
  jobExecution,
  context,
  workflowContext,
  tx,
  agent,
}: PendingStepDispatchParams): Promise<NextStepResolution> {
  try {
    const completed = await completeStepDispatchConfig({
      step: pending,
      context,
      resolveAgentDefaults: agent ? createAgentDefaultsResolver(agent, null) : undefined,
      definitionId: jobExecution.jobId,
    });
    const session = completed.sessionIntent;

    // Persist the attempt and resolved intent before calling the Agent module. The
    // claim is completed after this Workflows transaction commits, so a rollback
    // cannot leave an Agent lock owned by an attempt that does not exist.
    const stepAttemptId = await insertRunningStepAttempt(
      {
        jobExecutionId,
        stepId: pending.id,
        attempt: pending.currentAttempt,
      },
      tx,
    );
    const marked = await dispatchStepWithCompletedConfig(
      {
        jobExecutionId,
        stepId: pending.id,
        attempt: pending.currentAttempt,
        stepAttemptId,
        config: completed.config,
        evaluationTrace: completed.trace,
      },
      tx,
    );
    const step = marked ?? {...pending, config: completed.config};
    if (session !== undefined) {
      return {
        kind: 'session-claim',
        jobExecutionId,
        jobId: jobExecution.jobId,
        stepId: pending.id,
        attempt: pending.currentAttempt,
        stepAttemptId,
        session,
        config: step.config,
        evaluationTrace: completed.trace,
        workflowContext,
        agent,
      };
    }
    return {kind: 'step', step, dispatched: true};
  } catch (error) {
    const configError = toDispatchConfigError(error);
    const isConfigError = configError !== null;
    if (!isConfigError) throw error;

    const failureError = dispatchConfigError(configError);
    await insertRunningStepAttempt(
      {
        jobExecutionId,
        stepId: pending.id,
        attempt: pending.currentAttempt,
      },
      tx,
    );
    await finishStepAttempt(
      {
        stepId: pending.id,
        attempt: pending.currentAttempt,
        status: 'failed',
        error: failureError,
        logOutcome: 'abandoned',
      },
      tx,
    );
    const status = await settleJobFailed(tx, {
      jobId: jobExecution.jobId,
      jobExecutionId,
      failedStepId: pending.id,
      error: failureError,
    });
    if (status) recordWorkflowJobExecutionStepsSettled(status);
    return status === null
      ? nextStepForJobExecutionInTransaction(jobExecutionId, tx, agent)
      : {kind: 'done', status};
  }
}

function configHarness(config: Record<string, unknown>): 'pi' | 'claude' | undefined {
  const parsed = harnessSchema.safeParse(config.harness);
  return parsed.success ? parsed.data : undefined;
}

interface ClaimedStepSession {
  readonly config: Record<string, unknown>;
  readonly sessionId: string | undefined;
}

async function claimStepSessionForDispatch(params: {
  readonly config: Record<string, unknown>;
  readonly stepAttemptId: string | undefined;
  readonly session: AgentStepSessionIntentDto;
  readonly workflowContext: Awaited<ReturnType<typeof getWorkflowContextForJob>>;
  readonly agent?: AgentInterModuleClient | undefined;
}): Promise<ClaimedStepSession> {
  if (params.session.key.trim().length === 0) {
    throw new AgentStepSessionClaimError(
      'agent_session_key_invalid',
      'Agent session key is invalid',
    );
  }
  if (params.agent === undefined || params.stepAttemptId === undefined) {
    throw new AgentStepSessionClaimError(
      'agent_session_unavailable',
      'Agent session claim is unavailable for this step dispatch',
    );
  }

  const harness = configHarness(params.config);
  if (harness === undefined) {
    throw new AgentStepSessionClaimError(
      'agent_session_unavailable',
      'Agent session claim requires a resolved harness',
    );
  }

  let result: {readonly descriptor: AgentStepSessionDescriptorDto | null};
  try {
    result = await claimSessionWithRetry({
      agent: params.agent,
      workspaceId: params.workflowContext.workspaceId,
      projectId: params.workflowContext.projectId,
      workflowRunAttemptId: params.workflowContext.workflowRunAttemptId,
      key: params.session.key,
      harness,
      stepAttemptId: params.stepAttemptId,
      mode: params.session.mode,
    });
  } catch (error) {
    if (!isInterModuleKnownError(agentInterModuleContract.methods.claimSession, error)) {
      throw error;
    }
    throw new AgentStepSessionClaimError(
      agentSessionClaimReason(error.code),
      agentSessionClaimMessage(error.code),
    );
  }

  // A missing fork starts a fresh session and must not leak the authored intent
  // to the runner, which would otherwise try to load a non-existent transcript.
  if (result.descriptor === null) {
    const {session: _session, ...configWithoutSession} = params.config;
    return {config: configWithoutSession, sessionId: undefined};
  }
  return {config: {...params.config, session: result.descriptor}, sessionId: result.descriptor.id};
}

async function completePendingSessionClaim(
  pending: PendingSessionClaim,
): Promise<NextStepResolution> {
  let claimed: ClaimedStepSession;
  try {
    // This call deliberately happens after the transaction that persisted the
    // running attempt and authored session intent has committed.
    claimed = await claimStepSessionForDispatch({
      config: pending.config,
      stepAttemptId: pending.stepAttemptId,
      session: pending.session,
      workflowContext: pending.workflowContext,
      agent: pending.agent,
    });
  } catch (error) {
    const configError = toDispatchConfigError(error);
    if (configError === null) throw error;
    const failureError = dispatchConfigError(configError);
    return withTransaction((tx) => settlePreparedSessionClaimFailure(pending, failureError, tx));
  }

  const release = async (): Promise<void> => {
    if (claimed.sessionId === undefined || pending.stepAttemptId === undefined) return;
    await releaseClaim({
      agent: pending.agent,
      sessionId: claimed.sessionId,
      stepAttemptId: pending.stepAttemptId,
    });
  };

  try {
    const resolution = await withTransaction<
      | {readonly kind: 'dispatched'; readonly step: Step}
      | {readonly kind: 'release'; readonly next: NextStepResolution}
    >(async (tx) => {
      if (!(await isCurrentPendingSessionClaim(pending, tx))) {
        return {
          kind: 'release',
          next: await continueAfterStalePendingSessionClaim(pending, tx),
        };
      }

      const marked = await dispatchStepWithCompletedConfig(
        {
          jobExecutionId: pending.jobExecutionId,
          stepId: pending.stepId,
          attempt: pending.attempt,
          stepAttemptId: pending.stepAttemptId,
          config: claimed.config,
          evaluationTrace: pending.evaluationTrace,
        },
        tx,
      );
      if (marked) return {kind: 'dispatched', step: marked};

      // Another terminal transition won the race while the Agent call was in
      // flight. Re-read the durable projection and let the normal progression
      // logic decide whether this job is complete or needs another claim.
      return {
        kind: 'release',
        next: await nextStepForJobExecutionInTransaction(pending.jobExecutionId, tx, pending.agent),
      };
    });

    if (resolution.kind === 'release') {
      await release();
      return resolution.next;
    }
    return {kind: 'step', step: resolution.step, dispatched: true};
  } catch (error) {
    await release();
    throw error;
  }
}

async function settlePreparedSessionClaimFailure(
  pending: PendingSessionClaim,
  failureError: Record<string, unknown>,
  tx: Tx,
): Promise<NextStepResolution> {
  if (!(await isCurrentPendingSessionClaim(pending, tx))) {
    return continueAfterStalePendingSessionClaim(pending, tx);
  }

  // This is idempotent for a concurrently finalized attempt. If the attempt
  // was never persisted (or was already terminal), settling the step still
  // records the dispatch failure on the current projection.
  await insertRunningStepAttempt(
    {
      jobExecutionId: pending.jobExecutionId,
      stepId: pending.stepId,
      attempt: pending.attempt,
      config: pending.config,
      evaluationTrace: pending.evaluationTrace,
    },
    tx,
  );
  await finishStepAttempt(
    {
      stepId: pending.stepId,
      attempt: pending.attempt,
      status: 'failed',
      error: failureError,
      logOutcome: 'abandoned',
    },
    tx,
  );
  const status = await settleJobFailed(tx, {
    jobId: pending.jobId,
    jobExecutionId: pending.jobExecutionId,
    failedStepId: pending.stepId,
    error: failureError,
  });
  if (status) recordWorkflowJobExecutionStepsSettled(status);
  return status === null
    ? nextStepForJobExecutionInTransaction(pending.jobExecutionId, tx, pending.agent)
    : {kind: 'done', status};
}

async function isCurrentPendingSessionClaim(
  pending: PendingSessionClaim,
  tx: Tx,
): Promise<boolean> {
  const steps = await getStepsByJobExecutionIdForUpdate(pending.jobExecutionId, tx);
  const step = steps.find((candidate) => candidate.id === pending.stepId);
  if (step === undefined || step.status !== 'running' || step.currentAttempt !== pending.attempt) {
    return false;
  }
  if (pending.stepAttemptId === undefined) return true;

  const attempts = await getStepAttemptsByJobExecutionId(pending.jobExecutionId, tx);
  const attempt = attempts.find(
    (candidate) => candidate.stepId === pending.stepId && candidate.attempt === pending.attempt,
  );
  return attempt?.id === pending.stepAttemptId && attempt.status === 'running';
}

async function continueAfterStalePendingSessionClaim(
  pending: PendingSessionClaim,
  tx: Tx,
): Promise<NextStepResolution> {
  const steps = await getStepsByJobExecutionIdForUpdate(pending.jobExecutionId, tx);
  const currentStep = steps.find((step) => step.id === pending.stepId);
  // A newer attempt may already be in its own claim window. Return it without
  // re-entering session recovery, which would compete with that claim.
  if (currentStep?.status === 'running') {
    return {kind: 'step', step: currentStep, dispatched: false};
  }
  return nextStepForJobExecutionInTransaction(pending.jobExecutionId, tx, pending.agent);
}

function agentSessionClaimReason(
  code:
    | 'session-key-invalid'
    | 'session-held'
    | 'session-harness-mismatch'
    | 'session-lock-unavailable',
): AgentStepSessionClaimError['reason'] {
  switch (code) {
    case 'session-key-invalid':
      return 'agent_session_key_invalid';
    case 'session-held':
      return 'agent_session_held';
    case 'session-harness-mismatch':
      return 'agent_session_harness_mismatch';
    case 'session-lock-unavailable':
      return 'agent_session_unavailable';
  }
}

function agentSessionClaimMessage(
  code:
    | 'session-key-invalid'
    | 'session-held'
    | 'session-harness-mismatch'
    | 'session-lock-unavailable',
): string {
  switch (code) {
    case 'session-key-invalid':
      return 'Agent session key is invalid';
    case 'session-held':
      return 'Agent session is held by another live attempt';
    case 'session-harness-mismatch':
      return 'Agent session harness does not match the pinned harness';
    case 'session-lock-unavailable':
      return 'Agent session registry is unavailable';
  }
}

function evaluateStepCondition(params: {
  readonly step: Step;
  readonly context: WorkflowEvaluationContext;
}): StepConditionOutcome {
  const condition = params.step.condition;
  if (condition === null) {
    const execution = params.context.values.execution as {failed?: unknown} | undefined;
    return execution?.failed === true
      ? {
          kind: 'skip',
          statusReason: 'default_gate_rejected',
          evaluationTrace: defaultStepConditionTrace(),
        }
      : {kind: 'run'};
  }

  const outcome = evaluatePlannedPredicateAtSite({
    expression: condition,
    field: 'step.if',
    site: params.context.site,
    context: params.context.values,
  });
  const evaluationTrace = explicitConditionTrace({
    expression: condition,
    field: 'step.if',
    route: outcome.route,
    site: params.context.site,
    value: outcome.value,
    degraded: outcome.evaluationFailed,
  });
  if (outcome.evaluationFailed) {
    return {kind: 'skip', statusReason: 'condition_errored', evaluationTrace};
  }
  return outcome.value
    ? {kind: 'run'}
    : {kind: 'skip', statusReason: 'condition_rejected', evaluationTrace};
}

async function claimSessionWithRetry(
  params: Parameters<NonNullable<AgentInterModuleClient['claimSession']>>[0] & {
    agent: AgentInterModuleClient;
  },
): ReturnType<AgentInterModuleClient['claimSession']> {
  const {agent, ...input} = params;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await agent.claimSession(input);
    } catch (error) {
      const isHeld =
        isInterModuleKnownError(agentInterModuleContract.methods.claimSession, error) &&
        error.code === 'session-held';
      if (!isHeld || attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
    }
  }
}

async function releaseClaim(params: {
  agent: AgentInterModuleClient | undefined;
  sessionId: string;
  stepAttemptId: string;
}): Promise<void> {
  if (params.agent === undefined) return;
  try {
    await params.agent.releaseSession({
      sessionId: params.sessionId,
      stepAttemptId: params.stepAttemptId,
    });
  } catch {
    // Preserve the dispatch failure; stale-claim cleanup remains the fallback.
  }
}

function toDispatchConfigError(error: unknown): DispatchConfigError | null {
  const isInterpolationError = error instanceof InterpolationUnresolvableError;
  if (isInterpolationError) return error;

  const isAgentConfigError = error instanceof AgentConfigUnresolvableError;
  if (isAgentConfigError) return error;

  const isSessionClaimError = error instanceof AgentStepSessionClaimError;
  if (isSessionClaimError) return error;

  const isToolConfigError = error instanceof ToolConfigInvalidError;
  if (isToolConfigError) return error;

  return null;
}

function dispatchConfigError(error: DispatchConfigError): Record<string, unknown> {
  if (error instanceof InterpolationUnresolvableError) {
    return {
      message: error.message,
      reason: 'config_unresolvable',
      field: error.envKey === undefined ? error.field : `${error.field}.${error.envKey}`,
      source: error.source,
    };
  }

  if (error instanceof ToolConfigInvalidError) {
    return {
      message: error.message,
      reason: 'agent_config_invalid',
      field: 'tool',
      source: 'tool',
      code: error.code,
      agentConfigIssue: 'step_config_invalid',
    };
  }

  if (error instanceof AgentStepSessionClaimError) {
    return {
      message: error.message,
      reason: error.reason,
      field: 'agent.session',
      source: 'agent',
    };
  }

  const isManagedProviderPolicyFailure =
    error.code === 'workspace-providers-disabled' && error.managedProviderId !== undefined;
  return {
    message: error.message,
    reason: isManagedProviderPolicyFailure ? 'agent_config_invalid' : 'config_unresolvable',
    field: 'agent',
    source: 'agent',
    ...(error.code === undefined ? {} : {code: error.code}),
    ...(error.managedProviderId === undefined ? {} : {managedProviderId: error.managedProviderId}),
    ...(isManagedProviderPolicyFailure ? {agentConfigIssue: 'provider_unsupported'} : {}),
  };
}

export interface NextStepForLeasedJobExecutionParams {
  jobExecutionId: string;
  agent?: AgentInterModuleClient | undefined;
}

export function nextStepForLeasedJobExecution(
  params: NextStepForLeasedJobExecutionParams,
): Promise<NextStep> {
  return resolveNextStepWithSessionClaims(() =>
    withTransaction((tx) =>
      nextStepForJobExecutionInTransaction(params.jobExecutionId, tx, params.agent),
    ),
  );
}

export function nextStepForJob(
  jobId: string,
  agent?: AgentInterModuleClient | undefined,
): Promise<NextStep> {
  return resolveNextStepWithSessionClaims(() =>
    withTransaction(async (tx) => {
      const jobExecution = await getLatestJobExecutionByJobId(jobId, tx);
      if (!jobExecution) throw new JobNotFoundError(jobId);

      return nextStepForJobExecutionInTransaction(jobExecution.id, tx, agent);
    }),
  );
}

async function resolveNextStepWithSessionClaims(
  resolve: () => Promise<NextStepResolution>,
): Promise<NextStep> {
  let result = await resolve();
  while (result.kind === 'session-claim') {
    result = await completePendingSessionClaim(result);
  }
  return result;
}

export interface RecordStepResultParams {
  jobExecutionId: string;
  stepId: string;
  status: 'succeeded' | 'failed';
  error?: Record<string, unknown> | null;
  // Structured runner output feeds gate predicates and audit/history on the
  // attempt row; the current step projection keeps only status/error.
  output?: Record<string, unknown> | null;
  response?: string | null;
  exitCode?: number | null;
  // The attempt the runner was dispatched. Omitted = "the step's current
  // attempt" (back-compat for callers that don't track attempts yet).
  attempt?: number;
  logOutcome?: LogOutcomeDto;
}

export type RecordStepResultOutcome = StepProgressionOutcome;

interface RecordStepResultTransactionResult {
  outcome: RecordStepResultOutcome;
  metrics: StepProgressionMetrics;
}

function outcomeFromSteps(steps: Step[]): RecordStepResultOutcome {
  return steps.every((step) => isTerminal(step.status))
    ? {jobFinished: true, status: deriveCompletion(steps)}
    : {jobFinished: false};
}

export async function recordStepResult(
  params: RecordStepResultParams,
): Promise<RecordStepResultOutcome> {
  const progression = await withTransaction<RecordStepResultTransactionResult>((tx) =>
    recordStepResultInTransaction(params, tx),
  );

  recordStepProgressionMetrics(progression.metrics);

  return progression.outcome;
}

async function recordStepResultInTransaction(
  params: RecordStepResultParams,
  tx: Tx,
): Promise<RecordStepResultTransactionResult> {
  const jobExecutionId = params.jobExecutionId;

  const jobExecution = await getJobExecutionById(jobExecutionId, tx);
  if (!jobExecution) throw new JobNotFoundError(jobExecutionId);

  const steps = await getStepsByJobExecutionIdForUpdate(jobExecutionId, tx);
  const target = steps.find((step) => step.id === params.stepId);
  const hasTargetStep = target !== undefined;

  if (!hasTargetStep) throw new StepNotFoundError(params.stepId, jobExecutionId);

  const current = target.currentAttempt;
  const reported = params.attempt ?? current;
  const reportClassification = classifyReportedStep(target, reported, jobExecution.jobId);
  if (reportClassification instanceof Error) throw reportClassification;
  if (reportClassification === 'noop') return {outcome: outcomeFromSteps(steps), metrics: {}};

  // Migration/back-compat boundary: a running step may predate the
  // step_attempts table or have been marked running by legacy code. Create
  // the audit row just before finalization if dispatch did not already do it.
  await insertRunningStepAttempt(
    {
      jobExecutionId,
      stepId: params.stepId,
      attempt: current,
      config: target.config,
    },
    tx,
  );

  let result: ReportedStepResult = {
    status: params.status,
    error: params.error ?? null,
    output: params.output ?? null,
    response: params.response ?? null,
    exitCode: params.exitCode ?? null,
  };
  const outputCoercion = coerceReportedStepOutput(target.config, result);
  if (outputCoercion.kind === 'coerced') {
    result = {...result, output: outputCoercion.output};
  }
  if (outputCoercion.kind === 'failed') {
    result = {
      status: 'failed',
      error: outputInvalidError(outputCoercion.error),
      output: null,
      response: result.response,
      exitCode: result.exitCode,
    };
  }

  // Evaluate the gate (if any) at the service boundary. This is the only place
  // the CEL engine runs. Pass the precomputed outcome into the pure decision.
  const shouldEvaluateGate = outputCoercion.kind !== 'failed';
  const gate = shouldEvaluateGate ? readStepGate(target.config) : undefined;
  const vars =
    gate === undefined
      ? undefined
      : ((await getWorkflowContextForJob(jobExecution.jobId, tx)).vars ?? undefined);
  const gateOutcome = shouldEvaluateGate
    ? evaluateGate(gate, result, vars)
    : {kind: 'no-gate' as const};
  const hasRestartPolicy = gate?.onFailure?.restartFrom !== undefined;
  // The restart cap is bounded on the gating step's OWN attempts, not its
  // current_attempt (which a rewind inflates for downstream steps).
  const gatingAttemptCount = hasRestartPolicy
    ? await countStepAttempts(params.stepId, tx)
    : undefined;
  const decision = decideStepTransition({
    steps,
    target,
    reportedAttempt: reported,
    result,
    gateOutcome,
    ...(gate?.onFailure ? {gateOnFailure: gate.onFailure} : {}),
    ...(gatingAttemptCount !== undefined ? {gatingAttemptCount} : {}),
  });
  const resolvedDecision = resolveRestartFeedback({
    decision,
    gate,
    result,
    definitionId: jobExecution.jobId,
    vars,
  });

  return applyStepTransition(
    resolvedDecision,
    {
      jobId: jobExecution.jobId,
      jobExecutionId,
      result,
      logOutcome: params.logOutcome ?? 'drained',
      gateResult: gateResultPayload(gateOutcome, result.exitCode),
    },
    tx,
  );
}

type OutputCoercionResult =
  | {kind: 'not-applicable'}
  | {kind: 'coerced'; output: Record<string, unknown>}
  | {kind: 'failed'; error: StepOutputCoercionError};

export type ReportedStepClassification = 'proceed' | 'noop' | Error;

export function classifyReportedStep(
  target: Step,
  reportedAttempt: number,
  jobId: string,
): ReportedStepClassification {
  const currentAttempt = target.currentAttempt;
  if (reportedAttempt > currentAttempt) {
    return new StepAttemptAheadError(target.id, jobId, reportedAttempt, currentAttempt);
  }

  if (reportedAttempt < currentAttempt) return 'noop';
  if (isTerminal(target.status)) return 'noop';
  if (target.status === 'pending') return new StepNotRunningError(target.id, jobId);
  return 'proceed';
}

function coerceReportedStepOutput(
  config: Record<string, unknown>,
  result: ReportedStepResult,
): OutputCoercionResult {
  if (result.status !== 'succeeded') return {kind: 'not-applicable'};

  const declarations = readStepOutputs(config);
  if (declarations === undefined) return {kind: 'not-applicable'};

  const coerced = coerceStepOutputs({declarations, output: result.output});
  if (!coerced.ok) return {kind: 'failed', error: coerced.error};
  return {kind: 'coerced', output: coerced.output};
}

function outputInvalidError(error: StepOutputCoercionError): Record<string, unknown> {
  return {
    message: error.message,
    reason: 'output_invalid',
    field: `outputs.${error.key}`,
    outputKey: error.key,
    issue: error.reason,
    ...(error.expectedType === undefined ? {} : {expectedType: error.expectedType}),
    ...(error.schemaError === undefined ? {} : {schemaError: error.schemaError}),
  };
}

function resolveRestartFeedback(params: {
  decision: StepTransitionDecision;
  gate: ReturnType<typeof readStepGate>;
  result: ReportedStepResult;
  definitionId: string;
  vars?: Record<string, string> | undefined;
}): StepTransitionDecision {
  if (params.decision.kind !== 'restart-job-from-step') return params.decision;
  if (params.gate === undefined) return params.decision;

  try {
    return {
      ...params.decision,
      feedback: evaluateGateFeedback({
        gate: params.gate,
        result: params.result,
        definitionId: params.definitionId,
        vars: params.vars,
      }),
    };
  } catch (error) {
    if (error instanceof InterpolationUnresolvableError) {
      return {
        kind: 'fail-job',
        failedStepId: params.decision.failedStepId,
        attempt: params.decision.attempt,
        failureError: dispatchConfigError(error),
      };
    }
    throw error;
  }
}

function recordStepProgressionMetrics(metrics: StepProgressionMetrics): void {
  const settledStatus = metrics.jobStepsSettledStatus;
  const hasSettledStatus = settledStatus !== undefined;
  if (hasSettledStatus) recordWorkflowJobExecutionStepsSettled(settledStatus);

  const restartWasEnqueued = metrics.stepRestartEnqueued === true;
  if (restartWasEnqueued) recordWorkflowStepRestartEnqueued();
}
