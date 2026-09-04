import type {WorkflowExpressionEvaluationContext} from '../evaluator/evaluate-workflow-expression.js';
import type {ExpressionType, ExpressionTypeEnvironment} from '../expression/workflow-expression.js';
import {
  jsonSchemaToExpressionType,
  type OutputDeclarations,
  outputDeclarationsToExpressionFields,
} from '../outputs/output-declarations.js';

export const workflowContextNames = [
  'workflow',
  'run',
  'trigger',
  'event',
  'inputs',
  'job',
  'executions',
  'execution',
  'jobs',
  'needs',
  'steps',
  'step',
  'vars',
  'secrets',
] as const;
export type WorkflowContextName = (typeof workflowContextNames)[number];

export const availabilitySites = [
  // Server receives an external trigger or manual request before a run row exists.
  'ingest',
  // Server creates the workflow run and its run-scoped context.
  'run-creation',
  // Server creates a concrete job execution and its execution-scoped context.
  'execution-creation',
  // Server activates a queued job after dependencies, matrix expansion, and runner demand are known.
  'job-activation',
  // Server dispatches a job step to a runner with all server-filled context resolved.
  'step-dispatch',
  // Server receives a step report and makes step result context available.
  'step-report',
  // Server resolves one job execution after its steps have settled.
  'execution-resolution',
  // Server resolves the job after all of its executions are known.
  'job-resolution',
] as const;
export type AvailabilitySite = (typeof availabilitySites)[number];

export const runnerFillTarget = 'runner-fill';
export type FillTarget = AvailabilitySite | typeof runnerFillTarget;

export const workflowContextSensitivities = ['persistable', 'ephemeral'] as const;
export type WorkflowContextSensitivity = (typeof workflowContextSensitivities)[number];

export const workflowContextHosts = ['server', 'runner'] as const;
export type WorkflowContextHost = (typeof workflowContextHosts)[number];

export type ReservedRootDefinition =
  | {readonly host: 'server'; readonly availability: AvailabilitySite}
  | {readonly host: 'runner'};

export const workflowContextReservedRoots = {
  matrix: {host: 'server', availability: 'job-activation'},
  runner: {host: 'runner'},
  // The result of a tool step call; readable only from `tool.outputs` mappings.
  result: {host: 'server', availability: 'step-report'},
} as const satisfies Record<string, ReservedRootDefinition>;
export type WorkflowContextReservedRoot = keyof typeof workflowContextReservedRoots;

export type WorkflowContextShape = 'known' | 'open';

export interface TypedWorkflowContextDefinition {
  readonly availability: AvailabilitySite;
  readonly sensitivity: WorkflowContextSensitivity;
  readonly host: 'server';
  readonly shape: 'known';
  readonly checkMode: 'typed';
  readonly typeEnvironment: ExpressionTypeEnvironment;
}

export interface OpenWorkflowContextDefinition {
  readonly availability: AvailabilitySite;
  readonly sensitivity: WorkflowContextSensitivity;
  readonly host: 'server';
  readonly shape: 'open';
  readonly checkMode: 'syntax';
  readonly literalKeyOnly?: boolean;
}

export interface RunnerWorkflowContextDefinition {
  readonly sensitivity: 'ephemeral';
  readonly host: 'runner';
  readonly shape: 'open';
  readonly checkMode: 'syntax';
  readonly literalKeyOnly?: boolean;
}

export type WorkflowContextDefinition =
  | TypedWorkflowContextDefinition
  | OpenWorkflowContextDefinition
  | RunnerWorkflowContextDefinition;

// `workflow` holds definition facts and `run` holds instance facts, mirroring
// the `job` and `execution` pair one level down.
const workflowTypeEnvironment = {
  workflow: {
    kind: 'object',
    fields: {
      id: 'string',
      name: 'string',
    },
  },
} as const satisfies ExpressionTypeEnvironment;

const runTypeEnvironment = {
  run: {
    kind: 'object',
    fields: {
      id: 'string',
      number: 'int',
      name: 'string',
      project_id: 'string',
      workspace_id: 'string',
      created_at: 'timestamp',
    },
  },
} as const satisfies ExpressionTypeEnvironment;

const triggerReferenceFields = {
  project: {
    kind: 'object',
    fields: {id: 'string'},
  },
  repository: 'string',
  ref: 'string',
  commit: 'string',
} as const;

const triggerTypeEnvironment = {
  trigger: {
    kind: 'object',
    fields: {
      source: 'string',
      event: 'string',
      ...triggerReferenceFields,
    },
  },
} as const satisfies ExpressionTypeEnvironment;

const triggerFilterTypeEnvironment = {
  trigger: {
    kind: 'object',
    fields: {
      source: 'string',
      event: 'string',
    },
  },
} as const satisfies ExpressionTypeEnvironment;

const jobTypeEnvironment = {
  job: {
    kind: 'object',
    fields: {
      key: 'string',
      name: 'string',
    },
  },
} as const satisfies ExpressionTypeEnvironment;

const executionEventType = {
  kind: 'object',
  fields: {
    source: 'string',
    event: 'string',
    delivery_id: 'string',
    received_at: 'timestamp',
    ...triggerReferenceFields,
    data: {
      kind: 'map',
    },
  },
} as const;

const executionType = {
  kind: 'object',
  fields: {
    index: 'int',
    name: 'string',
    status: 'string',
    started_at: 'timestamp',
    finished_at: 'timestamp',
    events: {
      kind: 'list',
      element: executionEventType,
    },
    outputs: {kind: 'map'},
  },
} as const;

const executionsTypeEnvironment = {
  executions: {
    kind: 'list',
    element: executionType,
  },
} as const satisfies ExpressionTypeEnvironment;

const executionTypeEnvironment = {
  execution: {
    kind: 'object',
    fields: {
      ...executionType.fields,
      failed: 'bool',
    },
  },
} as const satisfies ExpressionTypeEnvironment;

const stepGateType = {
  kind: 'object',
  fields: {
    passed: 'bool',
    source: 'string',
    reason: 'string',
    exit_code: 'int',
  },
} as const;

const toolStepGateType = {
  kind: 'object',
  fields: {
    passed: 'bool',
    source: 'string',
    reason: 'string',
  },
} as const;

const stepAttemptType = {
  kind: 'object',
  fields: {
    status: 'string',
    exit_code: 'int',
    outputs: {kind: 'map'},
    response: 'string',
    gate: stepGateType,
  },
} as const;

const stepEntityType = {
  kind: 'object',
  fields: {
    ...stepAttemptType.fields,
    attempts: {
      kind: 'list',
      element: stepAttemptType,
    },
  },
} as const;

const stepDispatchTypeEnvironment = {
  step: {
    kind: 'object',
    fields: {
      attempt: 'int',
      is_retry: 'bool',
      restart: {
        kind: 'object',
        fields: {
          from: stepEntityType,
          feedback: 'string',
        },
      },
    },
  },
} as const satisfies ExpressionTypeEnvironment;

const stepReportTypeEnvironment = {
  step: {
    kind: 'object',
    fields: {
      exit_code: 'int',
      status: 'string',
      outputs: {kind: 'map'},
    },
  },
} as const satisfies ExpressionTypeEnvironment;

/**
 * Gate context for a tool step: `status` and `outputs`, with no `exit_code`
 * because a tool step never reports one.
 */
export const toolStepReportTypeEnvironment = {
  step: {
    kind: 'object',
    fields: {
      status: 'string',
      outputs: {kind: 'map'},
    },
  },
} as const satisfies ExpressionTypeEnvironment;

// A tool step never reports an exit code: the call outcome is the attempt
// status, and the gate context of a tool step reads `status` and `outputs` only.
const toolStepAttemptType = {
  kind: 'object',
  fields: {
    status: 'string',
    outputs: {kind: 'map'},
    response: 'string',
    gate: toolStepGateType,
  },
} as const;

// The self root of a tool step drops `exit_code` from the shared step fields.
const toolStepSelfTypeEnvironment = {
  step: {
    kind: 'object',
    fields: {
      ...stepDispatchTypeEnvironment.step.fields,
      status: 'string',
      outputs: {kind: 'map'},
    },
  },
} as const satisfies ExpressionTypeEnvironment;

const stepTypeEnvironment = {
  step: {
    kind: 'object',
    fields: {
      ...stepDispatchTypeEnvironment.step.fields,
      ...stepReportTypeEnvironment.step.fields,
    },
  },
} as const satisfies ExpressionTypeEnvironment;

type ObjectExpressionType = Extract<ExpressionType, {kind: 'object'}>;

export type WorkflowStepKind = 'run' | 'agent' | 'checkout' | 'tool';

export interface WorkflowStepTypeOverlay {
  readonly key: string;
  readonly kind?: WorkflowStepKind;
  readonly outputs?: OutputDeclarations;
  /**
   * Catalog output schema of a tool step. Types the implicit `result` output
   * that every tool step exposes, merged with the inferred mapped outputs.
   */
  readonly outputSchema?: unknown;
}

export interface WorkflowJobTypeOverlay {
  readonly key: string;
  readonly outputs?: Readonly<Record<string, ExpressionType>>;
}

export function buildTypedRootsEnvironment(params: {
  readonly steps?: readonly WorkflowStepTypeOverlay[];
  readonly currentStep?: WorkflowStepTypeOverlay;
  readonly jobs?: readonly WorkflowJobTypeOverlay[];
  readonly needs?: readonly WorkflowJobTypeOverlay[];
}): ExpressionTypeEnvironment {
  return {
    ...(params.steps === undefined ? {} : {steps: stepsRootType(params.steps)}),
    ...(params.currentStep === undefined ? {} : {step: selfStepType(params.currentStep)}),
    ...(params.jobs === undefined ? {} : {jobs: jobsRootType(params.jobs)}),
    ...(params.needs === undefined ? {} : {needs: needsRootType()}),
  };
}

export const workflowContextDefinitions = {
  workflow: {
    availability: 'run-creation',
    sensitivity: 'persistable',
    host: 'server',
    shape: 'known',
    checkMode: 'typed',
    typeEnvironment: workflowTypeEnvironment,
  },
  run: {
    availability: 'run-creation',
    sensitivity: 'persistable',
    host: 'server',
    shape: 'known',
    checkMode: 'typed',
    typeEnvironment: runTypeEnvironment,
  },
  trigger: {
    availability: 'ingest',
    sensitivity: 'persistable',
    host: 'server',
    shape: 'known',
    checkMode: 'typed',
    typeEnvironment: triggerTypeEnvironment,
  },
  event: {
    availability: 'ingest',
    sensitivity: 'persistable',
    host: 'server',
    shape: 'open',
    checkMode: 'syntax',
  },
  inputs: {
    availability: 'run-creation',
    sensitivity: 'persistable',
    host: 'server',
    shape: 'open',
    checkMode: 'syntax',
  },
  job: {
    availability: 'run-creation',
    sensitivity: 'persistable',
    host: 'server',
    shape: 'known',
    checkMode: 'typed',
    typeEnvironment: jobTypeEnvironment,
  },
  executions: {
    availability: 'execution-creation',
    sensitivity: 'persistable',
    host: 'server',
    shape: 'known',
    checkMode: 'typed',
    typeEnvironment: executionsTypeEnvironment,
  },
  execution: {
    availability: 'execution-creation',
    sensitivity: 'persistable',
    host: 'server',
    shape: 'known',
    checkMode: 'typed',
    typeEnvironment: executionTypeEnvironment,
  },
  jobs: {
    availability: 'job-activation',
    sensitivity: 'persistable',
    host: 'server',
    shape: 'open',
    checkMode: 'syntax',
  },
  needs: {
    availability: 'job-activation',
    sensitivity: 'persistable',
    host: 'server',
    shape: 'known',
    checkMode: 'typed',
    typeEnvironment: {needs: {kind: 'list', element: jobEntityType({key: '$need'})}},
  },
  steps: {
    availability: 'step-dispatch',
    sensitivity: 'persistable',
    host: 'server',
    shape: 'open',
    checkMode: 'syntax',
  },
  step: {
    availability: 'step-dispatch',
    sensitivity: 'persistable',
    host: 'server',
    shape: 'known',
    checkMode: 'typed',
    typeEnvironment: stepTypeEnvironment,
  },
  vars: {
    availability: 'run-creation',
    sensitivity: 'persistable',
    host: 'server',
    shape: 'open',
    checkMode: 'syntax',
    literalKeyOnly: true,
  },
  secrets: {
    sensitivity: 'ephemeral',
    host: 'runner',
    shape: 'open',
    checkMode: 'syntax',
    literalKeyOnly: true,
  },
} as const satisfies Record<WorkflowContextName, WorkflowContextDefinition>;

export type WorkflowInterpolationField =
  | 'run'
  | 'env.value'
  | 'agent.prompt'
  | 'agent.model'
  | 'agent.provider'
  | 'agent.thinking'
  | 'agent.session'
  | 'job.runner'
  | 'job.outputs'
  | 'workflow.run_name'
  | 'job.execution_name'
  | 'step.name'
  | 'step.working_directory'
  | 'step.feedback'
  | 'checkout.project'
  | 'checkout.connection'
  | 'checkout.repository'
  | 'checkout.ref'
  | 'checkout.path'
  | 'tool.with'
  | 'tool.outputs';

export const workflowFieldFailurePolicies = ['fail', 'degrade', 'fail-closed'] as const;
export type WorkflowFieldFailurePolicy = (typeof workflowFieldFailurePolicies)[number];
export type WorkflowInterpolationFailurePolicy = Exclude<WorkflowFieldFailurePolicy, 'fail-closed'>;

export interface WorkflowInterpolationFieldPolicy {
  readonly acceptedHosts: readonly WorkflowContextHost[];
  readonly failurePolicy: WorkflowInterpolationFailurePolicy;
  readonly minimumFillTarget?: AvailabilitySite;
  readonly selfReference?: {
    readonly root: WorkflowContextName;
    readonly key: string;
  };
  /**
   * Explicit root enumeration for fields whose references are not just
   * host-constrained, such as `tool.outputs` with its reserved `result` root.
   * When present, callers should use this instead of the accepted-hosts filter.
   */
  readonly roots?: readonly (WorkflowContextName | WorkflowContextReservedRoot)[];
}

const serverOnlyHosts: readonly WorkflowContextHost[] = ['server'];
const anyHost: readonly WorkflowContextHost[] = ['server', 'runner'];

export const workflowInterpolationFieldPolicies: Readonly<
  Record<WorkflowInterpolationField, WorkflowInterpolationFieldPolicy>
> = {
  run: {
    acceptedHosts: anyHost,
    failurePolicy: 'fail',
  },
  'env.value': {
    acceptedHosts: anyHost,
    failurePolicy: 'fail',
  },
  'agent.prompt': {
    acceptedHosts: serverOnlyHosts,
    failurePolicy: 'fail',
  },
  'agent.model': {
    acceptedHosts: serverOnlyHosts,
    failurePolicy: 'fail',
  },
  'agent.provider': {
    acceptedHosts: serverOnlyHosts,
    failurePolicy: 'fail',
  },
  'agent.thinking': {
    acceptedHosts: serverOnlyHosts,
    failurePolicy: 'fail',
  },
  'agent.session': {
    acceptedHosts: serverOnlyHosts,
    failurePolicy: 'fail',
  },
  'job.runner': {
    acceptedHosts: serverOnlyHosts,
    failurePolicy: 'fail',
  },
  'job.outputs': {
    acceptedHosts: serverOnlyHosts,
    failurePolicy: 'fail',
    minimumFillTarget: 'execution-resolution',
  },
  'workflow.run_name': {
    acceptedHosts: serverOnlyHosts,
    failurePolicy: 'degrade',
    minimumFillTarget: 'run-creation',
    selfReference: {root: 'run', key: 'name'},
  },
  'job.execution_name': {
    acceptedHosts: serverOnlyHosts,
    failurePolicy: 'degrade',
    minimumFillTarget: 'execution-creation',
    selfReference: {root: 'execution', key: 'name'},
  },
  'step.name': {
    acceptedHosts: serverOnlyHosts,
    failurePolicy: 'degrade',
  },
  'step.working_directory': {
    acceptedHosts: serverOnlyHosts,
    failurePolicy: 'fail',
  },
  'step.feedback': {
    acceptedHosts: serverOnlyHosts,
    failurePolicy: 'fail',
  },
  'checkout.project': {
    acceptedHosts: serverOnlyHosts,
    failurePolicy: 'fail',
  },
  'checkout.connection': {
    acceptedHosts: serverOnlyHosts,
    failurePolicy: 'fail',
  },
  'checkout.repository': {
    acceptedHosts: serverOnlyHosts,
    failurePolicy: 'fail',
  },
  'checkout.ref': {
    acceptedHosts: serverOnlyHosts,
    failurePolicy: 'fail',
  },
  'checkout.path': {
    acceptedHosts: serverOnlyHosts,
    failurePolicy: 'fail',
  },
  'tool.with': {
    acceptedHosts: serverOnlyHosts,
    failurePolicy: 'fail',
    minimumFillTarget: 'step-dispatch',
  },
  'tool.outputs': {
    acceptedHosts: serverOnlyHosts,
    failurePolicy: 'fail',
    minimumFillTarget: 'step-report',
    roots: ['result', 'vars'],
  },
};

export const workflowInterpolationFields = Object.keys(
  workflowInterpolationFieldPolicies,
) as readonly WorkflowInterpolationField[];

export const workflowPredicateFields = [
  'step.success',
  'job.success',
  'trigger.filter',
  'listener.on',
  'listener.until',
  'job.if',
  'step.if',
] as const;
export type WorkflowPredicateField = (typeof workflowPredicateFields)[number];

const listenerPredicateContextRoots = [
  'event',
  'workflow',
  'run',
  'trigger',
  'inputs',
  'vars',
  'job',
  'jobs',
] as const satisfies readonly WorkflowContextName[];

/**
 * The roots that the runtime passes to each server-evaluated predicate.
 *
 * This is intentionally narrower than lifecycle availability. A root can
 * exist by the time a predicate runs and still not belong to that predicate's
 * evaluation context.
 */
export const workflowPredicateContextRoots = {
  'step.success': ['step', 'vars'],
  'job.success': ['executions', 'jobs', 'vars'],
  'trigger.filter': ['event', 'trigger'],
  'listener.on': listenerPredicateContextRoots,
  'listener.until': listenerPredicateContextRoots,
  'job.if': ['workflow', 'run', 'trigger', 'event', 'inputs', 'vars', 'jobs', 'needs'],
  'step.if': ['vars', 'jobs', 'execution', 'step', 'steps'],
} as const satisfies Record<WorkflowPredicateField, readonly WorkflowContextName[]>;

export type WorkflowPredicateContextRoot<
  Field extends WorkflowPredicateField = WorkflowPredicateField,
> = (typeof workflowPredicateContextRoots)[Field][number];

export const workflowPredicateFieldFailurePolicy =
  'fail-closed' as const satisfies WorkflowFieldFailurePolicy;

const workflowPredicateFieldMinimumFillTargets = {
  'step.success': 'step-report',
  'job.success': 'job-resolution',
  'trigger.filter': 'ingest',
  'listener.on': 'job-activation',
  'listener.until': 'job-activation',
  'job.if': 'job-activation',
  'step.if': 'step-dispatch',
} as const satisfies Record<WorkflowPredicateField, AvailabilitySite>;

const workflowPredicateFieldTypeEnvironments: Partial<
  Record<WorkflowPredicateField, ExpressionTypeEnvironment>
> = {
  'trigger.filter': triggerFilterTypeEnvironment,
  'step.success': stepReportTypeEnvironment,
  'step.if': stepDispatchTypeEnvironment,
};

export function getWorkflowContextDefinition(name: WorkflowContextName): WorkflowContextDefinition {
  return workflowContextDefinitions[name];
}

export function getWorkflowContextAvailability(
  name: WorkflowContextName,
): AvailabilitySite | undefined {
  const definition = workflowContextDefinitions[name];
  return definition.host === 'server' ? definition.availability : undefined;
}

export function getWorkflowContextHost(name: WorkflowContextName): WorkflowContextHost {
  return workflowContextDefinitions[name].host;
}

export function resolveContextRootHost(root: string): WorkflowContextHost | undefined {
  if (isWorkflowContextName(root)) return workflowContextDefinitions[root].host;
  if (isWorkflowContextReservedRoot(root)) return workflowContextReservedRoots[root].host;
  return undefined;
}

export function resolveContextRootAvailability(root: string): AvailabilitySite | undefined {
  if (isWorkflowContextName(root)) {
    const definition = workflowContextDefinitions[root];
    return definition.host === 'server' ? definition.availability : undefined;
  }

  if (!isWorkflowContextReservedRoot(root)) return undefined;
  const reservedRoot = workflowContextReservedRoots[root];
  return reservedRoot.host === 'server' ? reservedRoot.availability : undefined;
}

export function getWorkflowContextSensitivity(
  name: WorkflowContextName,
): WorkflowContextSensitivity {
  return workflowContextDefinitions[name].sensitivity;
}

export function rootsAvailableAt(site: AvailabilitySite): readonly WorkflowContextName[] {
  const targetSiteIndex = availabilitySites.indexOf(site);
  return workflowContextNames.filter((name) => {
    const definition = workflowContextDefinitions[name];
    return (
      definition.host === 'server' &&
      availabilitySites.indexOf(definition.availability) <= targetSiteIndex
    );
  });
}

export function unavailableRootsAt(
  roots: readonly (WorkflowContextName | WorkflowContextReservedRoot)[],
  site: AvailabilitySite,
): readonly (WorkflowContextName | WorkflowContextReservedRoot)[] {
  const targetSiteIndex = availabilitySites.indexOf(site);
  return roots.filter((root) => {
    const availability = resolveContextRootAvailability(root);
    return availability === undefined || availabilitySites.indexOf(availability) > targetSiteIndex;
  });
}

export function getWorkflowContextTypeEnvironment(
  name: WorkflowContextName,
): ExpressionTypeEnvironment | undefined {
  const context = getWorkflowContextDefinition(name);
  return context.shape === 'known' ? context.typeEnvironment : undefined;
}

export function getWorkflowInterpolationFieldTypeEnvironment(
  field: WorkflowInterpolationField,
  root: WorkflowContextName | WorkflowContextReservedRoot,
): ExpressionTypeEnvironment | undefined {
  if (field === 'tool.with' && root === 'step') return stepDispatchTypeEnvironment;
  if (!isWorkflowContextName(root)) return undefined;
  return getWorkflowContextTypeEnvironment(root);
}

export function workflowInterpolationFieldAcceptsHost(
  field: WorkflowInterpolationField,
  host: WorkflowContextHost,
): boolean {
  return workflowInterpolationFieldPolicies[field].acceptedHosts.includes(host);
}

export function workflowContextRootRequiresLiteralKey(root: string): boolean {
  if (!isWorkflowContextName(root)) return false;
  const definition = workflowContextDefinitions[root];
  return 'literalKeyOnly' in definition && definition.literalKeyOnly === true;
}

export function getWorkflowInterpolationFieldFailurePolicy(
  field: WorkflowInterpolationField,
): WorkflowInterpolationFailurePolicy {
  return workflowInterpolationFieldPolicies[field].failurePolicy;
}

export function getWorkflowInterpolationFieldSelfReference(
  field: WorkflowInterpolationField,
): WorkflowInterpolationFieldPolicy['selfReference'] {
  return workflowInterpolationFieldPolicies[field].selfReference;
}

export function getWorkflowInterpolationFieldMinimumFillTarget(
  field: WorkflowInterpolationField,
): AvailabilitySite | undefined {
  const policy = workflowInterpolationFieldPolicies[field];
  return 'minimumFillTarget' in policy ? policy.minimumFillTarget : undefined;
}

export function getWorkflowPredicateFieldMinimumFillTarget(
  field: WorkflowPredicateField,
): AvailabilitySite {
  return workflowPredicateFieldMinimumFillTargets[field];
}

export function getWorkflowPredicateFieldTypeEnvironment(
  field: WorkflowPredicateField,
  root: WorkflowContextName,
  stepKind?: WorkflowStepKind,
): ExpressionTypeEnvironment | undefined {
  const fieldTypeEnvironment =
    field === 'step.success' && stepKind === 'tool'
      ? toolStepReportTypeEnvironment
      : workflowPredicateFieldTypeEnvironments[field];
  const typeEnvironment: ExpressionTypeEnvironment | undefined = fieldTypeEnvironment;
  if (typeEnvironment === undefined) return getWorkflowContextTypeEnvironment(root);
  const rootType = typeEnvironment[root];
  return rootType === undefined ? getWorkflowContextTypeEnvironment(root) : {[root]: rootType};
}

export function getWorkflowPredicateContextRoots<Field extends WorkflowPredicateField>(
  field: Field,
): readonly WorkflowPredicateContextRoot<Field>[] {
  return workflowPredicateContextRoots[field];
}

/**
 * The roots a field can read, whichever kind of field it is.
 *
 * A predicate has an enumerated contract because the runtime assembles one
 * context for it. A template has no single context: each reference is filled
 * where its data arrives, so its field-level constraint is which host can
 * resolve it, except for fields that declare an explicit root list (such as
 * `tool.outputs`, whose reserved `result` root is not a referenceable context
 * name). Callers that document or check fields should use this instead of
 * choosing a mechanism themselves.
 */
export function contextRootsForField(
  field: WorkflowPredicateField | WorkflowInterpolationField,
): readonly (WorkflowContextName | WorkflowContextReservedRoot)[] {
  if (isWorkflowPredicateField(field)) return workflowPredicateContextRoots[field];

  const policy = workflowInterpolationFieldPolicies[field];
  if (policy.roots !== undefined) return policy.roots;

  const {acceptedHosts} = policy;
  return workflowContextNames.filter((name) =>
    acceptedHosts.includes(workflowContextDefinitions[name].host),
  );
}

export function isWorkflowPredicateField(field: string): field is WorkflowPredicateField {
  return (workflowPredicateFields as readonly string[]).includes(field);
}

export function projectWorkflowPredicateContext(
  field: WorkflowPredicateField,
  context: WorkflowExpressionEvaluationContext,
): WorkflowExpressionEvaluationContext {
  const roots = new Set(getWorkflowPredicateContextRoots(field));
  return Object.fromEntries(
    Object.entries(context).filter(([root]) => roots.has(root as WorkflowPredicateContextRoot)),
  );
}

export interface WorkflowContextAvailabilityReferenceEntry {
  readonly root: WorkflowContextName | WorkflowContextReservedRoot;
  readonly availability?: AvailabilitySite;
  readonly reserved: boolean;
  readonly availableAt: Readonly<Record<AvailabilitySite, boolean>>;
}

export function workflowContextAvailabilityReference(): readonly WorkflowContextAvailabilityReferenceEntry[] {
  return [
    ...workflowContextNames.map((root) => {
      const definition = workflowContextDefinitions[root];
      if (definition.host === 'runner') return noServerAvailabilityReferenceEntry(root, false);
      return availabilityReferenceEntry(root, definition.availability, false);
    }),
    ...Object.entries(workflowContextReservedRoots).map(([root, definition]) => {
      if (definition.host === 'runner') {
        return noServerAvailabilityReferenceEntry(root as WorkflowContextReservedRoot, true);
      }
      return availabilityReferenceEntry(
        root as WorkflowContextReservedRoot,
        definition.availability,
        true,
      );
    }),
  ];
}

function availabilityReferenceEntry(
  root: WorkflowContextName | WorkflowContextReservedRoot,
  availability: AvailabilitySite,
  reserved: boolean,
): WorkflowContextAvailabilityReferenceEntry {
  const availabilityIndex = availabilitySites.indexOf(availability);
  const availableAt = Object.fromEntries(
    availabilitySites.map((site) => [site, availabilitySites.indexOf(site) >= availabilityIndex]),
  ) as Record<AvailabilitySite, boolean>;

  return {root, availability, reserved, availableAt};
}

function noServerAvailabilityReferenceEntry(
  root: WorkflowContextName | WorkflowContextReservedRoot,
  reserved: boolean,
): WorkflowContextAvailabilityReferenceEntry {
  const availableAt = Object.fromEntries(availabilitySites.map((site) => [site, false])) as Record<
    AvailabilitySite,
    boolean
  >;

  return {root, reserved, availableAt};
}

function stepsRootType(steps: readonly WorkflowStepTypeOverlay[]): ExpressionType {
  return {
    kind: 'object',
    fields: Object.fromEntries(steps.map((step) => [step.key, stepEntityTypeForStep(step)])),
  };
}

function stepEntityTypeForStep(step: WorkflowStepTypeOverlay): ExpressionType {
  const attemptType = stepAttemptTypeForOutputs(outputsTypeForStep(step), step.kind === 'tool');
  return {
    kind: 'object',
    fields: {
      ...attemptType.fields,
      attempts: {
        kind: 'list',
        element: attemptType,
      },
    },
  };
}

function selfStepType(step: WorkflowStepTypeOverlay): ExpressionType {
  const selfType = step.kind === 'tool' ? toolStepSelfTypeEnvironment : stepTypeEnvironment;
  return {
    kind: 'object',
    fields: {
      ...selfType.step.fields,
      outputs: outputsTypeForStep(step),
    },
  };
}

function stepAttemptTypeForOutputs(
  outputs: ExpressionType,
  toolStep: boolean,
): ObjectExpressionType {
  return {
    kind: 'object',
    fields: {
      ...(toolStep ? toolStepAttemptType : stepAttemptType).fields,
      outputs,
    },
  };
}

function outputsTypeForStep(step: WorkflowStepTypeOverlay): ExpressionType {
  if (step.kind === 'tool') {
    // Every tool step exposes `outputs.result`, typed from the catalog output
    // schema when one is declared and open otherwise; `result` always wins
    // over a mapped output that tries to redeclare it.
    return {
      kind: 'object',
      fields: {
        ...(step.outputs === undefined ? {} : outputDeclarationsToExpressionFields(step.outputs)),
        result:
          step.outputSchema === undefined
            ? ({kind: 'map'} as const satisfies ExpressionType)
            : jsonSchemaToExpressionType(step.outputSchema),
      },
    };
  }

  if (step.outputs === undefined) return {kind: 'map'};
  return {kind: 'object', fields: outputDeclarationsToExpressionFields(step.outputs)};
}

function jobsRootType(jobs: readonly WorkflowJobTypeOverlay[]): ExpressionType {
  return {
    kind: 'object',
    fields: Object.fromEntries(jobs.map((job) => [job.key, jobEntityType(job)])),
  };
}

function needsRootType(): ExpressionType {
  return {
    kind: 'list',
    element: jobEntityTypeForNeeds(),
  };
}

function jobEntityTypeForNeeds(): ExpressionType {
  return {
    kind: 'object',
    fields: {
      key: 'string',
      status: 'string',
      outputs: {kind: 'map'},
      executions: {
        kind: 'list',
        element: executionTypeWithOutputs({kind: 'map'}),
      },
    },
  };
}

function jobEntityType(job: WorkflowJobTypeOverlay): ExpressionType {
  const outputs = jobOutputsType(job);
  const execution = executionTypeWithOutputs(outputs);
  return {
    kind: 'object',
    fields: {
      key: 'string',
      status: 'string',
      outputs,
      executions: {
        kind: 'list',
        element: execution,
      },
    },
  };
}

function jobOutputsType(job: WorkflowJobTypeOverlay): ExpressionType {
  return job.outputs === undefined
    ? ({kind: 'map'} as const satisfies ExpressionType)
    : ({kind: 'object', fields: job.outputs} as const satisfies ExpressionType);
}

function executionTypeWithOutputs(outputs: ExpressionType): ExpressionType {
  return {
    kind: 'object',
    fields: {
      ...executionType.fields,
      outputs,
    },
  };
}

function isWorkflowContextName(root: string): root is WorkflowContextName {
  return Object.hasOwn(workflowContextDefinitions, root);
}

function isWorkflowContextReservedRoot(root: string): root is WorkflowContextReservedRoot {
  return Object.hasOwn(workflowContextReservedRoots, root);
}
