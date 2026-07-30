import {assertWorkingDirectory} from '@shipfox/api-workflows-dto';
import {capTraceEntries} from '@shipfox/expression';
import type {AgentDefaultsResolver} from '#core/agent-defaults.js';
import type {PersistedEvaluationTraceEntry, Step} from '#core/entities/step.js';
import {completeAgentConfig} from './agent.js';
import {completeStepFieldWithTrace} from './fields.js';
import {completeRunDispatchConfig} from './run.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

export async function completeStepDispatchConfig(params: {
  readonly step: Step;
  readonly context: WorkflowEvaluationContext;
  readonly resolveAgentDefaults?: AgentDefaultsResolver | undefined;
  readonly definitionId: string;
}): Promise<{
  readonly config: Record<string, unknown>;
  readonly trace: readonly PersistedEvaluationTraceEntry[];
}> {
  const plan = params.step.configPlan;
  if (plan === null) {
    assertWorkingDirectoryIfPresent(params.step.config.working_directory);
    return {config: params.step.config, trace: []};
  }

  const config = {...params.step.config};
  delete config.secret_bindings;
  const trace: PersistedEvaluationTraceEntry[] = [...(plan.trace ?? [])];
  completeRunDispatchConfig({
    config,
    plan,
    context: params.context,
    definitionId: params.definitionId,
    trace,
  });
  await completeAgentConfig({
    config,
    plan,
    context: params.context,
    resolveAgentDefaults: params.resolveAgentDefaults,
    definitionId: params.definitionId,
    trace,
  });
  completeWorkingDirectoryConfig({
    config,
    plan,
    context: params.context,
    definitionId: params.definitionId,
    trace,
  });
  assertWorkingDirectoryIfPresent(config.working_directory);

  return {config, trace: capTraceEntries(trace)};
}

function assertWorkingDirectoryIfPresent(value: unknown): void {
  if (value !== undefined) assertWorkingDirectory(value);
}

function completeWorkingDirectoryConfig(params: {
  readonly config: Record<string, unknown>;
  readonly plan: Step['configPlan'] & object;
  readonly context: WorkflowEvaluationContext;
  readonly definitionId: string;
  readonly trace: PersistedEvaluationTraceEntry[];
}): void {
  const field = params.plan.working_directory;
  if (field === undefined) return;

  const resolved = completeStepFieldWithTrace({
    field: 'step.working_directory',
    template: field,
    context: params.context,
    definitionId: params.definitionId,
    errorField: 'step.working_directory',
  });
  params.config.working_directory = resolved.value;
  params.trace.push(
    ...resolved.trace.map((entry) => ({...entry, field: 'step.working_directory' as const})),
  );
}
