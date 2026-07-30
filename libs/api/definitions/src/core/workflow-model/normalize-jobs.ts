import type {AgentValidationCatalog} from '@shipfox/api-agent-dto/inter-module';
import {
  type AvailabilitySite,
  buildTypedRootsEnvironment,
  type ExpressionType,
  type ExpressionTypeEnvironment,
  type WorkflowJobTypeOverlay,
  type WorkflowStepTypeOverlay,
} from '@shipfox/expression';
import {
  canonicalizeLabels,
  findInvalidLabels,
  MAX_RUNNER_LABEL_LENGTH,
  MAX_RUNNER_LABELS,
  RUNNER_LABEL_PATTERN,
} from '@shipfox/runner-labels';
import type {
  WorkflowDocument,
  WorkflowDocumentJob,
  WorkflowDocumentStep,
} from '@shipfox/workflow-document';
import type {IntegrationValidationContext} from '../entities/integration-context.js';
import type {
  WorkflowEnvTemplates,
  WorkflowFieldTemplate,
  WorkflowModelAgentStep,
  WorkflowModelJob,
  WorkflowModelRunStep,
  WorkflowModelStep,
  WorkflowOutputTemplates,
  WorkflowStepSourceLocationMap,
} from '../entities/workflow-model.js';
import type {WorkflowModelValidationIssue} from './invalid-workflow-model-error.js';
import {normalizeAgentIntegrations} from './normalize-agent-integrations.js';
import {normalizeEnv} from './normalize-env.js';
import {normalizeIfCondition} from './normalize-if-condition.js';
import {normalizeJobCheckout} from './normalize-job-checkout.js';
import {normalizeJobListening} from './normalize-job-listening.js';
import {normalizeJobSuccess} from './normalize-job-success.js';
import {normalizeNeeds} from './normalize-needs.js';
import {normalizeStepGate} from './normalize-step-gate.js';
import {normalizeStepOutputs} from './normalize-step-outputs.js';
import {parseDurationMs} from './parse-duration-ms.js';
import {parseInterpolationField} from './parse-interpolation-field.js';
import {stableId} from './stable-id.js';
import {issue} from './validation-issue.js';

export interface NormalizeContext {
  readonly defaultRunnerLabels: readonly string[];
  readonly agentValidationCatalog: AgentValidationCatalog;
  readonly integrationValidationContext?: IntegrationValidationContext | undefined;
}

export function normalizeJobs(
  document: WorkflowDocument,
  jobIdBySourceName: ReadonlyMap<string, string>,
  issues: WorkflowModelValidationIssue[],
  stepSourceLocations: WorkflowStepSourceLocationMap | undefined,
  context: NormalizeContext,
): readonly WorkflowModelJob[] {
  const entries = Object.entries(document.jobs);
  const pending = new Set(entries.map(([sourceName]) => sourceName));
  const modelsBySourceName = new Map<string, WorkflowModelJob>();
  const jobOutputTypesBySourceName = new Map<string, Readonly<Record<string, ExpressionType>>>();
  const issuesBySourceName = new Map<string, WorkflowModelValidationIssue[]>();

  while (pending.size > 0) {
    let progressed = false;

    for (const [sourceName, job] of entries) {
      if (!pending.has(sourceName)) continue;

      const dependencySourceNames = normalizeNeeds(job.needs).filter((dependency) =>
        jobIdBySourceName.has(dependency),
      );
      if (dependencySourceNames.some((dependency) => pending.has(dependency))) continue;

      const model = normalizeJob({
        document,
        sourceName,
        job,
        jobIdBySourceName,
        issues: issuesForSourceName(issuesBySourceName, sourceName),
        stepSourceLocations,
        context,
        jobOutputTypesBySourceName,
      });
      if (model !== undefined) modelsBySourceName.set(sourceName, model);
      pending.delete(sourceName);
      progressed = true;
    }

    if (progressed) continue;

    for (const sourceName of pending) {
      const job = document.jobs[sourceName];
      if (job === undefined) continue;
      const model = normalizeJob({
        document,
        sourceName,
        job,
        jobIdBySourceName,
        issues: issuesForSourceName(issuesBySourceName, sourceName),
        stepSourceLocations,
        context,
        jobOutputTypesBySourceName,
      });
      if (model !== undefined) modelsBySourceName.set(sourceName, model);
    }
    break;
  }

  for (const [sourceName] of entries) {
    issues.push(...(issuesBySourceName.get(sourceName) ?? []));
  }

  return entries.flatMap(([sourceName]) => {
    const model = modelsBySourceName.get(sourceName);
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
  const steps = normalizeJobSteps({
    sourceName: params.sourceName,
    jobId: id,
    job: params.job,
    issues: params.issues,
    stepSourceLocations: params.stepSourceLocations,
    fillSite: stepFillSite,
    allowedJobReferences,
    typeOverlay: stepTypeOverlay,
    upstreamJobs,
    directNeedJobs,
    context: params.context,
  });
  const runner = normalizeRunner({
    document: params.document,
    job: params.job,
    sourceName: params.sourceName,
    issues: params.issues,
    defaultRunnerLabels: params.context.defaultRunnerLabels,
  });
  const checkout = normalizeJobCheckout(params.job.checkout);
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
    site: 'job-activation',
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
  });
  const name =
    params.job.name === undefined
      ? undefined
      : (parseInterpolationField({
          field: 'job.name',
          source: params.job.name,
          path: ['jobs', params.sourceName, 'name'],
          issues: params.issues,
          allowedJobReferences,
          typeOverlay: upstreamJobsTypeOverlay,
        }) ?? [{kind: 'literal' as const, value: params.job.name}]);
  if (name?.some((segment) => segment.kind !== 'literal')) {
    params.issues.push(
      issue({
        code: 'invalid-interpolation-template',
        message:
          'Job name must be static text. Use execution_name for a per-execution dynamic name.',
        path: ['jobs', params.sourceName, 'name'],
        details: {
          field: 'job.name',
          source: params.job.name,
          reason: 'Job names cannot contain interpolation expressions.',
        },
      }),
    );
  }
  const executionName =
    params.job.execution_name === undefined
      ? undefined
      : (parseInterpolationField({
          field: 'job.execution_name',
          source: params.job.execution_name,
          path: ['jobs', params.sourceName, 'execution_name'],
          issues: params.issues,
          fillSite: 'execution-creation',
          allowedJobReferences,
          typeOverlay: upstreamJobsTypeOverlay,
        }) ?? [{kind: 'literal' as const, value: params.job.execution_name}]);

  return {
    id,
    key: params.sourceName,
    mode: listening === undefined ? 'one_shot' : 'listening',
    runner: runner.labels,
    ...(runner.templates.length === 0 ? {} : {runnerTemplates: runner.templates}),
    checkout,
    ...(condition === undefined ? {} : {if: condition}),
    ...(success === undefined ? {} : {success}),
    ...(outputs === undefined ? {} : {outputs: outputs.templates}),
    ...(outputs?.types === undefined ? {} : {outputTypes: outputs.types}),
    ...(executionTimeoutMs === undefined ? {} : {executionTimeoutMs}),
    ...(listening === undefined ? {} : {listening}),
    ...(name === undefined ? {} : {name}),
    ...(executionName === undefined ? {} : {executionName}),
    ...jobEnv,
    dependencies,
    steps,
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
): readonly WorkflowStepTypeOverlay[] {
  return steps.slice(0, index).flatMap((step) => {
    if (step.key === undefined) return [];
    return [{key: step.key, ...(step.outputs === undefined ? {} : {outputs: step.outputs})}];
  });
}

function allStepOverlays(
  steps: readonly WorkflowDocumentStep[],
): readonly WorkflowStepTypeOverlay[] {
  return previousStepOverlays(steps, steps.length);
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
  const typeOverlay =
    hasStepOutputDeclarations || params.upstreamJobs.length > 0
      ? buildTypedRootsEnvironment({
          ...(hasStepOutputDeclarations ? {steps: allStepOverlays(params.steps)} : {}),
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
    types[key] = inferJobOutputType({
      sourceName: params.sourceName,
      key,
      source,
      template,
      issues: params.issues,
    });
  }

  return {templates, types};
}

function inferJobOutputType(params: {
  sourceName: string;
  key: string;
  source: string;
  template: WorkflowFieldTemplate;
  issues: WorkflowModelValidationIssue[];
}): ExpressionType {
  if (params.template.length !== 1) return 'string';

  const [segment] = params.template;
  if (segment?.kind !== 'deferred') return 'string';

  const resultType = segment.expression.resultType;
  if (resultType === undefined) return 'string';
  if (isScalarExpressionType(resultType)) return resultType;

  params.issues.push(
    issue({
      code: 'invalid-job-output',
      message: `Job output "${params.key}" must resolve to a scalar value.`,
      path: ['jobs', params.sourceName, 'outputs', params.key],
      details: {
        output: params.key,
        source: params.source,
      },
    }),
  );
  return 'string';
}

function isScalarExpressionType(type: ExpressionType): boolean {
  return (
    type === 'string' ||
    type === 'int' ||
    type === 'double' ||
    type === 'bool' ||
    type === 'null' ||
    type === 'timestamp'
  );
}

function normalizeJobSteps(params: {
  sourceName: string;
  jobId: string;
  job: WorkflowDocumentJob;
  issues: WorkflowModelValidationIssue[];
  stepSourceLocations: WorkflowStepSourceLocationMap | undefined;
  fillSite: AvailabilitySite;
  allowedJobReferences: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
  upstreamJobs: readonly WorkflowJobTypeOverlay[];
  directNeedJobs: readonly WorkflowJobTypeOverlay[];
  context: NormalizeContext;
}): readonly WorkflowModelStep[] {
  const usedStepIds = new Map<string, number>();

  return params.job.steps.map((step, index) =>
    normalizeStep({
      step,
      index,
      sourceName: params.sourceName,
      jobId: params.jobId,
      allSteps: params.job.steps,
      usedStepIds,
      issues: params.issues,
      stepSourceLocations: params.stepSourceLocations,
      fillSite: params.fillSite,
      allowedJobReferences: params.allowedJobReferences,
      typeOverlay: params.typeOverlay,
      upstreamJobs: params.upstreamJobs,
      directNeedJobs: params.directNeedJobs,
      context: params.context,
    }),
  );
}

function normalizeStep(params: {
  step: WorkflowDocumentStep;
  index: number;
  sourceName: string;
  jobId: string;
  allSteps: readonly WorkflowDocumentStep[];
  usedStepIds: Map<string, number>;
  issues: WorkflowModelValidationIssue[];
  stepSourceLocations: WorkflowStepSourceLocationMap | undefined;
  fillSite: AvailabilitySite;
  allowedJobReferences: ReadonlySet<string>;
  typeOverlay?: ExpressionTypeEnvironment | undefined;
  upstreamJobs: readonly WorkflowJobTypeOverlay[];
  directNeedJobs: readonly WorkflowJobTypeOverlay[];
  context: NormalizeContext;
}): WorkflowModelStep {
  const stepKey = params.step.key;
  const stepId =
    stepKey === undefined
      ? `${params.jobId}-step-${params.index + 1}`
      : `${params.jobId}-${stableId(stepKey)}`;
  const existingIndex = params.usedStepIds.get(stepId);

  if (existingIndex !== undefined) {
    params.issues.push(
      issue({
        code: 'duplicate-step-id',
        message: `Steps ${existingIndex} and ${params.index} in job "${params.sourceName}" resolve to the same stable id "${stepId}".`,
        path: ['jobs', params.sourceName, 'steps', params.index],
        details: {id: stepId, indexes: [existingIndex, params.index]},
      }),
    );
  } else {
    params.usedStepIds.set(stepId, params.index);
  }

  const outputs = normalizeStepOutputs({
    step: params.step,
    sourceName: params.sourceName,
    stepIndex: params.index,
    issues: params.issues,
  });
  const currentStepOverlay =
    stepKey === undefined
      ? undefined
      : ({
          key: stepKey,
          ...(outputs === undefined ? {} : {outputs}),
        } satisfies WorkflowStepTypeOverlay);
  const shouldBuildTypeOverlay = params.typeOverlay !== undefined || params.upstreamJobs.length > 0;
  const typeOverlay = !shouldBuildTypeOverlay
    ? undefined
    : buildTypedRootsEnvironment({
        steps: previousStepOverlays(params.allSteps, params.index),
        ...(currentStepOverlay === undefined ? {} : {currentStep: currentStepOverlay}),
        ...(params.upstreamJobs.length === 0 ? {} : {jobs: params.upstreamJobs}),
      });
  const conditionTypeOverlay = buildTypedRootsEnvironment({
    steps: previousStepOverlays(params.allSteps, params.index),
    ...(currentStepOverlay === undefined ? {} : {currentStep: currentStepOverlay}),
    jobs: params.directNeedJobs,
    needs: params.directNeedJobs,
  });

  const condition = normalizeIfCondition({
    field: 'step.if',
    source: params.step.if,
    site: 'step-dispatch',
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
  });
  const sourceLocation = params.stepSourceLocations?.get(params.sourceName)?.get(params.index);
  const name =
    params.step.name === undefined
      ? undefined
      : parseInterpolationField({
          field: 'step.name',
          source: params.step.name,
          path: ['jobs', params.sourceName, 'steps', params.index, 'name'],
          issues: params.issues,
          fillSite: params.fillSite,
          allowedJobReferences: params.allowedJobReferences,
          typeOverlay,
        });
  const stepBase = {
    id: stepId,
    ...(stepKey === undefined ? {} : {key: stepKey}),
    ...(params.step.name === undefined ? {} : {name: params.step.name}),
    ...(outputs === undefined ? {} : {outputs}),
    ...(sourceLocation === undefined ? {} : {sourceLocation}),
    ...(condition === undefined ? {} : {if: condition}),
    ...(gate === undefined ? {} : {gate}),
  };

  if (params.step.run !== undefined) {
    return normalizeRunStep({
      step: params.step,
      stepBase,
      sourceName: params.sourceName,
      stepIndex: params.index,
      name,
      issues: params.issues,
      fillSite: params.fillSite,
      allowedJobReferences: params.allowedJobReferences,
      typeOverlay,
    });
  }

  if (params.step.prompt !== undefined) {
    return normalizeAgentStep({
      step: params.step,
      stepBase,
      sourceName: params.sourceName,
      stepIndex: params.index,
      name,
      issues: params.issues,
      fillSite: params.fillSite,
      allowedJobReferences: params.allowedJobReferences,
      typeOverlay,
      context: params.context,
    });
  }

  // workflowDocumentStepSchema requires either `run` or an agent `prompt`; this
  // keeps the model-step union honest if callers bypass the document parser.
  throw new Error(`Workflow step "${stepId}" is neither a run nor an agent step`);
}

function normalizeRunStep(params: {
  step: WorkflowDocumentStep;
  stepBase: WorkflowModelStepBaseFields;
  sourceName: string;
  stepIndex: number;
  name: WorkflowFieldTemplate | undefined;
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
  const templates = optionalRunStepTemplates({
    command: commandTemplate,
    name: params.name,
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

function normalizeAgentStep(params: {
  step: WorkflowDocumentStep;
  stepBase: WorkflowModelStepBaseFields;
  sourceName: string;
  stepIndex: number;
  name: WorkflowFieldTemplate | undefined;
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
  validateAgentStep({
    step: params.step,
    sourceName: params.sourceName,
    stepIndex: params.stepIndex,
    issues: params.issues,
    validateLiteralProvider: providerTemplate === undefined,
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
    name: params.name,
  });

  return {
    ...params.stepBase,
    kind: 'agent',
    ...(params.step.harness === undefined ? {} : {harness: params.step.harness}),
    ...(params.step.model === undefined ? {} : {model: params.step.model}),
    ...(params.step.provider === undefined ? {} : {provider: params.step.provider}),
    prompt: params.step.prompt,
    ...(params.step.thinking === undefined ? {} : {thinking: params.step.thinking}),
    ...(params.step.tools === undefined ? {} : {tools: params.step.tools}),
    ...(integrations === undefined ? {} : {integrations}),
    ...(templates === undefined ? {} : {templates}),
  };
}

function validateAgentStep(params: {
  step: WorkflowDocumentStep;
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
  validateLiteralProvider: boolean;
  agentValidationCatalog: AgentValidationCatalog;
}): void {
  validateHarnessThinking(params);
  validateHarnessTools(params);
  if (!params.validateLiteralProvider) return;

  const providerId = params.step.provider;
  if (providerId === undefined) return;

  const provider = params.agentValidationCatalog.providers.find((entry) => entry.id === providerId);
  const harness = params.step.harness;
  if (provider === undefined && harness === 'pi') return;

  if (provider === undefined || provider.support_status !== 'supported') {
    params.issues.push(
      issue({
        code: 'invalid-provider',
        message: `Provider "${providerId}" is not supported.`,
        path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'provider'],
        details: {provider: providerId},
      }),
    );
    return;
  }

  if (harness === undefined) return;

  const descriptor = params.agentValidationCatalog.harnesses.find((entry) => entry.id === harness);
  if (descriptor?.supported_provider_ids.includes(providerId)) return;

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
}

function validateHarnessTools(params: {
  step: WorkflowDocumentStep;
  sourceName: string;
  stepIndex: number;
  issues: WorkflowModelValidationIssue[];
  agentValidationCatalog: AgentValidationCatalog;
}): void {
  const {harness, tools} = params.step;
  if (tools === undefined) return;

  if (harness === undefined) {
    params.issues.push(
      issue({
        code: 'missing-harness-for-tools',
        message:
          'Agent step tools require an explicit harness because tool names are harness-specific.',
        path: ['jobs', params.sourceName, 'steps', params.stepIndex, 'tools'],
        details: {tools},
      }),
    );
    return;
  }

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
  agentValidationCatalog: AgentValidationCatalog;
}): void {
  const {harness, thinking} = params.step;
  if (harness === undefined || thinking === undefined) return;

  const supportedLevels =
    params.agentValidationCatalog.harnesses.find((entry) => entry.id === harness)
      ?.thinking_levels ?? [];
  if (supportedLevels.includes(thinking)) return;
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

type WorkflowModelStepBaseFields = Pick<
  WorkflowModelStep,
  'id' | 'key' | 'name' | 'outputs' | 'sourceLocation' | 'gate'
>;

function optionalRunStepTemplates(params: {
  command: WorkflowFieldTemplate | undefined;
  name: WorkflowFieldTemplate | undefined;
  env: WorkflowEnvTemplates | undefined;
}):
  | {
      command?: WorkflowFieldTemplate;
      name?: WorkflowFieldTemplate;
      env?: WorkflowEnvTemplates;
    }
  | undefined {
  if (params.command === undefined && params.name === undefined && params.env === undefined) {
    return undefined;
  }

  return {
    ...(params.command === undefined ? {} : {command: params.command}),
    ...(params.name === undefined ? {} : {name: params.name}),
    ...(params.env === undefined ? {} : {env: params.env}),
  };
}

function optionalAgentStepTemplates(params: {
  prompt: WorkflowFieldTemplate | undefined;
  model: WorkflowFieldTemplate | undefined;
  provider: WorkflowFieldTemplate | undefined;
  name: WorkflowFieldTemplate | undefined;
}):
  | {
      prompt?: WorkflowFieldTemplate;
      model?: WorkflowFieldTemplate;
      provider?: WorkflowFieldTemplate;
      name?: WorkflowFieldTemplate;
    }
  | undefined {
  if (
    params.prompt === undefined &&
    params.model === undefined &&
    params.provider === undefined &&
    params.name === undefined
  ) {
    return undefined;
  }

  return {
    ...(params.prompt === undefined ? {} : {prompt: params.prompt}),
    ...(params.model === undefined ? {} : {model: params.model}),
    ...(params.provider === undefined ? {} : {provider: params.provider}),
    ...(params.name === undefined ? {} : {name: params.name}),
  };
}
