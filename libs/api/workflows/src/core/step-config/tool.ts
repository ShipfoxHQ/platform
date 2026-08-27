import type {WorkflowJsonTemplateTree, WorkflowModel} from '@shipfox/api-definitions-dto';
import type {OutputTypeDeclaration, ResolvedFieldSegment} from '@shipfox/expression';
import type {
  AgentToolMaterializationContext,
  AgentToolMaterializationSnapshot,
  MaterializedToolStep,
} from '#core/agent-tools.js';
import {materializeToolStep} from '#core/agent-tools.js';
import type {StepConfigDispatchPlan} from '#core/entities/step.js';
import {resolveStepField} from './fields.js';
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
  if (isFieldTemplate(params.tree)) {
    const resolved = resolveStepField({
      field: 'tool.with',
      template: {segments: params.tree},
      context: params.context,
      definitionId: params.definitionId,
      errorField: 'tool.with',
    });
    return resolved.kind === 'frozen'
      ? {value: resolved.value}
      : {value: undefined, plan: params.tree};
  }
  if (Array.isArray(params.tree)) {
    const values = Array.isArray(params.value) ? [...params.value] : [];
    const plans: (WorkflowJsonTemplateTree | undefined)[] = [];
    let hasPlan = false;
    params.tree.forEach((child, index) => {
      if (child === undefined) return;
      const resolved = resolveWith({
        value: values[index],
        tree: child,
        context: params.context,
        definitionId: params.definitionId,
      });
      values[index] = resolved.value;
      plans[index] = resolved.plan;
      hasPlan ||= resolved.plan !== undefined;
    });
    return {value: values, ...(hasPlan ? {plan: plans} : {})};
  }
  if (typeof params.tree === 'object' && params.tree !== null) {
    const source =
      params.value !== null && typeof params.value === 'object' && !Array.isArray(params.value)
        ? (params.value as Record<string, unknown>)
        : {};
    const values: Record<string, unknown> = {...source};
    const plans: Record<string, WorkflowJsonTemplateTree | undefined> = {};
    let hasPlan = false;
    for (const [key, child] of Object.entries(params.tree)) {
      if (child === undefined) continue;
      const resolved = resolveWith({
        value: source[key],
        tree: child,
        context: params.context,
        definitionId: params.definitionId,
      });
      if (resolved.value !== undefined) values[key] = resolved.value;
      if (resolved.plan !== undefined) {
        delete values[key];
        plans[key] = resolved.plan;
        hasPlan = true;
      }
    }
    return {value: values, ...(hasPlan ? {plan: plans} : {})};
  }
  throw new Error('Invalid tool input template tree');
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
