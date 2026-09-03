import type {AgentValidationCatalogV2} from '@shipfox/api-agent-dto/inter-module';
import {
  type AvailabilitySite,
  buildTypedRootsEnvironment,
  classifyShellCodePosition,
  type ExpressionType,
  type ExpressionTypeEnvironment,
  hoistPlannedRunCommand,
  parseWorkflowTemplate,
  type ShellReevaluatingConstruct,
  type UnsafeRunInterpolation,
  UnsafeRunInterpolationError,
  type WorkflowJobTypeOverlay,
  type WorkflowStepTypeOverlay,
  type WorkflowTemplateSegment,
} from '@shipfox/expression';
import {
  canonicalizeLabels,
  findInvalidLabels,
  MAX_RUNNER_LABEL_LENGTH,
  MAX_RUNNER_LABELS,
  RUNNER_LABEL_PATTERN,
} from '@shipfox/runner-labels';
import {
  isValidWorkflowSessionKeyTemplateLiteralParts,
  WORKFLOW_SESSION_KEY_PATTERN,
  type WorkflowDocument,
  type WorkflowDocumentJob,
  type WorkflowDocumentStep,
} from '@shipfox/workflow-document';
import type {IntegrationValidationContext} from '../entities/integration-context.js';
import type {
  WorkflowEnvTemplates,
  WorkflowFieldTemplate,
  WorkflowModelAgentStep,
  WorkflowModelAgentStepSession,
  WorkflowModelCheckoutStep,
  WorkflowModelJob,
  WorkflowModelRunStep,
  WorkflowModelStep,
  WorkflowModelStepCheckout,
  WorkflowOutputTemplates,
  WorkflowStepSourceLocationMap,
} from '../entities/workflow-model.js';
import type {
  WorkflowModelValidationIssue,
  WorkflowModelValidationIssuePathSegment,
} from './invalid-workflow-model-error.js';
import {normalizeAgentIntegrations} from './normalize-agent-integrations.js';
import {normalizeEnv} from './normalize-env.js';
import {normalizeIfCondition} from './normalize-if-condition.js';
import {normalizeCheckout, normalizeJobCheckout} from './normalize-job-checkout.js';
import {normalizeJobListening} from './normalize-job-listening.js';
import {normalizeJobSuccess} from './normalize-job-success.js';
import {normalizeNeeds} from './normalize-needs.js';
import {normalizeStepGate} from './normalize-step-gate.js';
import {normalizeStepOutputs} from './normalize-step-outputs.js';
import {normalizeToolStep} from './normalize-tool-step.js';
import {parseDurationMs} from './parse-duration-ms.js';
import {parseInterpolationField} from './parse-interpolation-field.js';
import {stableId} from './stable-id.js';
import {unescapeLiteralName, validateLiteralName} from './validate-literal-name.js';
import {issue} from './validation-issue.js';

export interface NormalizeContext {
  readonly defaultRunnerLabels: readonly string[];
  readonly agentValidationCatalog: AgentValidationCatalogV2;
  readonly integrationValidationContext?: IntegrationValidationContext | undefined;
}

interface NormalizeJobsState {
  pending: Set<string>;
  modelsBySourceName: Map<string, WorkflowModelJob>;
  jobOutputTypesBySourceName: Map<string, Readonly<Record<string, ExpressionType>>>;
  issuesBySourceName: Map<string, WorkflowModelValidationIssue[]>;
}

interface NormalizeJobsSharedParams {
  document: WorkflowDocument;
  jobIdBySourceName: ReadonlyMap<string, string>;
  stepSourceLocations: WorkflowStepSourceLocationMap | undefined;
  context: NormalizeContext;
}

function normalizeAndStoreJob(
  sourceName: string,
  job: WorkflowDocumentJob,
  shared: NormalizeJobsSharedParams,
  state: NormalizeJobsState,
): void {
  const model = normalizeJob({
    ...shared,
    sourceName,
    job,
    issues: issuesForSourceName(state.issuesBySourceName, sourceName),
    jobOutputTypesBySourceName: state.jobOutputTypesBySourceName,
  });
  if (model !== undefined) state.modelsBySourceName.set(sourceName, model);
}

function normalizeReadyJobs(
  entries: ReadonlyArray<readonly [string, WorkflowDocumentJob]>,
  shared: NormalizeJobsSharedParams,
  state: NormalizeJobsState,
): boolean {
  let progressed = false;
  for (const [sourceName, job] of entries) {
    if (!state.pending.has(sourceName)) continue;
    const dependencies = normalizeNeeds(job.needs).filter((dependency) =>
      shared.jobIdBySourceName.has(dependency),
    );
    if (dependencies.some((dependency) => state.pending.has(dependency))) continue;
    normalizeAndStoreJob(sourceName, job, shared, state);
    state.pending.delete(sourceName);
    progressed = true;
  }
  return progressed;
}

function normalizeRemainingJobs(
  shared: NormalizeJobsSharedParams,
  state: NormalizeJobsState,
): void {
  for (const sourceName of state.pending) {
    const job = shared.document.jobs[sourceName];
    if (job !== undefined) normalizeAndStoreJob(sourceName, job, shared, state);
  }
}

export function normalizeJobs(
  document: WorkflowDocument,
  jobIdBySourceName: ReadonlyMap<string, string>,
  issues: WorkflowModelValidationIssue[],
  stepSourceLocations: WorkflowStepSourceLocationMap | undefined,
  context: NormalizeContext,
): readonly WorkflowModelJob[] {
  const entries = Object.entries(document.jobs);
  const state: NormalizeJobsState = {
    pending: new Set(entries.map(([sourceName]) => sourceName)),
    modelsBySourceName: new Map(),
    jobOutputTypesBySourceName: new Map(),
    issuesBySourceName: new Map(),
  };
  const shared = {document, jobIdBySourceName, stepSourceLocations, context};

  while (state.pending.size > 0) {
    if (normalizeReadyJobs(entries, shared, state)) continue;
    normalizeRemainingJobs(shared, state);
    break;
  }

  for (const [sourceName] of entries) {
    issues.push(...(state.issuesBySourceName.get(sourceName) ?? []));
  }

  validateAgentSessionSharing(document, issues, context.agentValidationCatalog.default_harness_id);

  return entries.flatMap(([sourceName]) => {
    const model = state.modelsBySourceName.get(sourceName);
    return model === undefined ? [] : [model];
  });
}

function issuesForSourceName(
  issuesBySourceName: Map<string, WorkflowModelValidationIssue[]>,
  sourceName: string,
): WorkflowModelValidationIssue[] {
  const existing = issuesBySourceName.get(sourceName);
  if (existing !== undefined) return existing;

  const issues: WorkflowModelValidationIssue[] = [];
  issuesBySourceName.set(sourceName, issues);
  return issues;
}

function normalizeJob(params: {
  document: WorkflowDocument;
  sourceName: string;
  job: WorkflowDocumentJob;
  jobIdBySourceName: ReadonlyMap<string, string>;
  issues: WorkflowModelValidationIssue[];
  stepSourceLocations: WorkflowStepSourceLocationMap | undefined;
  context: NormalizeContext;
  jobOutputTypesBySourceName: Map<string, Readonly<Record<string, ExpressionType>>>;
}): WorkflowModelJob | undefined {
  const id = params.jobIdBySourceName.get(params.sourceName);
  if (id === undefined) return undefined;

  const dependencies = normalizeJobDependencies({
    sourceName: params.sourceName,
    job: params.job,
    jobIdBySourceName: params.jobIdBySourceName,
  });
  const allowedJobReferences = directNeedSourceNames({
    sourceName: params.sourceName,
    job: params.job,
    jobIdBySourceName: params.jobIdBySourceName,
  });
  const upstreamJobs = upstreamJobTypeOverlays({
    allowedJobReferences,
    jobOutputTypesBySourceName: params.jobOutputTypesBySourceName,
  });
  const directNeedJobs = directNeedJobTypeOverlays({
    allowedJobReferences,
    jobOutputTypesBySourceName: params.jobOutputTypesBySourceName,
  });
  const upstreamJobsTypeOverlay =
    upstreamJobs.length === 0 ? undefined : buildTypedRootsEnvironment({jobs: upstreamJobs});
  const jobConditionTypeOverlay = buildTypedRootsEnvironment({
    jobs: directNeedJobs,
    needs: directNeedJobs,
  });
  // Step config can reference peer step outputs, which are completed at dispatch.
  const stepFillSite: AvailabilitySite = 'step-dispatch';
  const stepTypeOverlay = params.job.steps.some((step) => step.outputs !== undefined)
    ? {}
    : undefined;
  // Tool steps record a `steps.<key>` type overlay while they normalize, so
  // later steps and the job outputs see `outputs.result` typed from the
  // catalog output schema.
  const toolOverlayByKey = new Map<string, WorkflowStepTypeOverlay>();
  const steps = normalizeJobSteps({
    sourceName: params.sourceName,
    jobId: id,
    job: params.job,
    workflowEnvKeys: Object.keys(params.document.env ?? {}),
    jobEnvKeys: Object.keys(params.job.env ?? {}),
    issues: params.issues,
    stepSourceLocations: params.stepSourceLocations,
    fillSite: stepFillSite,
    allowedJobReferences,
    typeOverlay: stepTypeOverlay,
    upstreamJobs,
    directNeedJobs,
    toolOverlayByKey,
    context: params.context,
  });
  const runner = normalizeRunner({
    document: params.document,
    job: params.job,
    sourceName: params.sourceName,
    issues: params.issues,
    defaultRunnerLabels: params.context.defaultRunnerLabels,
  });
  const checkout = normalizeJobCheckout({
    checkout: params.job.checkout,
  });
  const jobEnv = normalizeEnv({
    env: params.job.env,
    path: ['jobs', params.sourceName, 'env'],
    issues: params.issues,
    allowedJobReferences,
    typeOverlay: upstreamJobsTypeOverlay,
  });
  const success = normalizeJobSuccess({
    source: params.job.success,
    sourceName: params.sourceName,
    issues: params.issues,
    allowedJobReferences,
    typeOverlay: upstreamJobsTypeOverlay,
  });
  const condition = normalizeIfCondition({
    field: 'job.if',
    source: params.job.if,
    path: ['jobs', params.sourceName, 'if'],
    invalidCode: 'invalid-job-if',
    invalidMessage: 'Job if must be a valid wrapped CEL boolean expression.',
    issues: params.issues,
    allowedJobReferences,
    typeOverlay: jobConditionTypeOverlay,
  });
  const outputs = normalizeJobOutputs({
    sourceName: params.sourceName,
    outputs: params.job.outputs,
    issues: params.issues,
    allowedJobReferences,
    steps: params.job.steps,
    toolOverlayByKey,
    upstreamJobs,
  });
  if (outputs?.types !== undefined) {
    params.jobOutputTypesBySourceName.set(params.sourceName, outputs.types);
  }
  const executionTimeoutMs = parseDurationMs({
    source: params.job.execution_timeout,
    path: ['jobs', params.sourceName, 'execution_timeout'],
    issues: params.issues,
  });
  const listening = normalizeJobListening({
    job: params.job,
    sourceName: params.sourceName,
    issues: params.issues,
    allowedJobReferences,
    integrationValidationContext: params.context.integrationValidationContext,
  });
  const {name, executionName} = normalizeJobNames(
    params,
    allowedJobReferences,
    upstreamJobsTypeOverlay,
  );

  return buildNormalizedJob({
    id,
    checkout,
    condition,
    dependencies,
    executionName,
    executionTimeoutMs,
    jobEnv,
    key: params.sourceName,
    listening,
    name,
    outputs,
    runner,
    success,
    steps,
  });
}

function normalizeJobNames(
  params: Parameters<typeof normalizeJob>[0],
  allowedJobReferences: ReadonlySet<string>,
  typeOverlay: ExpressionTypeEnvironment | undefined,
): {name: string | undefined; executionName: WorkflowFieldTemplate | undefined} {
  if (params.job.name !== undefined) {
    validateLiteralName({
      field: 'job.name',
      dynamicField: 'execution_name',
      source: params.job.name,
      path: ['jobs', params.sourceName, 'name'],
      message: 'Job name must be literal. Move runtime interpolation to execution_name.',
      issues: params.issues,
    });
  }
  const name = params.job.name === undefined ? undefined : unescapeLiteralName(params.job.name);
  if (params.job.execution_name === undefined) return {name, executionName: undefined};
  const executionName = parseInterpolationField({
    field: 'job.execution_name',
    source: params.job.execution_name,
    path: ['jobs', params.sourceName, 'execution_name'],
    issues: params.issues,
    fillSite: 'execution-creation',
    allowedJobReferences,
    typeOverlay,
  }) ?? [{kind: 'literal' as const, value: params.job.execution_name}];
  return {name, executionName};
}

function buildNormalizedJob(params: {
  id: string;
  key: string;
  runner: ReturnType<typeof normalizeRunner>;
  checkout: ReturnType<typeof normalizeJobCheckout>;
  condition: ReturnType<typeof normalizeIfCondition>;
  success: ReturnType<typeof normalizeJobSuccess>;
  outputs: ReturnType<typeof normalizeJobOutputs>;
  executionTimeoutMs: number | undefined;
  listening: ReturnType<typeof normalizeJobListening>;
  name: string | undefined;
  executionName: WorkflowFieldTemplate | undefined;
  jobEnv: ReturnType<typeof normalizeEnv>;
  dependencies: readonly string[];
  steps: readonly WorkflowModelStep[];
}): WorkflowModelJob {
  return {
    id: params.id,
    key: params.key,
    mode: params.listening === undefined ? 'one_shot' : 'listening',
    runner: params.runner.labels,
    ...(params.runner.templates.length === 0 ? {} : {runnerTemplates: params.runner.templates}),
    checkout: params.checkout,
    ...(params.condition === undefined ? {} : {if: params.condition}),
    ...(params.success === undefined ? {} : {success: params.success}),
    ...(params.outputs === undefined ? {} : {outputs: params.outputs.templates}),
    ...(params.outputs?.types === undefined ? {} : {outputTypes: params.outputs.types}),
    ...(params.executionTimeoutMs === undefined
      ? {}
      : {executionTimeoutMs: params.executionTimeoutMs}),
    ...(params.listening === undefined ? {} : {listening: params.listening}),
    ...(params.name === undefined ? {} : {name: params.name}),
    ...(params.executionName === undefined ? {} : {executionName: params.executionName}),
    ...params.jobEnv,
    dependencies: params.dependencies,
    steps: params.steps,
  };
}

function normalizeJobDependencies(params: {
  sourceName: string;
  job: WorkflowDocumentJob;
  jobIdBySourceName: ReadonlyMap<string, string>;
}): readonly string[] {
  return normalizeNeeds(params.job.needs).flatMap((dependencySourceName) => {
    const dependencyId = params.jobIdBySourceName.get(dependencySourceName);
    if (dependencyId === undefined || dependencySourceName === params.sourceName) return [];
    return [dependencyId];
  });
}

function directNeedSourceNames(params: {
  sourceName: string;
  job: WorkflowDocumentJob;
  jobIdBySourceName: ReadonlyMap<string, string>;
}): ReadonlySet<string> {
  return new Set(
    normalizeNeeds(params.job.needs).filter(
      (dependencySourceName) =>
        dependencySourceName !== params.sourceName &&
        params.jobIdBySourceName.has(dependencySourceName),
    ),
  );
}

function previousStepOverlays(
  steps: readonly WorkflowDocumentStep[],
  index: number,
  toolOverlayByKey: ReadonlyMap<string, WorkflowStepTypeOverlay>,
): readonly WorkflowStepTypeOverlay[] {
  return steps.slice(0, index).flatMap((step) => {
    if (step.key === undefined) return [];
    const toolOverlay = toolOverlayByKey.get(step.key);
    if (toolOverlay !== undefined) return [toolOverlay];
    const outputs = step.tool === undefined ? step.outputs : undefined;
    return [{key: step.key, ...(outputs === undefined ? {} : {outputs})}];
  });
}

function allStepOverlays(
  steps: readonly WorkflowDocumentStep[],
  toolOverlayByKey: ReadonlyMap<string, WorkflowStepTypeOverlay>,
): readonly WorkflowStepTypeOverlay[] {
  return previousStepOverlays(steps, steps.length, toolOverlayByKey);
}

function upstreamJobTypeOverlays(params: {
  allowedJobReferences: ReadonlySet<string>;
  jobOutputTypesBySourceName: ReadonlyMap<string, Readonly<Record<string, ExpressionType>>>;
}): readonly WorkflowJobTypeOverlay[] {
  const overlays = [...params.allowedJobReferences].map((sourceName) => {
    const outputs = params.jobOutputTypesBySourceName.get(sourceName);
    return {key: sourceName, ...(outputs === undefined ? {} : {outputs})};
  });
  return overlays.some((overlay) => overlay.outputs !== undefined) ? overlays : [];
}

function directNeedJobTypeOverlays(params: {
  allowedJobReferences: ReadonlySet<string>;
  jobOutputTypesBySourceName: ReadonlyMap<string, Readonly<Record<string, ExpressionType>>>;
}): readonly WorkflowJobTypeOverlay[] {
  return [...params.allowedJobReferences].map((sourceName) => {
    const outputs = params.jobOutputTypesBySourceName.get(sourceName);
    return {key: sourceName, ...(outputs === undefined ? {} : {outputs})};
  });
}

function normalizeJobOutputs(params: {
  sourceName: string;
  outputs: WorkflowDocumentJob['outputs'];
  issues: WorkflowModelValidationIssue[];
  allowedJobReferences: ReadonlySet<string>;
  steps: readonly WorkflowDocumentStep[];
  toolOverlayByKey: ReadonlyMap<string, WorkflowStepTypeOverlay>;
  upstreamJobs: readonly WorkflowJobTypeOverlay[];
}):
  | {templates: WorkflowOutputTemplates; types: Readonly<Record<string, ExpressionType>>}
  | undefined {
  if (params.outputs === undefined) return undefined;

  const templates: Record<string, WorkflowFieldTemplate> = Object.create(null) as Record<
    string,
    WorkflowFieldTemplate
  >;
  const types: Record<string, ExpressionType> = Object.create(null) as Record<
    string,
    ExpressionType
  >;
  const hasStepOutputDeclarations = params.steps.some((step) => step.outputs !== undefined);
  const hasToolOverlays = params.toolOverlayByKey.size > 0;
  const typeOverlay =
    hasStepOutputDeclarations || hasToolOverlays || params.upstreamJobs.length > 0
      ? buildTypedRootsEnvironment({
          ...(hasStepOutputDeclarations || hasToolOverlays
            ? {steps: allStepOverlays(params.steps, params.toolOverlayByKey)}
            : {}),
          ...(params.upstreamJobs.length === 0 ? {} : {jobs: params.upstreamJobs}),
        })
      : undefined;

  for (const [key, source] of Object.entries(params.outputs)) {
    const template = parseInterpolationField({
      field: 'job.outputs',
      source,
      path: ['jobs', params.sourceName, 'outputs', key],
      issues: params.issues,
      fillSite: 'execution-resolution',
      allowedJobReferences: params.allowedJobReferences,
      typeOverlay,
    }) ?? [{kind: 'literal' as const, value: source}];
    templates[key] = template;
    types[key] = inferJobOutputType(template);
  }

  return {templates, types};
}

function inferJobOutputType(template: WorkflowFieldTemplate): ExpressionType {
  if (template.length !== 1) return 'string';

  const [segment] = template;
  if (segment?.kind !== 'deferred') return 'string';

  const resultType = segment.expression.resultType;
  if (resultType === undefined) return 'string';
  return resultType;
}

function normalizeJobSteps(params: {
  sourceName: string;
  jobId: string;
  job: WorkflowDocumentJob;
  workflowEnvKeys: readonly string[];
  jobEnvKeys: readonly string[];
  issues: WorkflowModelValidationIssue[];
  stepSourceLocations: WorkflowStepSourceLocationMap | undefined;
  fillSite: AvailabilitySite;
  allowedJobReferences: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
  upstreamJobs: readonly WorkflowJobTypeOverlay[];
  directNeedJobs: readonly WorkflowJobTypeOverlay[];
  toolOverlayByKey: Map<string, WorkflowStepTypeOverlay>;
  context: NormalizeContext;
}): readonly WorkflowModelStep[] {
  const usedStepIds = new Map<string, number>();

  return params.job.steps.flatMap((step, index) => {
    const normalized = normalizeStep({
      step,
      index,
      sourceName: params.sourceName,
      jobId: params.jobId,
      allSteps: params.job.steps,
      workflowEnvKeys: params.workflowEnvKeys,
      jobEnvKeys: params.jobEnvKeys,
      usedStepIds,
      issues: params.issues,
      stepSourceLocations: params.stepSourceLocations,
      fillSite: params.fillSite,
      allowedJobReferences: params.allowedJobReferences,
      typeOverlay: params.typeOverlay,
      upstreamJobs: params.upstreamJobs,
      directNeedJobs: params.directNeedJobs,
      toolOverlayByKey: params.toolOverlayByKey,
      context: params.context,
    });
    return normalized === undefined ? [] : [normalized];
  });
}

type NormalizeStepParams = Parameters<typeof normalizeStep>[0];

function registerStepId(params: NormalizeStepParams, stepId: string): void {
  const existingIndex = params.usedStepIds.get(stepId);
  if (existingIndex === undefined) {
    params.usedStepIds.set(stepId, params.index);
    return;
  }
  params.issues.push(
    issue({
      code: 'duplicate-step-id',
      message: `Steps ${existingIndex} and ${params.index} in job "${params.sourceName}" resolve to the same stable id "${stepId}".`,
      path: ['jobs', params.sourceName, 'steps', params.index],
      details: {id: stepId, indexes: [existingIndex, params.index]},
    }),
  );
}

function previousStepTypeContext(params: NormalizeStepParams): {
  shouldBuild: boolean;
  overlays: readonly WorkflowStepTypeOverlay[];
  environment: ExpressionTypeEnvironment | undefined;
} {
  const shouldBuild =
    params.typeOverlay !== undefined ||
    params.upstreamJobs.length > 0 ||
    params.toolOverlayByKey.size > 0;
  const overlays = previousStepOverlays(params.allSteps, params.index, params.toolOverlayByKey);
  const environment = shouldBuild
    ? buildTypedRootsEnvironment({
        steps: overlays,
        ...(params.upstreamJobs.length === 0 ? {} : {jobs: params.upstreamJobs}),
      })
    : undefined;
  return {shouldBuild, overlays, environment};
}

function currentStepTypeContext(
  params: NormalizeStepParams,
  previous: ReturnType<typeof previousStepTypeContext>,
  currentStep: WorkflowStepTypeOverlay | undefined,
): {
  typeOverlay: ExpressionTypeEnvironment | undefined;
  conditionTypeOverlay: ExpressionTypeEnvironment;
} {
  const currentStepRoot = currentStep === undefined ? {} : {currentStep};
  const typeOverlay = previous.shouldBuild
    ? buildTypedRootsEnvironment({
        steps: previous.overlays,
        ...currentStepRoot,
        ...(params.upstreamJobs.length === 0 ? {} : {jobs: params.upstreamJobs}),
      })
    : undefined;
  const conditionTypeOverlay = buildTypedRootsEnvironment({
    steps: previous.overlays,
    ...currentStepRoot,
    jobs: params.directNeedJobs,
    needs: params.directNeedJobs,
  });
  return {typeOverlay, conditionTypeOverlay};
}

function normalizeStepWorkingDirectory(
  params: NormalizeStepParams,
  typeOverlay: ExpressionTypeEnvironment | undefined,
): WorkflowFieldTemplate | undefined {
  if (params.step.working_directory === undefined) return undefined;
  return parseInterpolationField({
    field: 'step.working_directory',
    source: params.step.working_directory,
    path: ['jobs', params.sourceName, 'steps', params.index, 'working_directory'],
    issues: params.issues,
    fillSite: params.fillSite,
    allowedJobReferences: params.allowedJobReferences,
    typeOverlay,
  });
}

function normalizeConcreteStep(params: {
  normalization: NormalizeStepParams;
  stepId: string;
  stepKey: string | undefined;
  stepBase: WorkflowModelStepBaseFields;
  outputs: ReturnType<typeof normalizeStepOutputs>;
  condition: ReturnType<typeof normalizeIfCondition>;
  gate: ReturnType<typeof normalizeStepGate>;
  toolStepResult: ReturnType<typeof normalizeToolStep> | undefined;
  name: WorkflowFieldTemplate | undefined;
  workingDirectory: WorkflowFieldTemplate | undefined;
  typeOverlay: ExpressionTypeEnvironment | undefined;
}): WorkflowModelStep {
  const source = params.normalization;
  if (params.toolStepResult !== undefined) {
    if (params.stepKey !== undefined) {
      source.toolOverlayByKey.set(params.stepKey, params.toolStepResult.overlay);
    }
    return {
      ...params.toolStepResult.step,
      ...(params.condition === undefined ? {} : {if: params.condition}),
      ...(params.gate === undefined ? {} : {gate: params.gate}),
    };
  }
  const stepBaseWithOutputs = {
    ...params.stepBase,
    ...(params.outputs === undefined ? {} : {outputs: params.outputs}),
    ...(params.condition === undefined ? {} : {if: params.condition}),
    ...(params.gate === undefined ? {} : {gate: params.gate}),
  };
  const shared = {
    step: source.step,
    stepBase: stepBaseWithOutputs,
    sourceName: source.sourceName,
    stepIndex: source.index,
    name: params.name,
    workingDirectory: params.workingDirectory,
    issues: source.issues,
    fillSite: source.fillSite,
    allowedJobReferences: source.allowedJobReferences,
    typeOverlay: params.typeOverlay,
  };
  if (source.step.run !== undefined) {
    return normalizeRunStep({
      ...shared,
      workflowEnvKeys: source.workflowEnvKeys,
      jobEnvKeys: source.jobEnvKeys,
    });
  }
  if (source.step.prompt !== undefined)
    return normalizeAgentStep({...shared, context: source.context});
  if (source.step.checkout !== undefined) return normalizeCheckoutStep(shared);
  throw new Error(
    `Workflow step "${params.stepId}" is neither a run, agent, tool, nor checkout step`,
  );
}

function normalizeStep(params: {
  step: WorkflowDocumentStep;
  index: number;
  sourceName: string;
  jobId: string;
  allSteps: readonly WorkflowDocumentStep[];
  workflowEnvKeys: readonly string[];
  jobEnvKeys: readonly string[];
  usedStepIds: Map<string, number>;
  issues: WorkflowModelValidationIssue[];
  stepSourceLocations: WorkflowStepSourceLocationMap | undefined;
  fillSite: AvailabilitySite;
  allowedJobReferences: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
  upstreamJobs: readonly WorkflowJobTypeOverlay[];
  directNeedJobs: readonly WorkflowJobTypeOverlay[];
  toolOverlayByKey: Map<string, WorkflowStepTypeOverlay>;
  context: NormalizeContext;
}): WorkflowModelStep | undefined {
  const stepKey = params.step.key;
  const stepId =
    stepKey === undefined
      ? `${params.jobId}-step-${params.index + 1}`
      : `${params.jobId}-${stableId(stepKey)}`;
  registerStepId(params, stepId);
  // Compute the previous-steps overlay list once and reuse it in every typed
  // environment for this step; the environments differ only in the extra
  // roots (current step, upstream jobs, direct needs).
  const previousContext = previousStepTypeContext(params);
  const previousStepsOverlay = previousContext.environment;
  const sourceLocation = params.stepSourceLocations?.get(params.sourceName)?.get(params.index);
  const stepBase = {
    id: stepId,
    ...(stepKey === undefined ? {} : {key: stepKey}),
    ...(params.step.name === undefined ? {} : {name: params.step.name}),
    ...(params.step.working_directory === undefined
      ? {}
      : {workingDirectory: params.step.working_directory}),
    ...(sourceLocation === undefined ? {} : {sourceLocation}),
  };
  // Tool steps resolve their catalog-tied fields before the current-step
  // overlay exists, because that overlay is derived from them.
  const toolStepResult =
    params.step.tool === undefined
      ? undefined
      : normalizeToolStep({
          step: params.step,
          stepBase,
          sourceName: params.sourceName,
          stepIndex: params.index,
          name: normalizeStepName({...params, typeOverlay: previousStepsOverlay}),
          issues: params.issues,
          fillSite: params.fillSite,
          allowedJobReferences: params.allowedJobReferences,
          typeOverlay: previousStepsOverlay,
          integrationValidationContext: params.context.integrationValidationContext,
        });
  const outputs =
    toolStepResult === undefined
      ? normalizeStepOutputs({
          step: params.step,
          sourceName: params.sourceName,
          stepIndex: params.index,
          issues: params.issues,
        })
      : undefined;
  let currentStepOverlay: WorkflowStepTypeOverlay | undefined;
  if (stepKey !== undefined) {
    currentStepOverlay =
      toolStepResult?.overlay ??
      ({
        key: stepKey,
        ...(outputs === undefined ? {} : {outputs}),
      } satisfies WorkflowStepTypeOverlay);
  }
  const {typeOverlay, conditionTypeOverlay} = currentStepTypeContext(
    params,
    previousContext,
    currentStepOverlay,
  );

  const condition = normalizeIfCondition({
    field: 'step.if',
    source: params.step.if,
    path: ['jobs', params.sourceName, 'steps', params.index, 'if'],
    invalidCode: 'invalid-step-if',
    invalidMessage: 'Step if must be a valid wrapped CEL boolean expression.',
    issues: params.issues,
    allowedJobReferences: params.allowedJobReferences,
    typeOverlay: conditionTypeOverlay,
  });
  const gate = normalizeStepGate({
    step: params.step,
    sourceName: params.sourceName,
    stepIndex: params.index,
    stepId,
    previousStepKeys: new Set(
      params.allSteps
        .slice(0, params.index)
        .flatMap((candidate) => (candidate.key ? [candidate.key] : [])),
    ),
    issues: params.issues,
    allowedJobReferences: params.allowedJobReferences,
    typeOverlay,
    ...(toolStepResult === undefined ? {} : {stepKind: 'tool' as const}),
  });
  const name =
    toolStepResult === undefined
      ? normalizeStepName({...params, typeOverlay})
      : (toolStepResult.step.templates?.name ?? undefined);
  return normalizeConcreteStep({
    normalization: params,
    stepId,
    stepKey,
    stepBase,
    outputs,
    condition,
    gate,
    toolStepResult,
    name,
    workingDirectory: normalizeStepWorkingDirectory(params, typeOverlay),
    typeOverlay,
  });
}

function normalizeStepName(params: {
  step: WorkflowDocumentStep;
  index: number;
  sourceName: string;
  issues: WorkflowModelValidationIssue[];
  fillSite: AvailabilitySite;
  allowedJobReferences: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
}): WorkflowFieldTemplate | undefined {
  if (params.step.name === undefined) return undefined;

  return parseInterpolationField({
    field: 'step.name',
    source: params.step.name,
    path: ['jobs', params.sourceName, 'steps', params.index, 'name'],
    issues: params.issues,
    fillSite: params.fillSite,
    allowedJobReferences: params.allowedJobReferences,
    typeOverlay: params.typeOverlay,
  });
}

function normalizeCheckoutStep(params: {
  step: WorkflowDocumentStep;
  stepBase: WorkflowModelStepBaseFields;
  name: WorkflowFieldTemplate | undefined;
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
  fillSite: AvailabilitySite;
  allowedJobReferences: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
}): WorkflowModelCheckoutStep {
  const checkout = params.step.checkout;
  if (checkout === undefined) {
    throw new Error('Checkout step normalization requires checkout settings');
  }

  const normalizedCheckout: WorkflowModelStepCheckout = normalizeCheckout({
    checkout,
    issues: params.issues,
    path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'checkout'],
    fillSite: params.fillSite,
    allowedJobReferences: params.allowedJobReferences,
    typeOverlay: params.typeOverlay,
  });

  return {
    ...params.stepBase,
    kind: 'checkout',
    checkout: normalizedCheckout,
    ...(params.name === undefined ? {} : {templates: {name: params.name}}),
  };
}

function normalizeRunStep(params: {
  step: WorkflowDocumentStep;
  stepBase: WorkflowModelStepBaseFields;
  sourceName: string;
  stepIndex: number;
  workflowEnvKeys: readonly string[];
  jobEnvKeys: readonly string[];
  name: WorkflowFieldTemplate | undefined;
  workingDirectory: WorkflowFieldTemplate | undefined;
  issues: WorkflowModelValidationIssue[];
  fillSite: AvailabilitySite;
  allowedJobReferences: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
}): WorkflowModelRunStep {
  if (params.step.run === undefined) {
    throw new Error('Run step normalization requires a run command');
  }

  const commandTemplate = parseInterpolationField({
    field: 'run',
    source: params.step.run,
    path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'run'],
    issues: params.issues,
    fillSite: params.fillSite,
    allowedJobReferences: params.allowedJobReferences,
    typeOverlay: params.typeOverlay,
  });
  const stepEnv = normalizeEnv({
    env: params.step.env,
    path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'env'],
    issues: params.issues,
    fillSite: params.fillSite,
    allowedJobReferences: params.allowedJobReferences,
    typeOverlay: params.typeOverlay,
  });
  addReevaluatingCommandWarnings({
    command: commandTemplate,
    source: params.step.run,
    workflowEnvKeys: params.workflowEnvKeys,
    jobEnvKeys: params.jobEnvKeys,
    stepEnvKeys: Object.keys(params.step.env ?? {}),
    path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'run'],
    issues: params.issues,
  });
  const templates = optionalRunStepTemplates({
    command: commandTemplate,
    name: params.name,
    workingDirectory: params.workingDirectory,
    env: stepEnv.templates?.env,
  });

  return {
    ...params.stepBase,
    kind: 'run',
    command: {kind: 'shell', value: params.step.run},
    ...(stepEnv.env === undefined ? {} : {env: stepEnv.env}),
    ...(templates === undefined ? {} : {templates}),
  };
}

function addReevaluatingCommandWarnings(params: {
  command: WorkflowFieldTemplate | undefined;
  source: string;
  workflowEnvKeys: readonly string[];
  jobEnvKeys: readonly string[];
  stepEnvKeys: readonly string[];
  path: readonly WorkflowModelValidationIssuePathSegment[];
  issues: WorkflowModelValidationIssue[];
}): void {
  const envKeys = new Set([...params.workflowEnvKeys, ...params.jobEnvKeys, ...params.stepEnvKeys]);
  let hoisted: ReturnType<typeof hoistPlannedRunCommand>;

  try {
    hoisted = hoistPlannedRunCommand({
      field: {
        segments: params.command ?? [{kind: 'literal', value: params.source}],
      },
      reservedNames: envKeys,
    });
  } catch (error) {
    if (!(error instanceof UnsafeRunInterpolationError)) return;

    for (const occurrence of error.occurrences) {
      params.issues.push(
        issue({
          code: 're-evaluating-command',
          message: unsafeInterpolationWarningMessage(occurrence),
          path: params.path,
          severity: 'warning',
        }),
      );
    }

    if (error.partial === undefined) return;
    hoisted = error.partial;
  }

  try {
    const matches = classifyShellCodePosition({
      command: hoisted.command,
      workflowDataNames: [...envKeys, ...hoisted.bindings.map((binding) => binding.name)],
    }).matches;

    for (const match of matches) {
      params.issues.push(
        issue({
          code: 're-evaluating-command',
          message: reevaluatingCommandWarningMessage(match.construct, match.name),
          path: params.path,
          severity: 'warning',
        }),
      );
    }
  } catch {
    return;
  }
}

function unsafeInterpolationWarningMessage(error: UnsafeRunInterpolation): string {
  const regionLabel = {
    single: 'single-quoted shell text',
    double: 'double-quoted shell text',
    'dollar-single': 'ANSI-C shell text',
    'dollar-double': 'dollar-double-quoted shell text',
    'paren-sub': 'command substitution',
    arith: 'shell arithmetic',
    backtick: 'backtick substitution',
    'param-brace': 'shell parameter expansion',
    heredoc: 'a heredoc',
    'line-comment': 'a shell comment',
    escape: 'a shell escape',
  }[error.region];

  return `Value "${error.source}" is inside ${regionLabel} and will be re-executed as code. Hoisting cannot protect it; move the interpolation to a normal quoted argument instead.`;
}

function reevaluatingCommandWarningMessage(
  construct: ShellReevaluatingConstruct,
  name: string,
): string {
  const constructLabel = {
    eval: 'eval',
    'sh-c': 'sh -c',
    'bash-c': 'bash -c',
    source: 'source',
    let: 'let',
    'declare-i': 'declare -i',
    arithmetic: 'shell arithmetic',
    awk: 'awk',
    jq: 'jq',
    sed: 'sed',
    'xargs-sh-c': 'xargs sh -c',
  }[construct];

  return `Value "$${name}" is passed to ${constructLabel} and re-executed as code. Hoisting cannot protect it; pass the value to a fixed program instead.`;
}

function normalizeAgentStep(params: {
  step: WorkflowDocumentStep;
  stepBase: WorkflowModelStepBaseFields;
  sourceName: string;
  stepIndex: number;
  name: WorkflowFieldTemplate | undefined;
  workingDirectory: WorkflowFieldTemplate | undefined;
  issues: WorkflowModelValidationIssue[];
  fillSite: AvailabilitySite;
  allowedJobReferences: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
  context: NormalizeContext;
}): WorkflowModelAgentStep {
  if (params.step.prompt === undefined) {
    throw new Error('Agent step normalization requires a prompt');
  }

  const promptTemplate = parseInterpolationField({
    field: 'agent.prompt',
    source: params.step.prompt,
    path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'prompt'],
    issues: params.issues,
    fillSite: params.fillSite,
    allowedJobReferences: params.allowedJobReferences,
    typeOverlay: params.typeOverlay,
  });
  const modelTemplate =
    params.step.model === undefined
      ? undefined
      : parseInterpolationField({
          field: 'agent.model',
          source: params.step.model,
          path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'model'],
          issues: params.issues,
          fillSite: params.fillSite,
          allowedJobReferences: params.allowedJobReferences,
          typeOverlay: params.typeOverlay,
        });
  const providerTemplate =
    params.step.provider === undefined
      ? undefined
      : parseInterpolationField({
          field: 'agent.provider',
          source: params.step.provider,
          path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'provider'],
          issues: params.issues,
          fillSite: params.fillSite,
          allowedJobReferences: params.allowedJobReferences,
          typeOverlay: params.typeOverlay,
        });
  const thinkingTemplate =
    params.step.thinking === undefined
      ? undefined
      : parseInterpolationField({
          field: 'agent.thinking',
          source: params.step.thinking,
          path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'thinking'],
          issues: params.issues,
          fillSite: params.fillSite,
          allowedJobReferences: params.allowedJobReferences,
          typeOverlay: params.typeOverlay,
        });
  const session = normalizeAgentStepSession({
    step: params.step,
    sourceName: params.sourceName,
    stepIndex: params.stepIndex,
    issues: params.issues,
    fillSite: params.fillSite,
    allowedJobReferences: params.allowedJobReferences,
    typeOverlay: params.typeOverlay,
  });
  validateAgentStep({
    step: params.step,
    sourceName: params.sourceName,
    stepIndex: params.stepIndex,
    issues: params.issues,
    validateLiteralModel:
      params.step.model !== undefined && !hasInterpolationSyntax(params.step.model),
    validateLiteralProvider:
      params.step.provider !== undefined && !hasInterpolationSyntax(params.step.provider),
    agentValidationCatalog: params.context.agentValidationCatalog,
  });
  const integrations = normalizeAgentIntegrations({
    integrations: params.step.integrations,
    sourceName: params.sourceName,
    stepIndex: params.stepIndex,
    issues: params.issues,
    integrationValidationContext: params.context.integrationValidationContext,
  });
  const templates = optionalAgentStepTemplates({
    prompt: promptTemplate,
    model: modelTemplate,
    provider: providerTemplate,
    thinking: thinkingTemplate,
    name: params.name,
    workingDirectory: params.workingDirectory,
  });

  return {
    ...params.stepBase,
    kind: 'agent',
    ...(params.step.harness === undefined ? {} : {harness: params.step.harness}),
    ...(params.step.model === undefined ? {} : {model: params.step.model}),
    ...(params.step.provider === undefined ? {} : {provider: params.step.provider}),
    prompt: params.step.prompt,
    ...(params.step.thinking === undefined ? {} : {thinking: params.step.thinking}),
    ...(session === undefined ? {} : {session}),
    ...(params.step.tools === undefined ? {} : {tools: params.step.tools}),
    ...(params.step.tool_surface === undefined ? {} : {toolSurface: params.step.tool_surface}),
    ...(integrations === undefined ? {} : {integrations}),
    ...(templates === undefined ? {} : {templates}),
  };
}

function normalizeAgentStepSession(params: {
  step: WorkflowDocumentStep;
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
  fillSite: AvailabilitySite;
  allowedJobReferences: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
}): WorkflowModelAgentStepSession | undefined {
  const session = params.step.session;
  if (session === undefined) return undefined;

  const keySource = typeof session === 'string' ? session : session.key;
  const path =
    typeof session === 'string'
      ? ['jobs', params.sourceName, 'steps', params.stepIndex, 'session']
      : ['jobs', params.sourceName, 'steps', params.stepIndex, 'session', 'key'];
  const issueCountBeforeParsing = params.issues.length;
  const template = parseInterpolationField({
    field: 'agent.session',
    source: keySource,
    path,
    issues: params.issues,
    fillSite: params.fillSite,
    allowedJobReferences: params.allowedJobReferences,
    typeOverlay: params.typeOverlay,
  });

  const hasInvalidKey =
    params.issues.length === issueCountBeforeParsing &&
    (template === undefined
      ? !WORKFLOW_SESSION_KEY_PATTERN.test(keySource)
      : !isValidWorkflowSessionKeyTemplateLiteralParts(keySource));

  if (hasInvalidKey) {
    params.issues.push(
      issue({
        code: 'invalid-agent-session-key',
        message:
          'Agent session keys must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens, with a maximum length of 128 characters.',
        path,
        details: {key: keySource},
      }),
    );
  }

  return {
    key: template ?? [{kind: 'literal' as const, value: keySource}],
    mode: typeof session === 'string' ? 'resume' : (session.mode ?? 'resume'),
  };
}

interface SessionSharingStep {
  readonly jobName: string;
  readonly stepIndex: number;
  readonly stepKey: string | undefined;
  readonly keySource: string;
  readonly mode: 'resume' | 'fork';
  readonly harness: string;
}

// Bounds the cross-job sharing pass so a hostile or degenerate document cannot
// force unbounded pair work or issue allocation on the shared validation path.
const MAX_SESSION_SHARING_PAIR_EVALUATIONS = 100_000;

// Each session-key group is examined up to a fixed step window so one large
// degenerate group cannot monopolize the pair budget and starve later keys;
// at most one issue is reported per code per key, so the earliest conflict in
// the examined window is the one that matters. The window always retains the
// first resume-mode step of each distinct job and one step per distinct
// effective harness before it fills with the earliest remaining steps (see
// selectSessionSharingWindow), so a job holding many serial steps -- or a job
// whose first sharing step forks the session -- cannot push another job's
// resume step -- or a divergent harness -- out of the window.
const MAX_SESSION_SHARING_STEPS_PER_KEY = 100;

// Context roots whose value is fixed per run. A session key built only from
// these roots (or from no interpolation at all) resolves identically in every
// job, so identical template text means the same resolved key. Per-job roots
// (steps, job, execution, jobs, needs, ...) resolve per job and can make
// identical templates differ at runtime.
const RUN_GLOBAL_SESSION_KEY_CONTEXT_ROOTS = new Set<string>([
  'workflow',
  'run',
  'trigger',
  'event',
  'inputs',
  'vars',
  'secrets',
]);

function collectSessionSharingSteps(
  document: WorkflowDocument,
  defaultHarnessId: string,
): SessionSharingStep[] {
  const steps: SessionSharingStep[] = [];
  for (const [jobName, job] of Object.entries(document.jobs)) {
    job.steps.forEach((step, stepIndex) => {
      if (step.session === undefined) return;
      steps.push({
        jobName,
        stepIndex,
        stepKey: step.key,
        keySource: typeof step.session === 'string' ? step.session : step.session.key,
        mode: typeof step.session === 'string' ? 'resume' : (step.session.mode ?? 'resume'),
        harness: step.harness ?? defaultHarnessId,
      });
    });
  }
  return steps;
}

function sessionFieldIssueStepKeys(issues: readonly WorkflowModelValidationIssue[]): Set<string> {
  const keys = new Set<string>();
  for (const entry of issues) {
    const path = entry.path;
    if (path.length >= 5 && path[0] === 'jobs' && path[2] === 'steps' && path[4] === 'session') {
      keys.add(`${path[1]}\u0000${path[3]}`);
    }
  }
  return keys;
}

function isRunGlobalSessionKey(keySource: string, cache: Map<string, boolean>): boolean {
  const cached = cache.get(keySource);
  if (cached !== undefined) return cached;
  const runGlobalOnly = referencesRunGlobalOnlySessionKey(keySource);
  cache.set(keySource, runGlobalOnly);
  return runGlobalOnly;
}

function groupSessionSharingSteps(
  steps: readonly SessionSharingStep[],
  invalidSteps: ReadonlySet<string>,
): Map<string, SessionSharingStep[]> {
  const groups = new Map<string, SessionSharingStep[]>();
  const runGlobalOnlyByKeySource = new Map<string, boolean>();
  for (const step of steps) {
    if (invalidSteps.has(sessionStepPathKey(step))) continue;
    if (!isRunGlobalSessionKey(step.keySource, runGlobalOnlyByKeySource)) continue;
    const group = groups.get(step.keySource) ?? [];
    if (group.length === 0) groups.set(step.keySource, group);
    group.push(step);
  }
  return groups;
}

interface SessionSharingValidationState {
  ancestorsByJobName: Map<string, ReadonlySet<string>>;
  parallelResumeReportedKeys: Set<string>;
  harnessMismatchReportedKeys: Set<string>;
  evaluatedPairs: number;
}

function reportParallelResumeConflict(
  document: WorkflowDocument,
  keySource: string,
  prior: SessionSharingStep,
  later: SessionSharingStep,
  issues: WorkflowModelValidationIssue[],
  state: SessionSharingValidationState,
): void {
  if (prior.jobName === later.jobName || prior.mode !== 'resume' || later.mode !== 'resume') return;
  if (state.parallelResumeReportedKeys.has(keySource)) return;
  const priorAncestors = transitiveNeedsAncestors(
    document,
    prior.jobName,
    state.ancestorsByJobName,
  );
  const laterAncestors = transitiveNeedsAncestors(
    document,
    later.jobName,
    state.ancestorsByJobName,
  );
  if (priorAncestors.has(later.jobName) || laterAncestors.has(prior.jobName)) return;
  state.parallelResumeReportedKeys.add(keySource);
  issues.push(
    issue({
      code: 'agent-session-parallel-resume',
      message: `Agent steps ${sessionSharingStepLabel(prior)} (job "${prior.jobName}") and ${sessionSharingStepLabel(later)} (job "${later.jobName}") both resume session key "${keySource}", but their jobs have no transitive "needs" ancestry, so they can run in parallel and would conflict on the session. Add a "needs" edge between the jobs, fork the session on one step, or use distinct session keys.`,
      path: ['jobs', later.jobName, 'steps', later.stepIndex, 'session'],
      details: {
        key: keySource,
        jobs: [prior.jobName, later.jobName],
        stepIndexes: [prior.stepIndex, later.stepIndex],
      },
    }),
  );
}

function reportHarnessMismatch(
  keySource: string,
  prior: SessionSharingStep,
  later: SessionSharingStep,
  issues: WorkflowModelValidationIssue[],
  state: SessionSharingValidationState,
): void {
  if (prior.harness === later.harness || state.harnessMismatchReportedKeys.has(keySource)) return;
  state.harnessMismatchReportedKeys.add(keySource);
  issues.push(
    issue({
      code: 'agent-session-harness-mismatch',
      message: `Agent steps ${sessionSharingStepLabel(prior)} (job "${prior.jobName}") and ${sessionSharingStepLabel(later)} (job "${later.jobName}") share session key "${keySource}" but resolve to different harnesses: "${prior.harness}" and "${later.harness}". A session is pinned to the harness that created it. Ensure every step that shares the session key resolves to the same harness.`,
      path: ['jobs', later.jobName, 'steps', later.stepIndex, 'session'],
      details: {
        key: keySource,
        jobs: [prior.jobName, later.jobName],
        stepIndexes: [prior.stepIndex, later.stepIndex],
        harnesses: [prior.harness, later.harness],
      },
    }),
  );
}

function evaluatePriorSessionPairs(
  document: WorkflowDocument,
  keySource: string,
  group: readonly SessionSharingStep[],
  index: number,
  issues: WorkflowModelValidationIssue[],
  state: SessionSharingValidationState,
): boolean {
  const later = group[index];
  if (later === undefined) return true;
  for (let priorIndex = 0; priorIndex < index; priorIndex += 1) {
    if (state.evaluatedPairs >= MAX_SESSION_SHARING_PAIR_EVALUATIONS) return false;
    state.evaluatedPairs += 1;
    const prior = group[priorIndex];
    if (prior === undefined) continue;
    reportParallelResumeConflict(document, keySource, prior, later, issues, state);
    reportHarnessMismatch(keySource, prior, later, issues, state);
  }
  return true;
}

function validateSessionSharingGroups(
  document: WorkflowDocument,
  groups: ReadonlyMap<string, readonly SessionSharingStep[]>,
  issues: WorkflowModelValidationIssue[],
): void {
  const state: SessionSharingValidationState = {
    ancestorsByJobName: new Map(),
    parallelResumeReportedKeys: new Set(),
    harnessMismatchReportedKeys: new Set(),
    evaluatedPairs: 0,
  };
  for (const [keySource, sharingSteps] of groups) {
    const group = selectSessionSharingWindow(sharingSteps);
    for (let index = 1; index < group.length; index += 1) {
      if (
        state.parallelResumeReportedKeys.has(keySource) &&
        state.harnessMismatchReportedKeys.has(keySource)
      ) {
        break;
      }
      if (!evaluatePriorSessionPairs(document, keySource, group, index, issues, state)) return;
    }
  }
}

// Cross-job authoring checks for shared agent sessions: two resume-mode steps
// with statically identical session key templates from jobs without a
// transitive needs ancestry would claim the same session in parallel, and
// steps sharing a static key must agree on the effective harness because a
// session is pinned to the harness that created it. Templates are compared
// literally only; distinct templates that collide at runtime stay the
// dispatch-time claim's job, and templates that reference per-job context are
// not compared because identical text can resolve to different keys per job.
// Harness agreement also applies to steps within one job: serial steps never
// claim in parallel, but a session is pinned to the harness that created it
// regardless of serialization. Steps are grouped by keySource and pairs are
// only evaluated inside a group, so the pair budget counts relevant work only
// and a later key is never skipped because unrelated pairs consumed the
// budget; the run-global-only classification is memoized per keySource. At
// most one issue is reported per session key per code, each group is examined
// up to a fixed step window that always retains the first resume-mode step of
// each distinct job and one step per distinct effective harness, and the whole
// pass stops after a fixed pair budget, so large documents stay bounded and
// long serial runs cannot hide sharing conflicts.
function validateAgentSessionSharing(
  document: WorkflowDocument,
  issues: WorkflowModelValidationIssue[],
  defaultHarnessId: string,
): void {
  const steps = collectSessionSharingSteps(document, defaultHarnessId);

  // Steps whose session field already produced an issue in the per-step pass
  // can never name a session; stacking sharing issues on them would double-
  // report a broken key. This mirrors the per-step suppression of
  // invalid-agent-session-key when any other session issue was raised.
  const sessionFieldIssueSteps = sessionFieldIssueStepKeys(issues);

  // Group eligible steps by keySource so pairs are only ever evaluated inside
  // one key group: the pair budget then counts relevant work only and cannot
  // be exhausted by unrelated (different-key) pairs before later identical
  // keys are examined. Each group is then cut to a fixed window (see
  // selectSessionSharingWindow) that always keeps the first resume-mode step
  // of each distinct job and one step per distinct effective harness, so a
  // single degenerate group cannot starve every later key and a long serial
  // job -- or a fork step hiding its job's resume step -- cannot hide another
  // job's sharing step behind the window. Keys that reference per-job context
  // resolve per job and stay out.
  const stepsByKeySource = groupSessionSharingSteps(steps, sessionFieldIssueSteps);
  validateSessionSharingGroups(document, stepsByKeySource, issues);
}

function sessionStepPathKey(step: SessionSharingStep): string {
  return `${step.jobName}\u0000${step.stepIndex}`;
}

// Cuts a session-key group to the fixed step window while always retaining
// the first resume-mode step of each distinct job and one step per distinct
// effective harness, then fills the remainder with the earliest steps in
// document order. Without the resume retention, one job holding more than
// MAX_SESSION_SHARING_STEPS_PER_KEY serial steps -- or a job whose first
// sharing step forks the session -- would fill the window and silently drop
// another job's resume step (or that job's own later resume step), skipping a
// real parallel-resume conflict; without the harness retention, a single
// divergent harness step could sit beyond the window and evade
// agent-session-harness-mismatch. Documents where more than the window of
// distinct jobs share one key remain bounded: the earliest conflict between
// retained steps, which is always reachable from the first two jobs that
// contribute resume steps, is still reported.
function selectSessionSharingWindow(steps: readonly SessionSharingStep[]): SessionSharingStep[] {
  const window: SessionSharingStep[] = [];
  const resumeStepsByJob = new Set<string>();
  const harnessesInWindow = new Set<string>();
  const inWindow = new Set<SessionSharingStep>();

  const add = (step: SessionSharingStep): void => {
    if (window.length >= MAX_SESSION_SHARING_STEPS_PER_KEY || inWindow.has(step)) return;
    inWindow.add(step);
    window.push(step);
    harnessesInWindow.add(step.harness);
  };

  // Reservation pass: a step is added when it is the first resume-mode step
  // of its job or the first step with its effective harness. A fork step
  // therefore never consumes the slot that protects its job's resume step,
  // and the two roles share the window budget so neither can starve the
  // other before the fill pass runs.
  for (const step of steps) {
    const isFirstResumeOfJob = step.mode === 'resume' && !resumeStepsByJob.has(step.jobName);
    const isHarnessRepresentative = !harnessesInWindow.has(step.harness);
    if (!isFirstResumeOfJob && !isHarnessRepresentative) continue;
    if (isFirstResumeOfJob) resumeStepsByJob.add(step.jobName);
    add(step);
  }

  for (const step of steps) {
    add(step);
  }

  return window;
}

// Only templates built from run-global context (or pure literals) resolve
// identically in every job, so only they can be compared by exact text.
function referencesRunGlobalOnlySessionKey(keySource: string): boolean {
  if (!keySource.includes('${{')) return true;

  let segments: WorkflowTemplateSegment[];
  try {
    segments = parseWorkflowTemplate(keySource);
  } catch {
    // Unparseable templates are already flagged by the per-step pass.
    return false;
  }

  for (const segment of segments) {
    if (segment.kind !== 'expr') continue;
    if (segment.contextRoots.some((root) => !RUN_GLOBAL_SESSION_KEY_CONTEXT_ROOTS.has(root))) {
      return false;
    }
  }
  return true;
}

function sessionSharingStepLabel(step: SessionSharingStep): string {
  return step.stepKey === undefined ? String(step.stepIndex) : `"${step.stepKey}"`;
}

function transitiveNeedsAncestors(
  document: WorkflowDocument,
  jobName: string,
  cache: Map<string, ReadonlySet<string>>,
): ReadonlySet<string> {
  const cached = cache.get(jobName);
  if (cached !== undefined) return cached;

  const ancestors = new Set<string>();
  const pending = [...normalizeNeeds(document.jobs[jobName]?.needs)];
  while (pending.length > 0) {
    const name = pending.pop();
    if (name === undefined || ancestors.has(name) || !Object.hasOwn(document.jobs, name)) continue;
    ancestors.add(name);
    pending.push(...normalizeNeeds(document.jobs[name]?.needs));
  }
  cache.set(jobName, ancestors);
  return ancestors;
}

function validateAgentStep(params: {
  step: WorkflowDocumentStep;
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
  validateLiteralModel: boolean;
  validateLiteralProvider: boolean;
  agentValidationCatalog: AgentValidationCatalogV2;
}): void {
  validateHarnessThinking(params);
  validateHarnessTools(params);
  const providerId = params.step.provider;
  const harness = params.step.harness ?? params.agentValidationCatalog.default_harness_id;
  const provider =
    providerId === undefined
      ? undefined
      : params.agentValidationCatalog.providers.find((entry) => entry.id === providerId);

  if (!validateAgentProvider(params, providerId, harness, provider)) return;
  validateAgentModel(params, providerId, harness, provider);
}

type ValidateAgentStepParams = Parameters<typeof validateAgentStep>[0];
type AgentCatalogProvider = AgentValidationCatalogV2['providers'][number];

function validateAgentProvider(
  params: ValidateAgentStepParams,
  providerId: string | undefined,
  harness: string | undefined,
  provider: AgentCatalogProvider | undefined,
): boolean {
  if (!params.validateLiteralProvider || providerId === undefined) return true;
  if (provider === undefined) {
    if (harness === undefined || harness === 'pi') return false;
    params.issues.push(
      issue({
        code: 'invalid-provider',
        message: `Provider "${providerId}" is not supported.`,
        path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'provider'],
        details: {provider: providerId},
      }),
    );
    return false;
  }
  if (provider.support_status !== 'supported') {
    params.issues.push(
      issue({
        code: 'invalid-provider',
        message: `Provider "${providerId}" is not supported.`,
        path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'provider'],
        details: {provider: providerId},
      }),
    );
    return false;
  }
  const descriptor = params.agentValidationCatalog.harnesses.find((entry) => entry.id === harness);
  if (descriptor?.supported_provider_ids.includes(providerId)) return true;
  params.issues.push(
    issue({
      code: 'harness-provider-incompatible',
      message: `Harness "${harness}" does not support provider: ${providerId}. Supported providers: ${descriptor?.supported_provider_ids.join(', ') ?? ''}.`,
      path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'provider'],
      details: {
        harness,
        provider: providerId,
        supportedProviders: descriptor?.supported_provider_ids ?? [],
      },
    }),
  );
  return false;
}

function validateAgentModel(
  params: ValidateAgentStepParams,
  providerId: string | undefined,
  harness: string | undefined,
  provider: AgentCatalogProvider | undefined,
): void {
  if (!params.validateLiteralModel || providerId === undefined) return;
  if (provider === undefined || provider.support_status !== 'supported') return;

  const model = params.step.model;
  if (model === undefined) return;

  const descriptor = params.agentValidationCatalog.harnesses.find((entry) => entry.id === harness);
  const modelIds = descriptor?.model_ids_by_provider?.[providerId];
  if (modelIds === undefined || modelIds.includes(model)) return;

  params.issues.push(
    issue({
      code: 'invalid-model',
      message: `Agent model "${model}" is not available for harness "${harness}" and provider "${providerId}".`,
      path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'model'],
      details: {harness, provider: providerId, model},
    }),
  );
}

function validateHarnessTools(params: {
  step: WorkflowDocumentStep;
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
  agentValidationCatalog: AgentValidationCatalogV2;
}): void {
  const {tools} = params.step;
  if (tools === undefined) return;
  const harness = params.step.harness ?? params.agentValidationCatalog.default_harness_id;

  const supportedTools =
    params.agentValidationCatalog.harnesses.find((entry) => entry.id === harness)
      ?.effective_tools ?? [];
  const supportedToolSet = new Set(supportedTools);

  tools.forEach((tool, toolIndex) => {
    if (supportedToolSet.has(tool)) return;

    params.issues.push(
      issue({
        code: 'harness-tool-incompatible',
        message: `Harness "${harness}" does not support tool: ${tool}. Supported tools: ${supportedTools.join(', ')}.`,
        path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'tools', toolIndex],
        details: {harness, tool, supportedTools},
      }),
    );
  });
}

function validateHarnessThinking(params: {
  step: WorkflowDocumentStep;
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
  agentValidationCatalog: AgentValidationCatalogV2;
}): void {
  const {thinking} = params.step;
  if (thinking === undefined) return;
  const harness = params.step.harness ?? params.agentValidationCatalog.default_harness_id;
  // An interpolated level is only known when the step dispatches, so the agent
  // module checks it against the resolved harness there.
  if (hasInterpolationSyntax(thinking)) return;

  const supportedLevels =
    params.agentValidationCatalog.harnesses.find((entry) => entry.id === harness)
      ?.thinking_levels ?? [];
  if ((supportedLevels as readonly string[]).includes(thinking)) return;
  params.issues.push(
    issue({
      code: 'harness-thinking-incompatible',
      message: `Harness "${harness}" does not support thinking: ${thinking}. Supported levels: ${supportedLevels.join(', ')}.`,
      path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'thinking'],
      details: {harness, thinking, supportedLevels},
    }),
  );
}
function normalizeRunner(params: {
  document: WorkflowDocument;
  job: WorkflowDocumentJob;
  sourceName: string;
  issues: WorkflowModelValidationIssue[];
  defaultRunnerLabels: readonly string[];
}): {labels: readonly string[]; templates: readonly WorkflowFieldTemplate[]} {
  const rawRunner = params.job.runner ?? params.document.runner;
  if (rawRunner === undefined) {
    const runnerLabels = params.defaultRunnerLabels;
    validateRunnerLabels({...params, runnerLabels, allowEmpty: false});
    return {labels: runnerLabels, templates: []};
  }

  const runnerValues = typeof rawRunner === 'string' ? [rawRunner] : rawRunner;
  const literalLabels: string[] = [];
  const templates: WorkflowFieldTemplate[] = [];
  let templateValueCount = 0;
  for (const [index, value] of runnerValues.entries()) {
    const template = parseInterpolationField({
      field: 'job.runner',
      source: value,
      path: ['jobs', params.sourceName, 'runner', index],
      issues: params.issues,
      fillSite: 'execution-creation',
    });
    const hasTemplateSyntax = hasInterpolationSyntax(value);
    if (hasTemplateSyntax) templateValueCount += 1;
    if (template === undefined && !hasTemplateSyntax) {
      literalLabels.push(value);
    } else if (template !== undefined) {
      templates.push(template);
    }
  }

  const runnerLabels = canonicalizeLabels(literalLabels);
  validateRunnerLabels({
    ...params,
    runnerLabels,
    runnerLabelCount: runnerLabels.length + templates.length,
    allowEmpty: templateValueCount > 0,
  });

  return {labels: runnerLabels, templates};
}

function hasInterpolationSyntax(value: string): boolean {
  return value.includes('${{');
}

function validateRunnerLabels(params: {
  sourceName: string;
  issues: WorkflowModelValidationIssue[];
  runnerLabels: readonly string[];
  runnerLabelCount?: number;
  allowEmpty: boolean;
}): void {
  const runnerLabels = params.runnerLabels;
  const runnerLabelCount = params.runnerLabelCount ?? runnerLabels.length;
  const invalid = findInvalidLabels(runnerLabels);

  if (invalid.length > 0) {
    params.issues.push(
      issue({
        code: 'invalid-runner-label',
        message: `Job "${params.sourceName}" has invalid runner label(s): ${invalid.join(', ')}. Labels must match ${RUNNER_LABEL_PATTERN} and be at most ${MAX_RUNNER_LABEL_LENGTH} chars.`,
        path: ['jobs', params.sourceName, 'runner'],
        details: {labels: invalid},
      }),
    );
  }

  if (runnerLabels.length === 0 && !params.allowEmpty) {
    params.issues.push(
      issue({
        code: 'missing-runner-label',
        message: `Job "${params.sourceName}" must declare at least one runner label. Set "runner" on the job or the workflow, or configure DEFINITION_DEFAULT_RUNNER_LABEL.`,
        path: ['jobs', params.sourceName, 'runner'],
      }),
    );
  }

  if (runnerLabelCount > MAX_RUNNER_LABELS) {
    params.issues.push(
      issue({
        code: 'too-many-runner-labels',
        message: `Job "${params.sourceName}" declares ${runnerLabelCount} runner labels; the maximum is ${MAX_RUNNER_LABELS}.`,
        path: ['jobs', params.sourceName, 'runner'],
      }),
    );
  }
}

export type WorkflowModelStepBaseFields = Pick<
  WorkflowModelStep,
  'id' | 'key' | 'name' | 'workingDirectory' | 'outputs' | 'sourceLocation' | 'gate'
>;

function optionalRunStepTemplates(params: {
  command: WorkflowFieldTemplate | undefined;
  name: WorkflowFieldTemplate | undefined;
  workingDirectory: WorkflowFieldTemplate | undefined;
  env: WorkflowEnvTemplates | undefined;
}):
  | {
      command?: WorkflowFieldTemplate;
      name?: WorkflowFieldTemplate;
      workingDirectory?: WorkflowFieldTemplate;
      env?: WorkflowEnvTemplates;
    }
  | undefined {
  if (
    params.command === undefined &&
    params.name === undefined &&
    params.workingDirectory === undefined &&
    params.env === undefined
  ) {
    return undefined;
  }

  return {
    ...(params.command === undefined ? {} : {command: params.command}),
    ...(params.name === undefined ? {} : {name: params.name}),
    ...(params.workingDirectory === undefined ? {} : {workingDirectory: params.workingDirectory}),
    ...(params.env === undefined ? {} : {env: params.env}),
  };
}

function optionalAgentStepTemplates(params: {
  prompt: WorkflowFieldTemplate | undefined;
  model: WorkflowFieldTemplate | undefined;
  provider: WorkflowFieldTemplate | undefined;
  thinking: WorkflowFieldTemplate | undefined;
  name: WorkflowFieldTemplate | undefined;
  workingDirectory: WorkflowFieldTemplate | undefined;
}):
  | {
      prompt?: WorkflowFieldTemplate;
      model?: WorkflowFieldTemplate;
      provider?: WorkflowFieldTemplate;
      thinking?: WorkflowFieldTemplate;
      name?: WorkflowFieldTemplate;
      workingDirectory?: WorkflowFieldTemplate;
    }
  | undefined {
  if (
    params.prompt === undefined &&
    params.model === undefined &&
    params.provider === undefined &&
    params.thinking === undefined &&
    params.name === undefined &&
    params.workingDirectory === undefined
  ) {
    return undefined;
  }

  return {
    ...(params.prompt === undefined ? {} : {prompt: params.prompt}),
    ...(params.model === undefined ? {} : {model: params.model}),
    ...(params.provider === undefined ? {} : {provider: params.provider}),
    ...(params.thinking === undefined ? {} : {thinking: params.thinking}),
    ...(params.name === undefined ? {} : {name: params.name}),
    ...(params.workingDirectory === undefined ? {} : {workingDirectory: params.workingDirectory}),
  };
}
