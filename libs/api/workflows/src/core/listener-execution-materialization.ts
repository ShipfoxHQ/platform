import type {WorkflowModel} from '@shipfox/api-definitions-dto';
import {evaluationTraceEntry} from '@shipfox/expression';
import type {AgentDefaultsResolver} from './agent-defaults.js';
import type {
  AgentToolMaterializationContext,
  AgentToolMaterializationSnapshot,
} from './agent-tools.js';
import type {Job} from './entities/job.js';
import type {
  JobExecution,
  JobExecutionStatus,
  WorkflowExecutionEvent,
} from './entities/job-execution.js';
import type {PersistedEvaluationTraceEntry} from './entities/step.js';
import type {WorkflowRun} from './entities/workflow-run.js';
import {
  AgentConfigUnresolvableError,
  AgentIntegrationMaterializationError,
  InterpolationUnresolvableError,
  InvalidJobRunnerLabelsError,
} from './errors.js';
import {
  assembleExecutionCreationContext,
  type MaterializedWorkflowStep,
  materializeJobExecutionSteps,
  materializeJobRunner,
  resolveJobExecutionName,
} from './step-config/index.js';
import {staticJobName} from './step-config/static-job-name.js';

export interface MaterializeListenerExecutionParams {
  readonly model: WorkflowModel | null;
  readonly run: Pick<
    WorkflowRun,
    | 'id'
    | 'name'
    | 'definitionId'
    | 'projectId'
    | 'workspaceId'
    | 'createdAt'
    | 'triggerPayload'
    | 'inputs'
  >;
  readonly job: Pick<Job, 'id' | 'key'> & Partial<Pick<Job, 'name'>>;
  readonly vars?: Record<string, string> | undefined;
  readonly variableResolutionError?: InterpolationUnresolvableError | undefined;
  readonly sequence: number;
  readonly triggerEvents: readonly WorkflowExecutionEvent[];
  readonly priorExecutions: readonly JobExecution[];
  readonly resolveAgentDefaults?: AgentDefaultsResolver | undefined;
  readonly agentToolContext?: AgentToolMaterializationContext | undefined;
  readonly agentToolSnapshot?: AgentToolMaterializationSnapshot | null | undefined;
}

export interface MaterializedListenerExecution {
  readonly nameOverride: string | null;
  readonly runner: readonly string[];
  readonly status: JobExecutionStatus;
  readonly statusReason: 'unknown' | null;
  readonly triggerEvents: readonly WorkflowExecutionEvent[];
  readonly evaluationTrace: readonly PersistedEvaluationTraceEntry[] | null;
  readonly steps: readonly MaterializedWorkflowStep[];
}

export async function materializeListenerExecution(
  params: MaterializeListenerExecutionParams,
): Promise<MaterializedListenerExecution> {
  let executionName = params.job.name ?? params.job.key;
  let nameOverride: string | null = null;
  let evaluationTrace: readonly PersistedEvaluationTraceEntry[] = [];
  let runner: readonly string[] = [];
  let steps: readonly MaterializedWorkflowStep[] = [];
  let status: JobExecutionStatus = 'pending';
  if (params.variableResolutionError) {
    evaluationTrace = [variableResolutionTrace(params.variableResolutionError)];
  }

  try {
    if (params.variableResolutionError) throw params.variableResolutionError;
    if (!params.model) throw new PermanentListenerMaterializationError('Run attempt has no model');
    const modelJob = params.model.jobs.find((job) => job.key === params.job.key);
    if (!modelJob) {
      throw new PermanentListenerMaterializationError(
        `Workflow model has no job key: ${params.job.key}`,
      );
    }

    const materializationJob = {
      ...params.job,
      name: params.job.name ?? staticJobName(modelJob) ?? null,
    };
    executionName = materializationJob.name ?? params.job.key;

    const resolvedName = resolveJobExecutionName({
      definitionId: params.run.definitionId,
      job: modelJob,
      context: listenerExecutionContext({
        ...params,
        job: materializationJob,
        nameOverride: null,
        executionName,
        status,
      }).values,
    });
    nameOverride = resolvedName.nameOverride;
    executionName = nameOverride ?? executionName;
    evaluationTrace = resolvedName.trace;

    const context = listenerExecutionContext({
      ...params,
      job: materializationJob,
      nameOverride,
      executionName,
      status,
    });
    runner = materializeJobRunner({
      job: modelJob,
      context,
      definitionId: params.run.definitionId,
    });
    steps = await materializeJobExecutionSteps({
      model: params.model,
      job: modelJob,
      context,
      resolveAgentDefaults: params.resolveAgentDefaults,
      definitionId: params.run.definitionId,
      agentToolContext: params.agentToolContext,
      agentToolSnapshot: params.agentToolSnapshot,
    });
  } catch (error) {
    if (!isPermanentListenerMaterializationError(error)) throw error;
    status = 'failed';
    steps = [];
    runner = [];
  }

  return {
    nameOverride,
    runner,
    status,
    statusReason: status === 'failed' ? 'unknown' : null,
    triggerEvents: params.triggerEvents,
    evaluationTrace: evaluationTrace.length === 0 ? null : evaluationTrace,
    steps,
  };
}

function variableResolutionTrace(
  error: InterpolationUnresolvableError,
): PersistedEvaluationTraceEntry {
  return {
    ...evaluationTraceEntry({
      expression: error.source,
      roots: ['vars'],
      fillTarget: 'execution-creation',
      evaluatedAt: 'execution-creation',
      degraded: true,
    }),
    field: error.field,
    ...(error.envKey === undefined ? {} : {envKey: error.envKey}),
  };
}

function listenerExecutionContext(
  params: Pick<
    MaterializeListenerExecutionParams,
    'run' | 'job' | 'vars' | 'sequence' | 'triggerEvents' | 'priorExecutions'
  > & {
    readonly executionName: string;
    readonly nameOverride: string | null;
    readonly status: JobExecutionStatus;
  },
) {
  return assembleExecutionCreationContext({
    run: params.run,
    triggerPayload: params.run.triggerPayload,
    inputs: params.run.inputs,
    vars: params.vars,
    job: {...params.job, name: params.job.name ?? null},
    sequence: params.sequence,
    nameOverride: params.nameOverride,
    executionName: params.executionName,
    status: params.status,
    triggerEvents: params.triggerEvents,
    priorExecutions: params.priorExecutions,
  });
}

class PermanentListenerMaterializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentListenerMaterializationError';
  }
}

function isPermanentListenerMaterializationError(error: unknown): boolean {
  return (
    error instanceof PermanentListenerMaterializationError ||
    error instanceof InterpolationUnresolvableError ||
    error instanceof InvalidJobRunnerLabelsError ||
    error instanceof AgentConfigUnresolvableError ||
    error instanceof AgentIntegrationMaterializationError
  );
}
