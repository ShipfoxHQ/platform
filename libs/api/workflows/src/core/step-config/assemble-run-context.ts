import {
  analyzeContextPathAccess,
  type ContextPathReference,
  type ContextPathSegment,
  type ExpressionType,
  extractExactContextRoots,
  getWorkflowPredicateContextRoots,
  rehydrateJsonExpressionRecord,
  type WorkflowExpressionEvaluationContext,
  type WorkflowPredicateContextRoot,
} from '@shipfox/expression';
import type {Job, JobListeningTrigger} from '#core/entities/job.js';
import type {JobExecution, WorkflowExecutionEvent} from '#core/entities/job-execution.js';
import type {Step, StepAttempt, StepStatus} from '#core/entities/step.js';
import type {
  TriggerPayload,
  WorkflowRun,
  WorkflowRunTriggerReference,
} from '#core/entities/workflow-run.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

export interface JobContextInput {
  readonly job: Pick<Job, 'key' | 'status' | 'outputs'>;
  readonly outputTypes?: Readonly<Record<string, ExpressionType>>;
  readonly executions: readonly JobExecution[];
}

export interface AssembleJobsContextOptions {
  readonly skipTypedOutputRehydration?: boolean;
  readonly skipCelNativeRehydration?: boolean;
}

export interface AssembleWorkflowRunContextParams {
  readonly run: Pick<
    WorkflowRun,
    | 'id'
    | 'number'
    | 'currentAttempt'
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

interface AssembleContextOptions extends AssembleJobsContextOptions {}

export function assembleWorkflowRunContext(
  params: AssembleWorkflowRunContextParams,
  options: AssembleContextOptions = {},
): WorkflowExpressionEvaluationContext {
  const triggerReference = params.run.triggerReference;
  return {
    workflow: {
      id: params.run.definitionId,
      name: params.run.workflowName,
    },
    run: {
      id: params.run.id,
      number:
        options.skipCelNativeRehydration === true ? params.run.number : BigInt(params.run.number),
      attempt:
        options.skipCelNativeRehydration === true
          ? params.run.currentAttempt
          : BigInt(params.run.currentAttempt),
      name: params.run.name,
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
  outputTypes?: Readonly<Record<string, ExpressionType>>,
  options: AssembleContextOptions = {},
): WorkflowExpressionEvaluationContext {
  return {
    executions: executions.map((execution, index) =>
      assembleExecutionContext(execution, index, outputTypes, options),
    ),
  };
}

function assembleExecutionContext(
  execution: JobExecution,
  index: number,
  outputTypes?: Readonly<Record<string, ExpressionType>>,
  options: AssembleContextOptions = {},
): Record<string, unknown> {
  const skipCelNativeRehydration = options.skipCelNativeRehydration === true;
  return {
    index: skipCelNativeRehydration ? index : BigInt(index),
    name: execution.name,
    status: execution.status,
    started_at: execution.startedAt,
    finished_at: execution.finishedAt,
    events: skipCelNativeRehydration
      ? execution.triggerEvents
      : execution.triggerEvents.map(assembleExecutionEventContext),
    outputs:
      options.skipTypedOutputRehydration === true
        ? (execution.outputs ?? {})
        : rehydrateJsonExpressionRecord(execution.outputs, outputTypes),
  };
}

function assembleExecutionEventContext(event: WorkflowExecutionEvent): Record<string, unknown> {
  const receivedAt = new Date(event.received_at);
  /**
   * An unparseable stored timestamp would become an `Invalid Date`, which compares
   * false against every CEL `timestamp` and throws on `toISOString` during template
   * resolution. Keeping the raw value fails loudly as a type mismatch instead.
   */
  if (Number.isNaN(receivedAt.getTime())) return {...event};

  return {
    ...event,
    received_at: receivedAt,
  };
}

export function assembleJobsContext(
  jobs: readonly JobContextInput[],
  options: AssembleJobsContextOptions = {},
): WorkflowExpressionEvaluationContext & {readonly jobs: Record<string, unknown>} {
  return {
    jobs: Object.fromEntries(
      jobs.map((input) => [input.job.key, assembleJobContext(input, options)]),
    ),
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
      needs: params.jobs.map((input) => assembleJobContext(input, {})),
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
  readonly jobPaths: readonly ContextPathReference[];
  readonly jobsAreBroad: boolean;
}

export interface ListenerSnapshotPlan {
  readonly on: readonly MatcherSnapshotPlan[];
  readonly until: readonly MatcherSnapshotPlan[];
  readonly roots: ReadonlySet<ListenerSnapshotRoot>;
  readonly jobKeys: ReadonlySet<string>;
  readonly jobPaths: readonly ContextPathReference[];
  readonly jobsAreBroad: boolean;
}

export type ListenerFilterOutputTypes = Record<string, Record<string, ExpressionType>>;

export function planListenerFilterSnapshots(params: {
  readonly on: readonly JobListeningTrigger[];
  readonly until: readonly JobListeningTrigger[] | null;
}): ListenerSnapshotPlan {
  const roots = new Set<ListenerSnapshotRoot>();
  const jobKeys = new Set<string>();
  const on = params.on.map((matcher) => planMatcherFilterSnapshot('listener.on', matcher));
  const until = (params.until ?? []).map((matcher) =>
    planMatcherFilterSnapshot('listener.until', matcher),
  );
  const plans = [...on, ...until];
  for (const plan of plans) {
    for (const root of plan.roots) roots.add(root);
    for (const key of plan.jobKeys) jobKeys.add(key);
  }
  return {
    on,
    until,
    roots,
    jobKeys,
    jobPaths: plans.flatMap((plan) => plan.jobPaths),
    jobsAreBroad: plans.some((plan) => plan.jobsAreBroad),
  };
}

function planMatcherFilterSnapshot(
  field: ListenerPredicateField,
  matcher: JobListeningTrigger,
): MatcherSnapshotPlan {
  if (matcher.filter === undefined) {
    return {
      matcher,
      roots: new Set(),
      jobKeys: new Set(),
      jobPaths: [],
      jobsAreBroad: false,
    };
  }

  let roots: ListenerSnapshotRoot[];
  let jobPaths: readonly ContextPathReference[] = [];
  let jobsAreBroad = false;
  try {
    roots = extractExactContextRoots(matcher.filter).filter((root) =>
      isListenerSnapshotRoot(field, root),
    );
    if (roots.includes('jobs')) {
      const analysis = analyzeContextPathAccess(matcher.filter, ['jobs']);
      jobPaths = analysis.references;
      jobsAreBroad =
        analysis.unknown.length > 0 || analysis.references.some(isBroadJobsPathReference);
    }
  } catch {
    return {
      matcher,
      roots: new Set(),
      jobKeys: new Set(),
      jobPaths: [],
      jobsAreBroad: false,
    };
  }

  if (roots.length === 0) {
    return {
      matcher,
      roots: new Set(),
      jobKeys: new Set(),
      jobPaths: [],
      jobsAreBroad: false,
    };
  }

  const jobKeys = new Set(
    jobPaths.flatMap((reference) => {
      const [jobKey] = reference.segments;
      return typeof jobKey === 'string' && jobKey !== '*' ? [jobKey] : [];
    }),
  );
  return {matcher, roots: new Set(roots), jobKeys, jobPaths, jobsAreBroad};
}

function isBroadJobsPathReference(reference: ContextPathReference): boolean {
  const [jobKey] = reference.segments;
  return jobKey === undefined || jobKey === '*' || typeof jobKey !== 'string';
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
  addListenerRunContext(context, params);
  addListenerDirectContext(context, params);

  return context;
}

function addListenerRunContext(
  context: Record<string, unknown>,
  params: Parameters<typeof assembleListenerSnapshotContext>[0],
): void {
  const runRoots = ['workflow', 'run', 'trigger'] as const;
  if (!runRoots.some((root) => params.plan.roots.has(root))) return;

  const runContext = assembleWorkflowRunContext(
    {
      run: params.run,
      triggerPayload: params.triggerPayload,
      inputs: params.inputs,
      vars: params.vars,
    },
    {skipCelNativeRehydration: true},
  );
  for (const root of runRoots) {
    if (params.plan.roots.has(root)) context[root] = runContext[root];
  }
}

function addListenerDirectContext(
  context: Record<string, unknown>,
  params: Parameters<typeof assembleListenerSnapshotContext>[0],
): void {
  if (params.plan.roots.has('inputs')) context.inputs = params.inputs ?? null;
  if (params.plan.roots.has('vars')) context.vars = params.vars ?? {};
  if (params.plan.roots.has('job')) {
    context.job = {
      key: params.job.key,
      ...(params.job.name === undefined ? {} : {name: params.job.name ?? params.job.key}),
    };
  }
  if (params.plan.roots.has('jobs')) {
    context.jobs = requestedJobsContext(params.dependencyJobs, params.plan);
  }
}

function requestedJobsContext(
  dependencyJobs: readonly JobContextInput[],
  plan: Pick<ListenerSnapshotPlan, 'jobKeys' | 'jobPaths' | 'jobsAreBroad'>,
): Record<string, unknown> {
  // Listener snapshots cross a JSON outbox boundary; their type metadata is persisted separately.
  const options: AssembleJobsContextOptions = {
    skipCelNativeRehydration: true,
    skipTypedOutputRehydration: true,
  };
  const selected =
    plan.jobsAreBroad || plan.jobKeys.size === 0
      ? dependencyJobs
      : dependencyJobs.filter(({job}) => plan.jobKeys.has(job.key));
  const assembled = assembleJobsContext(selected, options).jobs;
  return projectJobsContext(assembled, plan);
}

export type ListenerTriggerWithSnapshot = JobListeningTrigger & {
  readonly filter_snapshot?: Record<string, unknown>;
  readonly filter_output_types?: ListenerFilterOutputTypes;
};

export function applyListenerFilterSnapshots(
  plans: readonly MatcherSnapshotPlan[],
  context: WorkflowExpressionEvaluationContext,
  outputTypes?: ListenerFilterOutputTypes,
): ListenerTriggerWithSnapshot[] {
  return plans.map((plan) => {
    const filterSnapshot = filterSnapshotForPlan(plan, context);
    if (filterSnapshot === undefined) return plan.matcher;

    const filterOutputTypes = filterOutputTypesForPlan(plan, context, outputTypes);

    return {
      ...plan.matcher,
      filter_snapshot: filterSnapshot,
      ...(filterOutputTypes === undefined ? {} : {filter_output_types: filterOutputTypes}),
    };
  });
}

export function listenerFilterOutputTypesForJobs(
  jobs: readonly JobContextInput[],
): ListenerFilterOutputTypes {
  return Object.fromEntries(
    jobs.flatMap(({job, outputTypes}) => {
      if (outputTypes === undefined) return [];

      // `dyn` values need no CEL-native rehydration. Remove only their metadata
      // branches so typed sibling outputs remain rehydratable while this
      // persisted outbox shape stays readable by older trigger consumers.
      const compatibleOutputTypes = Object.fromEntries(
        Object.entries(outputTypes).flatMap(([key, type]) => {
          const compatibleType = withoutDynamicType(type);
          return compatibleType === undefined ? [] : [[key, compatibleType] as const];
        }),
      );
      return Object.keys(compatibleOutputTypes).length === 0
        ? []
        : [[job.key, compatibleOutputTypes] as const];
    }),
  );
}

function withoutDynamicType(type: ExpressionType): ExpressionType | undefined {
  if (typeof type === 'string') return type;

  switch (type.kind) {
    case 'dyn':
      return undefined;
    case 'map':
      return type;
    case 'list': {
      const element = withoutDynamicType(type.element);
      return element === undefined ? undefined : {kind: 'list', element};
    }
    case 'object': {
      const fields = Object.fromEntries(
        Object.entries(type.fields).flatMap(([key, fieldType]) => {
          const compatibleType = withoutDynamicType(fieldType);
          return compatibleType === undefined ? [] : [[key, compatibleType] as const];
        }),
      );
      return Object.keys(type.fields).length > 0 && Object.keys(fields).length === 0
        ? undefined
        : {kind: 'object', fields};
    }
  }
}

function filterOutputTypesForPlan(
  plan: MatcherSnapshotPlan,
  context: WorkflowExpressionEvaluationContext,
  outputTypes: ListenerFilterOutputTypes | undefined,
): ListenerFilterOutputTypes | undefined {
  if (outputTypes === undefined || !plan.roots.has('jobs')) return undefined;

  const jobsSnapshot = jobsSnapshotForPlan(plan, context);
  if (jobsSnapshot === undefined) return undefined;

  const entries = Object.keys(jobsSnapshot).flatMap((jobKey) => {
    const types = outputTypes[jobKey];
    if (types === undefined) return [];
    const paths = outputTypePathsForJob(plan, jobKey);
    if (paths === undefined) return [];
    const projected = projectOutputTypes(types, paths);
    return projected === undefined ? [] : [[jobKey, projected] as const];
  });
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
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
  return projectJobsContext(jobsContext, plan);
}

function projectJobsContext(
  jobsContext: Record<string, unknown>,
  plan: Pick<MatcherSnapshotPlan, 'jobKeys' | 'jobPaths' | 'jobsAreBroad'>,
): Record<string, unknown> {
  if (plan.jobsAreBroad) return {...jobsContext};

  return Object.fromEntries(
    [...plan.jobKeys].flatMap((jobKey) => {
      const job = jobsContext[jobKey];
      if (!Object.hasOwn(jobsContext, jobKey)) return [];

      const paths = plan.jobPaths.flatMap((reference) => {
        const [referenceJobKey, ...path] = reference.segments;
        return referenceJobKey === jobKey ? [path] : [];
      });
      return [[jobKey, projectJobContext(job, paths)] as const];
    }),
  );
}

function projectJobContext(
  job: unknown,
  paths: readonly (readonly ContextPathSegment[])[],
): unknown {
  if (!isRecord(job)) return job;
  const compactPaths = compactProjectionPaths(paths);
  if (compactPaths.some((path) => path.length === 0)) return {...job};

  const projected = projectValueByPaths(job, compactPaths);
  if (!isRecord(projected)) return projected;

  return {
    ...(Object.hasOwn(job, 'key') ? {key: job.key} : {}),
    ...(Object.hasOwn(job, 'status') ? {status: job.status} : {}),
    ...projected,
  };
}

function compactProjectionPaths(
  paths: readonly (readonly ContextPathSegment[])[],
): readonly (readonly ContextPathSegment[])[] {
  const unique = new Map<string, readonly ContextPathSegment[]>();
  for (const path of paths) unique.set(JSON.stringify(path), path);

  const values = [...unique.values()];
  return values.filter(
    (path) =>
      !values.some(
        (candidate) =>
          candidate.length > path.length && isPathPrefix(path, candidate) && path.at(-1) === '*',
      ),
  );
}

function isPathPrefix(prefix: readonly ContextPathSegment[], path: readonly ContextPathSegment[]) {
  return prefix.every((segment, index) => segment === path[index]);
}

function projectValueByPaths(
  value: unknown,
  paths: readonly (readonly ContextPathSegment[])[],
): unknown {
  if (paths.some((path) => path.length === 0)) return value;
  if (Array.isArray(value)) return projectArrayByPaths(value, paths);
  if (!isRecord(value)) return value;
  if (paths.some((path) => path[0] === '*')) return value;

  const projected: Record<string, unknown> = {};
  for (const path of paths) {
    const segment = path[0];
    if (typeof segment !== 'string' || !Object.hasOwn(value, segment)) continue;

    const child = projectValueByPaths(value[segment], [path.slice(1)]);
    projected[segment] = mergeProjectedValues(projected[segment], child);
  }
  return projected;
}

function projectArrayByPaths(
  value: readonly unknown[],
  paths: readonly (readonly ContextPathSegment[])[],
): unknown[] {
  const indexedPaths = new Map<number, (readonly ContextPathSegment[])[]>();
  const elementPaths: (readonly ContextPathSegment[])[] = [];
  for (const path of paths) {
    const segment = path[0];
    const rest = path.slice(1);
    if (typeof segment === 'number' && Number.isSafeInteger(segment) && segment >= 0) {
      const pathsForIndex = indexedPaths.get(segment) ?? [];
      pathsForIndex.push(rest);
      indexedPaths.set(segment, pathsForIndex);
      continue;
    }
    elementPaths.push(segment === '*' ? rest : path);
  }

  if (elementPaths.length > 0) {
    return value.map((element, index) =>
      projectValueByPaths(element, [...elementPaths, ...(indexedPaths.get(index) ?? [])]),
    );
  }

  const lastIndex = Math.max(...indexedPaths.keys(), -1);
  return value.slice(0, lastIndex + 1).map((element, index) => {
    const pathsForIndex = indexedPaths.get(index);
    return pathsForIndex === undefined ? {} : projectValueByPaths(element, pathsForIndex);
  });
}

function mergeProjectedValues(left: unknown, right: unknown): unknown {
  if (left === undefined) return right;
  if (right === undefined) return left;
  if (Array.isArray(left) && Array.isArray(right)) {
    return Array.from({length: Math.max(left.length, right.length)}, (_, index) =>
      mergeProjectedValues(left[index], right[index]),
    );
  }
  if (!isRecord(left) || !isRecord(right)) return right;

  const merged: Record<string, unknown> = {...left};
  for (const [key, value] of Object.entries(right)) {
    merged[key] = mergeProjectedValues(merged[key], value);
  }
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function outputTypePathsForJob(
  plan: MatcherSnapshotPlan,
  jobKey: string,
): readonly (readonly ContextPathSegment[])[] | undefined {
  if (plan.jobsAreBroad) return [[]];

  const paths: (readonly ContextPathSegment[])[] = [];
  for (const reference of plan.jobPaths) {
    const [referenceJobKey, ...jobPath] = reference.segments;
    if (referenceJobKey !== jobKey) continue;
    const outputPath = outputPathFromJobPath(jobPath);
    if (outputPath !== undefined) paths.push(outputPath);
  }
  return paths.length === 0 ? undefined : compactProjectionPaths(paths);
}

function outputPathFromJobPath(
  path: readonly ContextPathSegment[],
): readonly ContextPathSegment[] | undefined {
  const outputsIndex = path.indexOf('outputs');
  if (outputsIndex === -1) return undefined;
  return path.slice(outputsIndex + 1);
}

function projectOutputTypes(
  types: Record<string, ExpressionType>,
  paths: readonly (readonly ContextPathSegment[])[],
): Record<string, ExpressionType> | undefined {
  if (paths.some((path) => path.length === 0)) return {...types};
  const projected = projectExpressionTypeRecord(types, paths);
  return Object.keys(projected).length === 0 ? undefined : projected;
}

function projectExpressionTypeRecord(
  types: Record<string, ExpressionType>,
  paths: readonly (readonly ContextPathSegment[])[],
): Record<string, ExpressionType> {
  const projected: Record<string, ExpressionType> = {};
  for (const path of paths) {
    const [key, ...rest] = path;
    if (key === '*' || typeof key !== 'string') return {...types};
    const type = types[key];
    if (type === undefined) continue;
    const projectedType = projectExpressionType(type, [rest]);
    if (projectedType !== undefined) {
      projected[key] = mergeProjectedExpressionTypes(projected[key], projectedType);
    }
  }
  return projected;
}

function mergeProjectedExpressionTypes(
  left: ExpressionType | undefined,
  right: ExpressionType,
): ExpressionType {
  if (left === undefined) return right;
  if (typeof left === 'object' && typeof right === 'object') {
    if (left.kind === 'object' && right.kind === 'object') {
      return {
        kind: 'object',
        fields: mergeProjectedExpressionTypeRecords(left.fields, right.fields),
      };
    }
    if (left.kind === 'list' && right.kind === 'list') {
      return {kind: 'list', element: mergeProjectedExpressionTypes(left.element, right.element)};
    }
  }
  return right;
}

function mergeProjectedExpressionTypeRecords(
  left: Readonly<Record<string, ExpressionType>>,
  right: Readonly<Record<string, ExpressionType>>,
): Record<string, ExpressionType> {
  const merged: Record<string, ExpressionType> = {...left};
  for (const [key, value] of Object.entries(right)) {
    merged[key] = mergeProjectedExpressionTypes(merged[key], value);
  }
  return merged;
}

function projectExpressionType(
  type: ExpressionType,
  paths: readonly (readonly ContextPathSegment[])[],
): ExpressionType | undefined {
  if (paths.some((path) => path.length === 0)) return type;
  if (typeof type === 'string') return type;

  switch (type.kind) {
    case 'dyn':
      return undefined;
    case 'map':
      return type;
    case 'list': {
      const elementPaths = paths.map((path) => {
        const segment = path[0];
        const rest = path.slice(1);
        return segment === '*' || typeof segment === 'number' ? rest : path;
      });
      const element = projectExpressionType(type.element, elementPaths);
      return element === undefined ? undefined : {kind: 'list', element};
    }
    case 'object': {
      const fields = projectExpressionTypeRecord(type.fields, paths);
      return {kind: 'object', fields};
    }
  }
}

function assembleJobContext(
  {job, outputTypes, executions}: JobContextInput,
  options: AssembleJobsContextOptions,
): Record<string, unknown> {
  const outputs =
    options.skipTypedOutputRehydration === true
      ? (job.outputs ?? {})
      : rehydrateJsonExpressionRecord(job.outputs, outputTypes);

  return {
    key: job.key,
    status: job.status,
    outputs,
    executions: assembleExecutionsContext(
      executions,
      options.skipTypedOutputRehydration === true ? undefined : outputTypes,
      options,
    ).executions,
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
              ...assembleExecutionContext(params.jobExecution, params.jobExecution.sequence - 1),
              failed: stepAttemptContext.stepsFailed,
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
