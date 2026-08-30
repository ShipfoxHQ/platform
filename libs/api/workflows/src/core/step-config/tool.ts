import type {WorkflowJsonTemplateTree, WorkflowModel} from '@shipfox/api-definitions-dto';
import type {OutputTypeDeclaration, ResolvedFieldSegment} from '@shipfox/expression';
import type {
  AgentToolMaterializationContext,
  AgentToolMaterializationSnapshot,
  MaterializedToolStep,
} from '#core/agent-tools.js';
import {materializeToolStep} from '#core/agent-tools.js';
import type {StepConfigDispatchPlan} from '#core/entities/step.js';
import {resolveStepFieldWithType} from './fields.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

type Job = WorkflowModel['jobs'][number];
type ToolStep = Extract<Job['steps'][number], {kind: 'tool'}>;

export function resolveToolStepConfig(params: {
  readonly step: ToolStep;
  readonly jobKey: string;
  readonly context: WorkflowEvaluationContext;
  readonly definitionId: string;
  readonly agentToolContext?: AgentToolMaterializationContext;
  readonly agentToolSnapshot?: AgentToolMaterializationSnapshot | null;
  readonly mode?: 'effective' | 'authored';
}): {
  readonly config: Record<string, unknown>;
  readonly configPlan: Pick<StepConfigDispatchPlan, 'tool'> | undefined;
  readonly hasTemplates: boolean;
  readonly diagnostics: never[];
  readonly trace: never[];
  readonly materialized: MaterializedToolStep;
} {
  const materialized = materializeToolStep({
    jobKey: params.jobKey,
    stepId: params.step.id,
    tool: params.step.tool,
    connection: params.step.connection,
    context: params.agentToolContext,
    snapshot: params.agentToolSnapshot,
  });
  const withValue = params.step.with;
  const tree = params.step.templates?.with;
  const result =
    tree === undefined || params.mode === 'authored'
      ? {value: withValue}
      : resolveWith({
          value: withValue,
          tree,
          context: params.context,
          definitionId: params.definitionId,
        });
  const outputs: Record<string, OutputTypeDeclaration> = {
    result: {
      type: 'json',
      ...(materialized.outputSchema === undefined ? {} : {schema: materialized.outputSchema}),
    },
    ...(params.step.outputs ?? {}),
  };
  return {
    config: {
      tool: {
        connection_id: materialized.connectionId,
        connection_slug: materialized.connectionSlug,
        provider: materialized.provider,
        id: materialized.id,
        ...(materialized.method === undefined ? {} : {method: materialized.method}),
        sensitivity: materialized.sensitivity,
        sensitive: materialized.sensitive,
        required_scope: materialized.requiredScope,
        input_schema: materialized.inputSchema,
        ...(materialized.outputSchema === undefined
          ? {}
          : {output_schema: materialized.outputSchema}),
        ...(result.value === undefined ? {} : {with: result.value}),
        ...(params.step.outputMappings === undefined
          ? {}
          : {output_mappings: params.step.outputMappings}),
      },
      outputs,
    },
    configPlan: result.plan === undefined ? undefined : {tool: {with: result.plan}},
    hasTemplates: tree !== undefined,
    diagnostics: [],
    trace: [],
    materialized,
  };
}

function resolveWith(params: {
  value: unknown;
  tree: WorkflowJsonTemplateTree;
  context: WorkflowEvaluationContext;
  definitionId: string;
}): {readonly value: unknown; readonly plan?: WorkflowJsonTemplateTree} {
  if (params.tree === undefined) return {value: params.value};
  if (isFieldTemplate(params.tree)) return resolveWithField(params);
  if (Array.isArray(params.tree)) return resolveWithArray(params);
  if (typeof params.tree === 'object' && params.tree !== null) {
    return resolveWithObject(params);
  }
  throw new Error('Invalid tool input template tree');
}

type ResolveWithParams = Parameters<typeof resolveWith>[0];
type ResolveWithResult = ReturnType<typeof resolveWith>;

function resolveWithField(params: ResolveWithParams): ResolveWithResult {
  const resolved = resolveStepFieldWithType({
    field: 'tool.with',
    template: {segments: params.tree as readonly ResolvedFieldSegment[]},
    context: params.context,
    definitionId: params.definitionId,
    errorField: 'tool.with',
  });
  if (resolved.kind === 'frozen') return {value: resolved.value};
  return {value: undefined, plan: params.tree};
}

function resolveWithArray(params: ResolveWithParams): ResolveWithResult {
  const values = Array.isArray(params.value) ? [...params.value] : [];
  const plans: (WorkflowJsonTemplateTree | undefined)[] = [];
  let hasPlan = false;
  (params.tree as readonly (WorkflowJsonTemplateTree | undefined)[]).forEach((child, index) => {
    if (child === undefined) return;
    const resolved = resolveWith({...params, value: values[index], tree: child});
    values[index] = resolved.value;
    plans[index] = resolved.plan;
    hasPlan ||= resolved.plan !== undefined;
  });
  return {value: values, ...(hasPlan ? {plan: plans} : {})};
}

function resolveWithObject(params: ResolveWithParams): ResolveWithResult {
  const source = objectWithValue(params.value);
  const values: Record<string, unknown> = {...source};
  const plans: Record<string, WorkflowJsonTemplateTree | undefined> = {};
  let hasPlan = false;
  for (const [key, child] of Object.entries(
    params.tree as Record<string, WorkflowJsonTemplateTree>,
  )) {
    if (child === undefined) continue;
    const resolved = resolveWith({...params, value: source[key], tree: child});
    if (resolved.value !== undefined) values[key] = resolved.value;
    if (resolved.plan === undefined) continue;
    // A nested object/array can contain both frozen values and a residual
    // field. Drop only an unresolved leaf; retaining a partially resolved
    // container preserves its static siblings for dispatch-time merging.
    if (resolved.value === undefined) delete values[key];
    plans[key] = resolved.plan;
    hasPlan = true;
  }
  return {value: values, ...(hasPlan ? {plan: plans} : {})};
}

function objectWithValue(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function isFieldTemplate(
  value: WorkflowJsonTemplateTree,
): value is readonly ResolvedFieldSegment[] {
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
