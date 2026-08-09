import {DEFAULT_JOB_CHECKOUT, type WorkflowModel} from '@shipfox/api-definitions-dto';
import {findInvalidLabels, MAX_RUNNER_LABELS, resolveRunnerLabels} from '@shipfox/runner-labels';
import {runnerCatalog} from '#config.js';
import type {AgentDefaultsResolver} from '#core/agent-defaults.js';
import type {
  AgentToolMaterializationContext,
  AgentToolMaterializationSnapshot,
} from '#core/agent-tools.js';
import {
  InvalidJobRunnerLabelsError,
  JobOutputTooLargeError,
  JobOutputTooManyEntriesError,
} from '#core/errors.js';
import {completeStepField, completeStepFieldWithType} from './fields.js';
import {
  type JsonSafeJobOutputValue,
  jobOutputRecordEntryByteLength,
  jobOutputValueByteLength,
  MAX_JOB_OUTPUT_ENTRIES,
  MAX_JOB_OUTPUT_VALUE_BYTES,
  MAX_JOB_OUTPUTS_TOTAL_BYTES,
  normalizeJobOutputValue,
} from './job-output-limits.js';
import {
  type MaterializedWorkflowStep,
  materializeJobExecutionSteps,
} from './materialize-job-execution-steps.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

type WorkflowModelJob = WorkflowModel['jobs'][number];
export interface MaterializedWorkflowJob {
  readonly key: string;
  readonly mode: WorkflowModelJob['mode'];
  readonly success?: string;
  readonly executionTimeoutMs?: number;
  readonly checkout: Exclude<WorkflowModelJob['checkout'], false>;
  readonly listening?: WorkflowModelJob['listening'];
  readonly name?: string;
  readonly outputs?: WorkflowModelJob['outputs'];
  readonly dependencies: readonly string[];
  readonly runner: readonly string[];
  readonly position: number;
  readonly steps: readonly MaterializedWorkflowStep[];
}

export interface MaterializeWorkflowModelParams {
  readonly model: WorkflowModel;
  readonly context?: WorkflowEvaluationContext | undefined;
  readonly resolveAgentDefaults?: AgentDefaultsResolver | undefined;
  readonly definitionId?: string | undefined;
  readonly agentToolContext?: AgentToolMaterializationContext | undefined;
  readonly agentToolSnapshot?: AgentToolMaterializationSnapshot | null | undefined;
}

export async function materializeWorkflowModel(
  params: MaterializeWorkflowModelParams,
): Promise<readonly MaterializedWorkflowJob[]> {
  const {
    model,
    context = {site: 'run-creation', values: {}},
    resolveAgentDefaults,
    definitionId = model.name,
    agentToolContext,
    agentToolSnapshot,
  } = params;
  const jobsById = new Map(model.jobs.map((job) => [job.id, job]));

  return await Promise.all(
    model.jobs.map(async (job, position) => {
      const name = job.name;
      return {
        key: job.key,
        mode: job.mode,
        ...(job.success === undefined ? {} : {success: job.success}),
        ...(job.executionTimeoutMs === undefined
          ? {}
          : {executionTimeoutMs: job.executionTimeoutMs}),
        checkout: job.checkout === false ? DEFAULT_JOB_CHECKOUT : job.checkout,
        ...(job.listening === undefined ? {} : {listening: job.listening}),
        ...(name === undefined ? {} : {name}),
        ...(job.outputs === undefined ? {} : {outputs: job.outputs}),
        dependencies: dependencySourceNames(job, jobsById),
        runner: job.runner,
        position,
        steps:
          job.mode === 'listening'
            ? []
            : await materializeJobExecutionSteps({
                model,
                job,
                context,
                resolveAgentDefaults,
                definitionId,
                agentToolContext,
                agentToolSnapshot,
              }),
      };
    }),
  );
}

export function materializeJobRunner(params: {
  readonly job: WorkflowModelJob;
  readonly context: WorkflowEvaluationContext;
  readonly definitionId: string;
}): readonly string[] {
  const resolvedLabels = (params.job.runnerTemplates ?? []).map((template) =>
    completeStepField({
      field: 'job.runner',
      errorField: 'job.runner',
      template: {segments: template},
      context: params.context,
      definitionId: params.definitionId,
    }),
  );
  const requestedLabels = [...params.job.runner, ...resolvedLabels];
  const labels = resolveRunnerLabels(requestedLabels, runnerCatalog);
  const invalidLabels = findInvalidLabels(labels);
  if (labels.length === 0 || labels.length > MAX_RUNNER_LABELS || invalidLabels.length > 0) {
    throw new InvalidJobRunnerLabelsError(labels, requestedLabels);
  }
  return labels;
}

export function materializeJobOutputs(params: {
  readonly job: WorkflowModelJob;
  readonly context: WorkflowEvaluationContext;
  readonly definitionId: string;
}): Record<string, unknown> | null {
  const outputs = params.job.outputs;
  if (outputs === undefined) return null;

  const outputEntries = Object.entries(outputs);
  if (outputEntries.length > MAX_JOB_OUTPUT_ENTRIES) {
    throw new JobOutputTooManyEntriesError(outputEntries.length, MAX_JOB_OUTPUT_ENTRIES);
  }

  const materialized: Record<string, JsonSafeJobOutputValue> = {};
  // This is exactly JSON.stringify(materialized): start with "{}", then add each
  // key/value pair and its comma (except for the first entry).
  let recordBytes = 2;

  for (const [index, [key, template]] of outputEntries.entries()) {
    const outputTypes = params.job.outputTypes;
    const outputType =
      outputTypes !== undefined && Object.hasOwn(outputTypes, key) ? outputTypes[key] : undefined;
    const completionParams = {
      field: 'job.outputs' as const,
      errorField: 'job.outputs' as const,
      template: {segments: template},
      context: params.context,
      definitionId: params.definitionId,
    };
    const value =
      outputType === undefined || outputType === 'string'
        ? completeStepField(completionParams)
        : completeStepFieldWithType(completionParams);
    const normalizedValue = normalizeJobOutputValue(value, key);
    const valueBytes = jobOutputValueByteLength(normalizedValue);
    if (valueBytes > MAX_JOB_OUTPUT_VALUE_BYTES) {
      throw new JobOutputTooLargeError(key, MAX_JOB_OUTPUT_VALUE_BYTES, valueBytes, 'value');
    }

    recordBytes += (index === 0 ? 0 : 1) + jobOutputRecordEntryByteLength(key, normalizedValue);
    Object.defineProperty(materialized, key, {
      configurable: true,
      enumerable: true,
      value: normalizedValue,
      writable: true,
    });
    if (recordBytes > MAX_JOB_OUTPUTS_TOTAL_BYTES) {
      throw new JobOutputTooLargeError(key, MAX_JOB_OUTPUTS_TOTAL_BYTES, recordBytes, 'total');
    }
  }

  return materialized;
}

export function modelHasAgentStep(model: WorkflowModel): boolean {
  return model.jobs.some((job) => job.steps.some((step) => step.kind === 'agent'));
}

function dependencySourceNames(
  job: WorkflowModelJob,
  jobsById: ReadonlyMap<string, WorkflowModelJob>,
): readonly string[] {
  return job.dependencies.map((dependencyId) => {
    const dependency = jobsById.get(dependencyId);
    if (!dependency) {
      throw new Error(`Unresolved workflow model dependency "${dependencyId}" for job "${job.id}"`);
    }
    return dependency.key;
  });
}
