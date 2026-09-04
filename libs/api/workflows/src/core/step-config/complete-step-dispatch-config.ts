import {WORKFLOW_MODEL_CHECKOUT_TARGET_FIELDS} from '@shipfox/api-definitions-dto';
import {
  type AgentStepSessionIntentDto,
  agentStepSessionDescriptorSchema,
  assertWorkingDirectory,
} from '@shipfox/api-workflows-dto';
import {capTraceEntries, type ResolvedFieldSegment} from '@shipfox/expression';
import {Ajv, type AnySchema} from 'ajv';
import type {AgentDefaultsResolver} from '#core/agent-defaults.js';
import type {PersistedEvaluationTraceEntry, Step} from '#core/entities/step.js';
import {AgentStepSessionClaimError, ToolConfigInvalidError} from '#core/errors.js';
import {completeAgentConfig, readAgentStepSessionIntent} from './agent.js';
import {completeStepFieldWithTrace, completeStepFieldWithTypeAndTrace} from './fields.js';
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
    if (params.step.type === 'tool') {
      completeToolConfig({
        config: params.step.config,
        plan: {},
        context: params.context,
        definitionId: params.definitionId,
        trace: [],
      });
    }
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
  completeToolConfig({
    config,
    plan,
    definitionId: params.definitionId,
    context: params.context,
    trace,
  });
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

function completeToolConfig(params: {
  readonly config: Record<string, unknown>;
  readonly plan: Step['configPlan'] & object;
  readonly context: WorkflowEvaluationContext;
  readonly definitionId: string;
  readonly trace: PersistedEvaluationTraceEntry[];
}): void {
  const toolPlan = params.plan.tool;
  const tool = params.config.tool;
  if (toolPlan === undefined && (tool === undefined || tool === null)) return;
  if (tool === null || typeof tool !== 'object' || Array.isArray(tool)) {
    throw new ToolConfigInvalidError('Tool dispatch config is missing an object');
  }
  const toolConfig = {...tool} as Record<string, unknown>;
  const baseWith = toolConfig.with;
  toolConfig.with = mergeToolWith(baseWith, toolPlan?.with, params, 'tool.with');
  const method = toolConfig.method;
  const input = toolConfig.with ?? {};
  if (method !== undefined && (typeof input !== 'object' || Array.isArray(input))) {
    throw new ToolConfigInvalidError(
      'Tool input is invalid: expected an object when a method is selected',
    );
  }
  const inputWithMethod =
    method === undefined ? input : {...(input as Record<string, unknown>), method};
  const ajv = new Ajv({
    strict: true,
    strictRequired: false,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false,
  });
  let valid = false;
  try {
    const validate = ajv.compile(toolConfig.input_schema as AnySchema);
    valid = validate(inputWithMethod) === true;
  } catch (error) {
    throw new ToolConfigInvalidError(
      `Tool input schema is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!valid) throw new ToolConfigInvalidError(`Tool input is invalid: ${ajv.errorsText()}`);
  if (method !== undefined) toolConfig.with = inputWithMethod;
  params.config.tool = toolConfig;
}

function mergeToolWith(
  base: unknown,
  plan: NonNullable<NonNullable<Step['configPlan']>['tool']>['with'] | undefined,
  params: {
    readonly context: WorkflowEvaluationContext;
    readonly definitionId: string;
    readonly trace: PersistedEvaluationTraceEntry[];
  },
  field: 'tool.with',
): unknown {
  if (plan === undefined) return base;
  if (isFieldTemplate(plan)) {
    const resolved = completeStepFieldWithTypeAndTrace({
      field,
      template: {segments: plan},
      context: params.context,
      definitionId: params.definitionId,
      errorField: field,
    });
    params.trace.push(...resolved.trace.map((entry) => ({...entry, field})));
    return resolved.value;
  }
  if (Array.isArray(plan)) {
    const values = Array.isArray(base) ? [...base] : [];
    plan.forEach((child, index) => {
      if (child !== undefined) values[index] = mergeToolWith(values[index], child, params, field);
    });
    return values;
  }
  if (typeof plan === 'object' && plan !== null && !('segments' in plan)) {
    const source =
      base !== null && typeof base === 'object' && !Array.isArray(base)
        ? (base as Record<string, unknown>)
        : {};
    const values = {...source};
    for (const [key, child] of Object.entries(plan)) {
      if (child !== undefined) values[key] = mergeToolWith(source[key], child, params, field);
    }
    return values;
  }
  throw new ToolConfigInvalidError('Tool input template plan is invalid');
}

function isFieldTemplate(value: unknown): value is readonly ResolvedFieldSegment[] {
  return (
    Array.isArray(value) &&
    value.every(
      (segment) =>
        segment !== null &&
        typeof segment === 'object' &&
        'kind' in segment &&
        (segment.kind === 'literal' || segment.kind === 'deferred'),
    )
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
