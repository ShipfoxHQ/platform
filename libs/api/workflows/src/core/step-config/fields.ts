import {
  type EvaluationTraceEntry,
  freezeResolvedFieldAtSite,
  getWorkflowInterpolationFieldFailurePolicy,
  type ResolvedField,
  resolveFieldAtSite,
  type SiteResolvedField,
  type UnsafeRunInterpolationError,
  type WorkflowInterpolationField,
  type WorkflowTemplateDiagnostic,
  WorkflowTemplateResolutionError,
} from '@shipfox/expression';
import {InterpolationUnresolvableError, type InterpolationUnresolvableField} from '#core/errors.js';
import type {WorkflowEvaluationContext} from './workflow-evaluation-context.js';

export type StepConfigField = InterpolationUnresolvableField;

export interface WorkflowStepTemplateDiagnostic extends WorkflowTemplateDiagnostic {
  readonly field: StepConfigField;
  readonly envKey?: string;
}

export interface WorkflowStepEvaluationTraceEntry extends EvaluationTraceEntry {
  readonly field: StepConfigField;
  readonly envKey?: string;
}

export interface ResolveStepFieldParams {
  readonly field: WorkflowInterpolationField;
  readonly template: ResolvedField;
  readonly context: WorkflowEvaluationContext;
  readonly definitionId: string;
  readonly errorField: InterpolationUnresolvableField;
  readonly envKey?: string;
}

export function resolveStepField(params: ResolveStepFieldParams): SiteResolvedField {
  return resolveStepFieldAtSite(params, false);
}

export function resolveStepFieldWithType(
  params: ResolveStepFieldParams,
): SiteResolvedField<unknown> {
  return resolveStepFieldAtSite(params, true);
}

function resolveStepFieldAtSite(
  params: ResolveStepFieldParams,
  preserveSingleExpressionType: true,
): SiteResolvedField<unknown>;
function resolveStepFieldAtSite(
  params: ResolveStepFieldParams,
  preserveSingleExpressionType: false,
): SiteResolvedField;
function resolveStepFieldAtSite(
  params: ResolveStepFieldParams,
  preserveSingleExpressionType: boolean,
): SiteResolvedField<unknown> {
  try {
    const resolveParams = {
      field: params.template,
      context: params.context.values,
      site: params.context.site,
      failurePolicy: getWorkflowInterpolationFieldFailurePolicy(params.field),
    };
    return preserveSingleExpressionType
      ? resolveFieldAtSite({...resolveParams, preserveSingleExpressionType: true})
      : resolveFieldAtSite(resolveParams);
  } catch (error) {
    if (error instanceof WorkflowTemplateResolutionError) {
      throw stepConfigInterpolationError(params, error);
    }
    throw error;
  }
}

export function freezeStepField(params: ResolveStepFieldParams): {
  readonly value: string;
  readonly diagnostics: SiteResolvedField['diagnostics'];
  readonly trace: SiteResolvedField['trace'];
} {
  try {
    return freezeResolvedFieldAtSite({
      field: params.template,
      context: params.context.values,
      site: params.context.site,
      failurePolicy: getWorkflowInterpolationFieldFailurePolicy(params.field),
    });
  } catch (error) {
    if (error instanceof WorkflowTemplateResolutionError) {
      throw stepConfigInterpolationError(params, error);
    }
    throw error;
  }
}

export function completeStepField(params: ResolveStepFieldParams): string {
  return completeStepFieldWithTrace(params).value;
}

export function completeStepFieldWithType(params: ResolveStepFieldParams): unknown {
  return completeStepFieldWithTypeAndTrace(params).value;
}

export function completeStepFieldWithTrace(params: ResolveStepFieldParams): {
  readonly value: string;
  readonly trace: SiteResolvedField['trace'];
} {
  return completeResolvedStepField(params, resolveStepField(params));
}

export function completeStepFieldWithTypeAndTrace(params: ResolveStepFieldParams): {
  readonly value: unknown;
  readonly trace: SiteResolvedField<unknown>['trace'];
} {
  return completeResolvedStepField(params, resolveStepFieldWithType(params));
}

function completeResolvedStepField<Value>(
  params: ResolveStepFieldParams,
  resolved: SiteResolvedField<Value>,
): {readonly value: Value; readonly trace: SiteResolvedField<Value>['trace']} {
  if (resolved.kind === 'frozen') return {value: resolved.value, trace: resolved.trace};

  const source = resolved.field.segments.find((segment) => segment.kind === 'deferred')?.expression
    .source;
  throw new InterpolationUnresolvableError(params.definitionId, {
    field: params.errorField,
    source: source ?? params.field,
    ...(params.envKey === undefined ? {} : {envKey: params.envKey}),
  });
}

export function stepConfigInterpolationError(
  params: {
    readonly definitionId: string;
    readonly errorField: InterpolationUnresolvableField;
    readonly envKey?: string;
  },
  error: WorkflowTemplateResolutionError | UnsafeRunInterpolationError,
): InterpolationUnresolvableError {
  return new InterpolationUnresolvableError(params.definitionId, {
    field: params.errorField,
    source: error.source,
    ...(params.envKey === undefined ? {} : {envKey: params.envKey}),
    cause: error,
  });
}

export function literalField(value: string): ResolvedField {
  return {segments: [{kind: 'literal', value}]};
}
