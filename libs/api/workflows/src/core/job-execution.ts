import {setTimeout as sleep} from 'node:timers/promises';
import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import {agentInterModuleContract} from '@shipfox/api-agent-dto/inter-module';
import type {AgentStepSessionDescriptorDto, LogOutcomeDto} from '@shipfox/api-workflows-dto';
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
} from './errors.js';
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

type DispatchConfigError =
  | InterpolationUnresolvableError
  | AgentConfigUnresolvableError
  | AgentStepSessionClaimError;

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
): Promise<NextStep> {
  const steps = await getStepsByJobExecutionIdForUpdate(jobExecutionId, tx);
  const hasNoSteps = steps.length === 0;

  // An unknown or step-less execution has nothing to progress; rejecting it stops
  // a bad id from deriving a vacuous 'succeeded' completion below.
  if (hasNoSteps) throw new JobNotFoundError(jobExecutionId);

  // Re-deliver the in-flight step rather than advancing, so a retried pull
  // cannot skip a step.
  const running = steps.find((step) => step.status === 'running');
  const hasRunningStep = running !== undefined;
  if (hasRunningStep) return {kind: 'step', step: running, dispatched: false};

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
}: ResolvePendingStepParams): Promise<NextStep> {
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

async function dispatchPendingStep(params: PendingStepDispatchParams): Promise<NextStep> {
  const hasConfigPlan = params.pending.configPlan !== null;
  if (hasConfigPlan) return dispatchPendingStepWithConfigPlan(params);

  // Agent steps that name a session claim it at dispatch even when their config
  // is fully frozen (no dispatch plan): route them through the completion path,
  // which treats a plan-less step as a passthrough and performs the claim.
  const hasFrozenSession =
    params.pending.type === 'agent' && params.pending.config.session !== undefined;
  if (hasFrozenSession) return dispatchPendingStepWithConfigPlan(params);

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
}: PendingStepDispatchParams): Promise<NextStep> {
  try {
    const completed = await completeStepDispatchConfig({
      step: pending,
      context,
      resolveAgentDefaults: agent ? createAgentDefaultsResolver(agent, null) : undefined,
      definitionId: jobExecution.jobId,
    });
    // Open the attempt row before the claim: the claim stamps the attempt id,
    // and the release subscribers resolve claims by that id. The completed
    // config is recorded on the row first, then refreshed with the resolved
    // session descriptor once the claim lands.
    const stepAttemptId = await insertRunningStepAttempt(
      {
        jobExecutionId,
        stepId: pending.id,
        attempt: pending.currentAttempt,
        config: completed.config,
        evaluationTrace: completed.trace,
      },
      tx,
    );
    const config = await claimStepSessionForDispatch({
      config: completed.config,
      stepAttemptId,
      workflowContext,
      agent,
    });
    const marked = await dispatchStepWithCompletedConfig(
      {
        jobExecutionId,
        stepId: pending.id,
        config,
        evaluationTrace: completed.trace,
      },
      tx,
    );
    return {kind: 'step', step: marked ?? {...pending, config}, dispatched: true};
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

// Session claims are released asynchronously through the workflows outbox, so a
// dispatch racing its own previous attempt's termination can briefly find the
// claim still held by the attempt that just finished. Tolerate that window with
// a short bounded retry (a few outbox poll cycles) before failing the attempt
// deterministically; a genuine conflict with a live attempt fails after the
// same bound, never queueing.
const AGENT_SESSION_CLAIM_RETRY_ATTEMPTS = 8;
const AGENT_SESSION_CLAIM_RETRY_DELAY_MS = 250;

type StepSessionIntent = {key: string; mode: 'resume' | 'fork'};

function sessionIntentFromConfig(config: Record<string, unknown>): StepSessionIntent | undefined {
  const session = config.session;
  if (typeof session !== 'object' || session === null || Array.isArray(session)) return undefined;
  const candidate = session as Record<string, unknown>;
  if (typeof candidate.key !== 'string' || candidate.key === '') return undefined;
  if (candidate.mode !== 'resume' && candidate.mode !== 'fork') return undefined;
  return {key: candidate.key, mode: candidate.mode};
}

function configHarness(config: Record<string, unknown>): 'pi' | 'claude' | undefined {
  return config.harness === 'pi' || config.harness === 'claude' ? config.harness : undefined;
}

/**
 * Claims the step's named session at dispatch and embeds the resolved
 * descriptor in the dispatch config. Steps without a session, dispatches
 * without an attempt id (a racing re-dispatch), and forks of a session that
 * does not exist yet (null descriptor) carry no descriptor: the last drops the
 * authored session intent so the step runs fresh and creates nothing.
 */
async function claimStepSessionForDispatch(params: {
  readonly config: Record<string, unknown>;
  readonly stepAttemptId: string | undefined;
  readonly workflowContext: Awaited<ReturnType<typeof getWorkflowContextForJob>>;
  readonly agent?: AgentInterModuleClient | undefined;
}): Promise<Record<string, unknown>> {
  const session = sessionIntentFromConfig(params.config);
  if (session === undefined || params.agent === undefined || params.stepAttemptId === undefined) {
    return params.config;
  }

  const harness = configHarness(params.config);
  if (harness === undefined) {
    throw new AgentStepSessionClaimError(
      'agent_session_unavailable',
      'Agent session claim requires a resolved harness',
    );
  }

  const {descriptor} = await claimSessionWithRetry({
    agent: params.agent,
    workspaceId: params.workflowContext.workspaceId,
    projectId: params.workflowContext.projectId,
    workflowRunAttemptId: params.workflowContext.workflowRunAttemptId,
    key: session.key,
    harness,
    stepAttemptId: params.stepAttemptId,
    mode: session.mode,
  });

  if (descriptor === null) {
    const {session: _session, ...rest} = params.config;
    return rest;
  }
  return {...params.config, session: descriptor};
}

async function claimSessionWithRetry(params: {
  readonly agent: AgentInterModuleClient;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly workflowRunAttemptId: string;
  readonly key: string;
  readonly harness: 'pi' | 'claude';
  readonly stepAttemptId: string;
  readonly mode: 'resume' | 'fork';
}): Promise<{readonly descriptor: AgentStepSessionDescriptorDto | null}> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await params.agent.claimSession({
        workspaceId: params.workspaceId,
        projectId: params.projectId,
        workflowRunAttemptId: params.workflowRunAttemptId,
        key: params.key,
        harness: params.harness,
        stepAttemptId: params.stepAttemptId,
        mode: params.mode,
      });
    } catch (error) {
      if (!isInterModuleKnownError(agentInterModuleContract.methods.claimSession, error)) {
        throw error;
      }
      const code = error.code;
      const isTransient = code === 'session-held' || code === 'session-lock-unavailable';
      if (isTransient && attempt < AGENT_SESSION_CLAIM_RETRY_ATTEMPTS) {
        await sleep(AGENT_SESSION_CLAIM_RETRY_DELAY_MS);
        continue;
      }
      throw new AgentStepSessionClaimError(
        code === 'session-key-invalid'
          ? 'agent_session_key_invalid'
          : code === 'session-harness-mismatch'
            ? 'agent_session_harness_mismatch'
            : code === 'session-held'
              ? 'agent_session_held'
              : 'agent_session_unavailable',
        agentSessionClaimMessage(code),
      );
    }
  }
}

function agentSessionClaimMessage(code: string): string {
  switch (code) {
    case 'session-key-invalid':
      return 'Agent session key is invalid: the resolved key must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens, with a maximum length of 128 characters.';
    case 'session-held':
      return 'Agent session is claimed by another live attempt.';
    case 'session-harness-mismatch':
      return 'Agent session harness does not match the pinned harness.';
    case 'session-lock-unavailable':
      return 'Agent session is temporarily unavailable; retry the run.';
    default:
      return 'Agent session could not be claimed.';
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

function toDispatchConfigError(error: unknown): DispatchConfigError | null {
  const isInterpolationError = error instanceof InterpolationUnresolvableError;
  if (isInterpolationError) return error;

  const isAgentConfigError = error instanceof AgentConfigUnresolvableError;
  if (isAgentConfigError) return error;

  const isSessionClaimError = error instanceof AgentStepSessionClaimError;
  if (isSessionClaimError) return error;

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
  return withTransaction((tx) =>
    nextStepForJobExecutionInTransaction(params.jobExecutionId, tx, params.agent),
  );
}

export function nextStepForJob(
  jobId: string,
  agent?: AgentInterModuleClient | undefined,
): Promise<NextStep> {
  return withTransaction(async (tx) => {
    const jobExecution = await getLatestJobExecutionByJobId(jobId, tx);
    if (!jobExecution) throw new JobNotFoundError(jobId);

    return nextStepForJobExecutionInTransaction(jobExecution.id, tx, agent);
  });
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
