import {
  analyzeContextRootKeyAccess,
  extractExactContextRoots,
  getWorkflowPredicateContextRoots,
  type WorkflowExpressionEvaluationContext,
  type WorkflowPredicateContextRoot,
} from '@shipfox/expression';
import type {Job, JobListeningTrigger} from '#core/entities/job.js';
import type {JobExecution} from '#core/entities/job-execution.js';
import type {Step, StepAttempt, StepStatus} from '#core/entities/step.js';
import type {
  TriggerPayload,
  WorkflowRun,
  WorkflowRunTriggerReference,
} from '#core/entities/workflow-run.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

export interface JobContextInput {
  readonly job: Pick<Job, 'key' | 'status' | 'outputs'>;
  readonly executions: readonly JobExecution[];
}

export interface AssembleWorkflowRunContextParams {
  readonly run: Pick<
    WorkflowRun,
    | 'id'
    | 'number'
    | 'name'
    | 'workflowName'
    | 'definitionId'
    | 'projectId'
    | 'workspaceId'
    | 'createdAt'
  > & {readonly triggerReference?: WorkflowRunTriggerReference | null | undefined};
  readonly triggerPayload: TriggerPayload;
  readonly inputs?: Record<string, unknown> | null | undefined;
  readonly vars?: Record<string, string> | undefined;
}

export function assembleWorkflowRunContext(
  params: AssembleWorkflowRunContextParams,
): WorkflowExpressionEvaluationContext {
  const triggerReference = params.run.triggerReference;
  return {
    run: {
      id: params.run.id,
      number: params.run.number,
      name: params.run.name,
      workflow_name: params.run.workflowName,
      definition_id: params.run.definitionId,
      project_id: params.run.projectId,
      workspace_id: params.run.workspaceId,
      created_at: params.run.createdAt,
    },
    trigger: {
      source: params.triggerPayload.source,
      event: params.triggerPayload.event,
      project: triggerReference?.project ?? null,
      repository: triggerReference?.repository ?? null,
      ref: triggerReference?.ref ?? null,
      commit: triggerReference?.commit ?? null,
    },
    event: 'data' in params.triggerPayload ? params.triggerPayload.data : null,
    inputs: params.inputs ?? null,
    ...(params.vars === undefined ? {} : {vars: params.vars}),
  };
}

export function assembleCreationContext(
  params: AssembleWorkflowRunContextParams,
): WorkflowEvaluationContext {
  return {
    site: 'run-creation',
    values: assembleWorkflowRunContext(params),
  };
}

export interface AssembleExecutionCreationContextParams extends AssembleWorkflowRunContextParams {
  readonly job: Pick<Job, 'id' | 'key' | 'name'>;
  readonly sequence: number;
  readonly nameOverride: string | null;
  readonly executionName: string;
  readonly status: JobExecution['status'];
  readonly triggerEvents: readonly JobExecution['triggerEvents'][number][];
  readonly priorExecutions: readonly JobExecution[];
}

export function assembleExecutionCreationContext(
  params: AssembleExecutionCreationContextParams,
): WorkflowEvaluationContext {
  const execution: JobExecution = {
    id: `${params.job.id}:${params.sequence}`,
    jobId: params.job.id,
    sequence: params.sequence,
    nameOverride: params.nameOverride,
    name: params.executionName,
    runner: null,
    status: params.status,
    statusReason: null,
    triggerEvents: [...params.triggerEvents],
    outputs: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    queuedAt: null,
    startedAt: null,
    finishedAt: null,
    timedOutAt: null,
  };
  const executions = assembleExecutionsContext([...params.priorExecutions, execution]);
  const executionValues = executions.executions as unknown[];
  return {
    site: 'execution-creation',
    values: {
      ...assembleWorkflowRunContext(params),
      ...executions,
      job: {key: params.job.key, name: params.job.name ?? params.job.key},
      execution: executionValues.at(-1),
    },
  };
}

/**
 * Keeps job-success predicate values aligned with the registry's `executions`
 * type environment.
 */
export function assembleExecutionsContext(
  executions: readonly JobExecution[],
): WorkflowExpressionEvaluationContext {
  return {
    executions: executions.map((execution, index) => assembleExecutionContext(execution, index)),
  };
}

function assembleExecutionContext(execution: JobExecution, index: number): Record<string, unknown> {
  return {
    index,
    name: execution.name,
    status: execution.status,
    started_at: execution.startedAt,
    finished_at: execution.finishedAt,
    events: execution.triggerEvents,
    outputs: execution.outputs ?? {},
  };
}

export function assembleJobsContext(
  jobs: readonly JobContextInput[],
): WorkflowExpressionEvaluationContext & {readonly jobs: Record<string, unknown>} {
  return {
    jobs: Object.fromEntries(jobs.map((input) => [input.job.key, assembleJobContext(input)])),
  };
}

export interface AssembleJobActivationContextParams extends AssembleWorkflowRunContextParams {
  readonly jobs: readonly JobContextInput[];
}

export function assembleJobActivationContext(
  params: AssembleJobActivationContextParams,
): WorkflowEvaluationContext {
  return {
    site: 'job-activation',
    values: {
      ...assembleWorkflowRunContext(params),
      ...assembleJobsContext(params.jobs),
      needs: params.jobs.map(assembleJobContext),
      vars: params.vars ?? {},
    },
  };
}

type ListenerPredicateField = 'listener.on' | 'listener.until';
type ListenerSnapshotRoot = Exclude<WorkflowPredicateContextRoot<ListenerPredicateField>, 'event'>;

export interface MatcherSnapshotPlan {
  readonly matcher: JobListeningTrigger;
  readonly roots: ReadonlySet<ListenerSnapshotRoot>;
  readonly jobKeys: ReadonlySet<string>;
}

export interface ListenerSnapshotPlan {
  readonly on: readonly MatcherSnapshotPlan[];
  readonly until: readonly MatcherSnapshotPlan[];
  readonly roots: ReadonlySet<ListenerSnapshotRoot>;
  readonly jobKeys: ReadonlySet<string>;
}

export function planListenerFilterSnapshots(params: {
  readonly on: readonly JobListeningTrigger[];
  readonly until: readonly JobListeningTrigger[] | null;
}): ListenerSnapshotPlan {
  const roots = new Set<ListenerSnapshotRoot>();
  const jobKeys = new Set<string>();
  const on = params.on.map((matcher) =>
    planMatcherFilterSnapshot('listener.on', matcher, roots, jobKeys),
  );
  const until = (params.until ?? []).map((matcher) =>
    planMatcherFilterSnapshot('listener.until', matcher, roots, jobKeys),
  );
  return {on, until, roots, jobKeys};
}

function planMatcherFilterSnapshot(
  field: ListenerPredicateField,
  matcher: JobListeningTrigger,
  allRoots: Set<ListenerSnapshotRoot>,
  allJobKeys: Set<string>,
): MatcherSnapshotPlan {
  if (matcher.filter === undefined) return {matcher, roots: new Set(), jobKeys: new Set()};

  let roots: ListenerSnapshotRoot[];
  try {
    roots = extractExactContextRoots(matcher.filter).filter((root) =>
      isListenerSnapshotRoot(field, root),
    );
  } catch {
    return {matcher, roots: new Set(), jobKeys: new Set()};
  }

  if (roots.length === 0) return {matcher, roots: new Set(), jobKeys: new Set()};

  const jobKeys =
    roots.includes('jobs') && matcher.filter !== undefined
      ? new Set(
          analyzeContextRootKeyAccess(matcher.filter, ['jobs']).references.map(
            (reference) => reference.key,
          ),
        )
      : new Set<string>();
  for (const root of roots) allRoots.add(root);
  for (const key of jobKeys) allJobKeys.add(key);
  return {matcher, roots: new Set(roots), jobKeys};
}

function isListenerSnapshotRoot(
  field: ListenerPredicateField,
  root: string,
): root is ListenerSnapshotRoot {
  return (
    root !== 'event' &&
    getWorkflowPredicateContextRoots(field).includes(
      root as WorkflowPredicateContextRoot<ListenerPredicateField>,
    )
  );
}

export function assembleListenerSnapshotContext(params: {
  readonly job: Pick<Job, 'key'> & Partial<Pick<Job, 'name'>>;
  readonly run: AssembleWorkflowRunContextParams['run'];
  readonly triggerPayload: TriggerPayload;
  readonly inputs?: Record<string, unknown> | null | undefined;
  readonly vars?: Record<string, string> | undefined;
  readonly plan: ListenerSnapshotPlan;
  readonly dependencyJobs: readonly JobContextInput[];
}): WorkflowExpressionEvaluationContext {
  const context: Record<string, unknown> = {};
  if (params.plan.roots.has('run') || params.plan.roots.has('trigger')) {
    const runContext = assembleWorkflowRunContext({
      run: params.run,
      triggerPayload: params.triggerPayload,
      inputs: params.inputs,
      vars: params.vars,
    });
    if (params.plan.roots.has('run')) context.run = runContext.run;
    if (params.plan.roots.has('trigger')) context.trigger = runContext.trigger;
  }

  if (params.plan.roots.has('inputs')) {
    context.inputs = params.inputs ?? null;
  }
  if (params.plan.roots.has('vars')) {
    context.vars = params.vars ?? {};
  }
  if (params.plan.roots.has('job')) {
    context.job = {
      key: params.job.key,
      ...(params.job.name === undefined ? {} : {name: params.job.name ?? params.job.key}),
    };
  }
  if (params.plan.roots.has('jobs')) {
    context.jobs = requestedJobsContext(params.dependencyJobs, params.plan.jobKeys);
  }

  return context;
}

function requestedJobsContext(
  dependencyJobs: readonly JobContextInput[],
  jobKeys: ReadonlySet<string>,
): Record<string, unknown> {
  if (jobKeys.size === 0) return assembleJobsContext(dependencyJobs).jobs;

  const filtered = dependencyJobs.filter(({job}) => jobKeys.has(job.key));

  return assembleJobsContext(filtered).jobs;
}

export type ListenerTriggerWithSnapshot = JobListeningTrigger & {
  readonly filter_snapshot?: Record<string, unknown>;
};

export function applyListenerFilterSnapshots(
  plans: readonly MatcherSnapshotPlan[],
  context: WorkflowExpressionEvaluationContext,
): ListenerTriggerWithSnapshot[] {
  return plans.map((plan) => {
    const filterSnapshot = filterSnapshotForPlan(plan, context);
    if (filterSnapshot === undefined) return plan.matcher;

    return {...plan.matcher, filter_snapshot: filterSnapshot};
  });
}

function filterSnapshotForPlan(
  plan: MatcherSnapshotPlan,
  context: WorkflowExpressionEvaluationContext,
): Record<string, unknown> | undefined {
  const snapshot: Record<string, unknown> = {};
  for (const root of plan.roots) {
    if (root === 'jobs') {
      const jobsSnapshot = jobsSnapshotForPlan(plan, context);
      if (jobsSnapshot !== undefined) snapshot.jobs = jobsSnapshot;
      continue;
    }

    if (root in context) snapshot[root] = context[root];
  }

  return Object.keys(snapshot).length === 0 ? undefined : snapshot;
}

function jobsSnapshotForPlan(
  plan: MatcherSnapshotPlan,
  context: WorkflowExpressionEvaluationContext,
): Record<string, unknown> | undefined {
  if (typeof context.jobs !== 'object' || context.jobs === null) {
    return undefined;
  }

  const jobsContext = context.jobs as Record<string, unknown>;
  if (plan.jobKeys.size === 0) return {...jobsContext};

  const snapshot = Object.fromEntries(
    [...plan.jobKeys].flatMap((key) =>
      Object.hasOwn(jobsContext, key) ? [[key, jobsContext[key]]] : [],
    ),
  );
  return snapshot;
}

function assembleJobContext({job, executions}: JobContextInput): Record<string, unknown> {
  return {
    key: job.key,
    status: job.status,
    outputs: job.outputs ?? {},
    executions: assembleExecutionsContext(executions).executions,
  };
}

function assembleStepsContext(params: {
  readonly steps: readonly Step[];
  readonly attempts: readonly StepAttempt[];
}): Record<string, Record<string, unknown>> {
  return buildStepAttemptContext(params).stepsContext;
}

function buildStepAttemptContext(params: {
  readonly steps: readonly Step[];
  readonly attempts: readonly StepAttempt[];
}): {
  readonly stepsContext: Record<string, Record<string, unknown>>;
  readonly stepsFailed: boolean;
  readonly orderedAttempts: readonly StepAttempt[];
  readonly stepsByKey: ReadonlyMap<string, Step>;
  readonly terminalAttemptsByStepId: ReadonlyMap<string, readonly StepAttempt[]>;
} {
  const stepsByKey = new Map(
    params.steps.flatMap((step) => (step.key === null ? [] : [[step.key, step] as const])),
  );
  const terminalAttemptsByStepId = new Map<string, StepAttempt[]>();
  const orderedAttempts = [...params.attempts].sort(
    (left, right) => left.executionOrder - right.executionOrder,
  );

  for (const attempt of orderedAttempts) {
    if (attempt.status === 'running') continue;
    const attemptsForStep = terminalAttemptsByStepId.get(attempt.stepId) ?? [];
    attemptsForStep.push(attempt);
    terminalAttemptsByStepId.set(attempt.stepId, attemptsForStep);
  }

  const stepsContext: Record<string, Record<string, unknown>> = {};

  for (const step of params.steps) {
    if (step.key === null) continue;
    const attempts = terminalAttemptsByStepId.get(step.id) ?? [];
    const latestAttempt = attempts.at(-1);
    stepsContext[step.key] = {
      status: step.status,
      ...(latestAttempt === undefined ? {} : latestAttemptFields(latestAttempt)),
      attempts: attempts.map(attemptFields),
    };
  }

  return {
    stepsContext,
    stepsFailed: params.steps.some((step) => step.status === 'failed'),
    orderedAttempts,
    stepsByKey,
    terminalAttemptsByStepId,
  };
}

export function assembleStepDispatchContext(params: {
  readonly steps: readonly Step[];
  readonly attempts: readonly StepAttempt[];
  readonly targetStepId: string;
  readonly jobExecution?: JobExecution;
  readonly jobs?: readonly JobContextInput[];
  readonly vars?: Record<string, string> | undefined;
}): WorkflowEvaluationContext {
  const targetStep = params.steps.find((step) => step.id === params.targetStepId);
  const stepAttemptContext = buildStepAttemptContext(params);
  const restart =
    targetStep === undefined || targetStep.currentAttempt <= 1
      ? undefined
      : restartProvenance({
          targetStep,
          orderedAttempts: stepAttemptContext.orderedAttempts,
          stepsByKey: stepAttemptContext.stepsByKey,
          terminalAttemptsByStepId: stepAttemptContext.terminalAttemptsByStepId,
        });

  return {
    site: 'step-dispatch',
    values: {
      vars: params.vars ?? {},
      ...assembleJobsContext(params.jobs ?? []),
      ...(params.jobExecution === undefined
        ? {}
        : {
            execution: {
              index: params.jobExecution.sequence,
              name: params.jobExecution.name,
              status: params.jobExecution.status,
              failed: stepAttemptContext.stepsFailed,
              started_at: params.jobExecution.startedAt,
              finished_at: params.jobExecution.finishedAt,
              events: params.jobExecution.triggerEvents,
              outputs: params.jobExecution.outputs ?? {},
            },
          }),
      ...(targetStep === undefined
        ? {}
        : {
            step: {
              attempt: BigInt(targetStep.currentAttempt),
              is_retry: targetStep.currentAttempt > 1,
              ...(restart === undefined ? {} : {restart}),
            },
          }),
      steps: stepAttemptContext.stepsContext,
    },
  };
}

function restartProvenance(params: {
  readonly targetStep: Step;
  readonly orderedAttempts: readonly StepAttempt[];
  readonly stepsByKey: ReadonlyMap<string, Step>;
  readonly terminalAttemptsByStepId: ReadonlyMap<string, readonly StepAttempt[]>;
}): Record<string, unknown> | undefined {
  for (const attempt of [...params.orderedAttempts].reverse()) {
    if (attempt.status !== 'failed' || attempt.restartFeedback === null) continue;
    const restartFromKey = restartFromStepKey(attempt);
    if (restartFromKey === undefined) continue;

    const restartFromStep = params.stepsByKey.get(restartFromKey);
    if (restartFromStep === undefined || restartFromStep.position > params.targetStep.position) {
      continue;
    }

    const gatingAttempts = params.terminalAttemptsByStepId.get(attempt.stepId) ?? [];
    return {
      from: {
        ...attemptFields(attempt),
        attempts: gatingAttempts.map(attemptFields),
      },
      feedback: attempt.restartFeedback,
    };
  }

  return undefined;
}

function restartFromStepKey(attempt: StepAttempt): string | undefined {
  const gate = attempt.config?.gate;
  if (gate === null || typeof gate !== 'object') return undefined;
  const onFailure = (gate as Record<string, unknown>).on_failure;
  if (onFailure === null || typeof onFailure !== 'object') return undefined;
  const restartFrom = (onFailure as Record<string, unknown>).restart_from;
  return typeof restartFrom === 'string' ? restartFrom : undefined;
}

function attemptFields(attempt: StepAttempt): Record<string, unknown> {
  return {
    status: attempt.status,
    outputs: attempt.output ?? {},
    ...(attempt.response === null ? {} : {response: attempt.response}),
    ...(attempt.exitCode === null ? {} : {exit_code: BigInt(attempt.exitCode)}),
    ...(attempt.gateResult === null ? {} : {gate: attempt.gateResult}),
  };
}

function latestAttemptFields(attempt: StepAttempt): Record<string, unknown> {
  const fields = attemptFields(attempt);
  delete fields.status;
  return fields;
}

export function assembleGateContext(params: {
  readonly status: StepStatus;
  readonly exitCode: number | null;
  readonly output?: Record<string, unknown> | null | undefined;
  readonly vars?: Record<string, string> | undefined;
}): WorkflowEvaluationContext {
  return {
    site: 'step-report',
    values: {
      vars: params.vars ?? {},
      step: {
        ...(params.exitCode === null ? {} : {exit_code: BigInt(params.exitCode)}),
        status: params.status,
        outputs: params.output ?? {},
      },
    },
  };
}

export function assembleJobResolutionContext(params: {
  readonly executions: readonly JobExecution[];
  readonly jobs: readonly JobContextInput[];
  readonly vars?: Record<string, string> | undefined;
}): WorkflowEvaluationContext {
  return {
    site: 'job-resolution',
    values: {
      ...assembleExecutionsContext(params.executions),
      ...assembleJobsContext(params.jobs),
      vars: params.vars ?? {},
    },
  };
}

export function assembleExecutionResolutionContext(params: {
  readonly run: AssembleWorkflowRunContextParams['run'];
  readonly triggerPayload: TriggerPayload;
  readonly inputs?: Record<string, unknown> | null | undefined;
  readonly vars?: Record<string, string> | undefined;
  readonly job: Pick<Job, 'key'> & Partial<Pick<Job, 'name'>>;
  readonly jobExecution: JobExecution;
  readonly executions: readonly JobExecution[];
  readonly steps: readonly Step[];
  readonly attempts: readonly StepAttempt[];
  readonly jobs?: readonly JobContextInput[];
}): WorkflowEvaluationContext {
  const executions = assembleExecutionsContext(params.executions);
  const executionIndex = params.executions.findIndex(
    (execution) => execution.id === params.jobExecution.id,
  );

  return {
    site: 'execution-resolution',
    values: {
      ...assembleWorkflowRunContext(params),
      ...executions,
      ...(params.jobs === undefined ? {} : assembleJobsContext(params.jobs)),
      execution: assembleExecutionContext(
        params.jobExecution,
        executionIndex < 0 ? params.jobExecution.sequence - 1 : executionIndex,
      ),
      job: {
        key: params.job.key,
        ...(params.job.name === undefined ? {} : {name: params.job.name ?? params.job.key}),
      },
      steps: assembleStepsContext({steps: params.steps, attempts: params.attempts}),
    },
  };
}
