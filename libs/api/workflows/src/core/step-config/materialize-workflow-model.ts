import type {WorkflowModel} from '@shipfox/api-definitions-dto';
import {canonicalizeLabels, findInvalidLabels, MAX_RUNNER_LABELS} from '@shipfox/runner-labels';
import type {AgentDefaultsResolver} from '#core/agent-defaults.js';
import type {
  AgentToolMaterializationContext,
  AgentToolMaterializationSnapshot,
} from '#core/agent-tools.js';
import {InvalidJobRunnerLabelsError} from '#core/errors.js';
import {completeStepField} from './fields.js';
import {
  type MaterializedWorkflowStep,
  materializeJobExecutionSteps,
} from './materialize-job-execution-steps.js';
import {staticJobName} from './static-job-name.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

type WorkflowModelJob = WorkflowModel['jobs'][number];
export interface MaterializedWorkflowJob {
  readonly key: string;
  readonly mode: WorkflowModelJob['mode'];
  readonly success?: string;
  readonly executionTimeoutMs?: number;
  readonly checkout: WorkflowModelJob['checkout'];
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
      const name = staticJobName(job);
      return {
        key: job.key,
        mode: job.mode,
        ...(job.success === undefined ? {} : {success: job.success}),
        ...(job.executionTimeoutMs === undefined
          ? {}
          : {executionTimeoutMs: job.executionTimeoutMs}),
        checkout: job.checkout,
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
  const labels = canonicalizeLabels([...params.job.runner, ...resolvedLabels]);
  const invalidLabels = findInvalidLabels(labels);
  if (labels.length === 0 || labels.length > MAX_RUNNER_LABELS || invalidLabels.length > 0) {
    throw new InvalidJobRunnerLabelsError(labels);
  }
  return labels;
}

export function materializeJobOutputs(params: {
  readonly job: WorkflowModelJob;
  readonly context: WorkflowEvaluationContext;
  readonly definitionId: string;
}): Record<string, string> | null {
  const outputs = params.job.outputs;
  if (outputs === undefined) return null;

  return Object.fromEntries(
    Object.entries(outputs).map(([key, template]) => [
      key,
      completeStepField({
        field: 'job.outputs',
        errorField: 'job.outputs',
        template: {segments: template},
        context: params.context,
        definitionId: params.definitionId,
      }),
    ]),
  );
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
