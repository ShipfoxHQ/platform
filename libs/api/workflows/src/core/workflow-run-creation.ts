import type {WorkflowModel} from '@shipfox/api-definitions-dto';
import type {AgentDefaultsResolver} from './agent-defaults.js';
import type {
  AgentToolMaterializationContext,
  AgentToolMaterializationSnapshot,
} from './agent-tools.js';
import type {JobExecution} from './entities/job-execution.js';
import type {TriggerPayload, WorkflowRun} from './entities/workflow-run.js';
import {
  assembleCreationContext,
  assembleExecutionCreationContext,
} from './step-config/assemble-run-context.js';
import {
  type MaterializedWorkflowJob,
  materializeJobRunner,
  materializeWorkflowModel,
} from './step-config/materialize-workflow-model.js';
import {resolveJobExecutionName} from './step-config/resolve-job-execution-name.js';

export async function materializeWorkflowRunJobs(params: {
  run: WorkflowRun;
  model: WorkflowModel;
  triggerPayload: TriggerPayload;
  inputs?: Record<string, unknown> | null | undefined;
  vars?: Record<string, string> | undefined;
  resolveAgentDefaults?: AgentDefaultsResolver | undefined;
  definitionId: string;
  agentToolContext?: AgentToolMaterializationContext | undefined;
  agentToolSnapshot?: AgentToolMaterializationSnapshot | null | undefined;
}): Promise<readonly MaterializedWorkflowJob[]> {
  const context = assembleCreationContext({
    run: params.run,
    triggerPayload: params.triggerPayload,
    inputs: params.inputs ?? null,
    vars: params.vars,
  });
  return await materializeWorkflowModel({
    model: params.model,
    context,
    resolveAgentDefaults: params.resolveAgentDefaults,
    definitionId: params.definitionId,
    agentToolContext: params.agentToolContext,
    agentToolSnapshot: params.agentToolSnapshot,
  });
}

export function deriveInitialJobExecutionPlan(params: {
  run: WorkflowRun;
  modelJob: WorkflowModel['jobs'][number];
  job: MaterializedWorkflowJob;
  jobId: string;
  sequence: number;
  fallbackName: string;
  triggerPayload: TriggerPayload;
  inputs?: Record<string, unknown> | null | undefined;
  vars?: Record<string, string> | undefined;
}): {
  nameOverride: string | null;
  name: string;
  runner: readonly string[];
  evaluationTrace: JobExecution['evaluationTrace'];
} {
  const nameContext = assembleExecutionCreationContext({
    run: params.run,
    triggerPayload: params.triggerPayload,
    inputs: params.inputs ?? null,
    vars: params.vars,
    job: {id: params.jobId, key: params.job.key, name: params.job.name ?? null},
    sequence: params.sequence,
    nameOverride: null,
    executionName: params.fallbackName,
    status: 'pending',
    triggerEvents: [],
    priorExecutions: [],
  });
  const resolvedName = resolveJobExecutionName({
    definitionId: params.run.definitionId,
    job: params.modelJob,
    context: nameContext.values,
  });
  const runnerContext = assembleExecutionCreationContext({
    run: params.run,
    triggerPayload: params.triggerPayload,
    inputs: params.inputs ?? null,
    vars: params.vars,
    job: {id: params.jobId, key: params.job.key, name: params.job.name ?? null},
    sequence: params.sequence,
    nameOverride: resolvedName.nameOverride,
    executionName: resolvedName.nameOverride ?? params.fallbackName,
    status: 'pending',
    triggerEvents: [],
    priorExecutions: [],
  });
  return {
    nameOverride: resolvedName.nameOverride,
    name: resolvedName.nameOverride ?? params.fallbackName,
    runner: materializeJobRunner({
      job: params.modelJob,
      context: runnerContext,
      definitionId: params.run.definitionId,
    }),
    evaluationTrace: resolvedName.trace,
  };
}

export function deriveJobExecutionRunner(params: {
  run: WorkflowRun;
  modelJob: WorkflowModel['jobs'][number];
  jobId: string;
  sequence: number;
  nameOverride: string | null;
  executionName: string;
  jobName?: string | null | undefined;
  status: JobExecution['status'];
  triggerEvents?: readonly JobExecution['triggerEvents'][number][] | undefined;
  priorExecutions?: readonly JobExecution[] | undefined;
}): readonly string[] {
  return materializeJobRunner({
    job: params.modelJob,
    context: assembleExecutionCreationContext({
      run: params.run,
      triggerPayload: params.run.triggerPayload,
      inputs: params.run.inputs,
      job: {id: params.jobId, key: params.modelJob.key, name: params.jobName ?? null},
      sequence: params.sequence,
      nameOverride: params.nameOverride,
      executionName: params.executionName,
      status: params.status,
      triggerEvents: params.triggerEvents ?? [],
      priorExecutions: params.priorExecutions ?? [],
    }),
    definitionId: params.run.definitionId,
  });
}
