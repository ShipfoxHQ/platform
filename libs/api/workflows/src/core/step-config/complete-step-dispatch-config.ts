import {WORKFLOW_MODEL_CHECKOUT_TARGET_FIELDS} from '@shipfox/api-definitions-dto';
import {
  type AgentStepSessionIntentDto,
  agentStepSessionDescriptorSchema,
  assertWorkingDirectory,
} from '@shipfox/api-workflows-dto';
import {capTraceEntries} from '@shipfox/expression';
import type {AgentDefaultsResolver} from '#core/agent-defaults.js';
import type {PersistedEvaluationTraceEntry, Step} from '#core/entities/step.js';
import {AgentStepSessionClaimError} from '#core/errors.js';
import {completeAgentConfig, readAgentStepSessionIntent} from './agent.js';
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
  readonly sessionIntent: AgentStepSessionIntentDto | undefined;
}> {
  const plan = params.step.configPlan;
  if (plan === null) {
    assertWorkingDirectoryIfPresent(params.step.config.working_directory);
    return {
      config: params.step.config,
      trace: [],
      sessionIntent: validateSessionConfig(params.step.config),
    };
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
  const completedSessionIntent = await completeAgentConfig({
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
  completeCheckoutConfig({
    config,
    plan,
    context: params.context,
    definitionId: params.definitionId,
    trace,
  });
  assertWorkingDirectoryIfPresent(config.working_directory);

  return {
    config,
    trace: capTraceEntries(trace),
    sessionIntent: validateSessionConfig(config) ?? completedSessionIntent,
  };
}

function validateSessionConfig(
  config: Record<string, unknown>,
): AgentStepSessionIntentDto | undefined {
  const rawSession = config.session;
  if (rawSession === undefined || rawSession === null) return undefined;

  const intent = readAgentStepSessionIntent(config);
  if (intent !== undefined) return intent;
  if (agentStepSessionDescriptorSchema.safeParse(rawSession).success) return undefined;

  throw new AgentStepSessionClaimError(
    'agent_session_key_invalid',
    'Agent session configuration is invalid',
  );
}

function completeCheckoutConfig(params: {
  readonly config: Record<string, unknown>;
  readonly plan: Step['configPlan'] & object;
  readonly context: WorkflowEvaluationContext;
  readonly definitionId: string;
  readonly trace: PersistedEvaluationTraceEntry[];
}): void {
  const checkoutPlan = params.plan.checkout;
  if (checkoutPlan === undefined) return;

  const checkout = params.config.checkout;
  if (checkout === null || typeof checkout !== 'object' || Array.isArray(checkout)) {
    throw new Error('Checkout dispatch config is missing an object');
  }

  const resolvedCheckout = {...checkout} as Record<string, unknown>;
  params.config.checkout = resolvedCheckout;

  for (const [key, fieldName] of WORKFLOW_MODEL_CHECKOUT_TARGET_FIELDS) {
    const field = checkoutPlan[key];
    if (field === undefined) continue;

    const resolved = completeStepFieldWithTrace({
      field: fieldName,
      template: field,
      context: params.context,
      definitionId: params.definitionId,
      errorField: fieldName,
    });
    resolvedCheckout[key] = resolved.value;
    params.trace.push(...resolved.trace.map((entry) => ({...entry, field: fieldName})));
  }
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
