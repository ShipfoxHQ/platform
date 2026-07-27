import {
  evaluateWorkflowExpression,
  type WorkflowExpressionEvaluationContext,
  WorkflowExpressionEvaluationError,
} from '../evaluator/index.js';
import {coerceWorkflowValueToString} from '../resolver/coerce-workflow-value-to-string.js';
import {WorkflowTemplateResolutionError} from '../resolver/errors.js';
import {
  type AvailabilitySite,
  resolveContextRootAvailability,
  type WorkflowInterpolationFailurePolicy,
} from '../workflow-context/workflow-context.js';
import {type EvaluationTraceEntry, evaluationTraceEntry} from './evaluation-trace.js';
import {shouldFillAtSite} from './fill.js';
import type {
  ResolvedField,
  ResolvedFieldDeferredSegment,
  ResolvedFieldSegment,
} from './resolved-field.js';

export type WorkflowTemplateFailurePolicy = WorkflowInterpolationFailurePolicy;

export interface WorkflowTemplateDiagnostic {
  readonly reason: 'missing-path';
  readonly expression: string;
  readonly contextRoots: readonly string[];
}

export interface FrozenResolvedField<Value = string> {
  readonly value: Value;
  readonly diagnostics: readonly WorkflowTemplateDiagnostic[];
  readonly trace: readonly EvaluationTraceEntry[];
}

export type SiteResolvedField<Value = string> =
  | {
      readonly kind: 'frozen';
      readonly value: Value;
      readonly diagnostics: readonly WorkflowTemplateDiagnostic[];
      readonly trace: readonly EvaluationTraceEntry[];
    }
  | {
      readonly kind: 'residual';
      readonly field: ResolvedField;
      readonly diagnostics: readonly WorkflowTemplateDiagnostic[];
      readonly trace: readonly EvaluationTraceEntry[];
    };

interface ResolveFieldAtSiteParams {
  readonly field: ResolvedField;
  readonly failurePolicy: WorkflowInterpolationFailurePolicy;
  readonly site: AvailabilitySite;
  readonly context: WorkflowExpressionEvaluationContext;
  /** Preserve the value of an exact single expression instead of stringifying it. */
  readonly preserveSingleExpressionType?: boolean;
}

/**
 * Segment lifecycle:
 *
 * `{expr}` -> plan -> `{deferred, fillTarget}` -> freeze at a site at or after
 * `fillTarget` -> `{literal}`. Runner-fill segments are never filled server-side.
 *
 * Value fields follow their declared policy at their fill target. Predicates use
 * the planned predicate entry point and fail closed when evaluation is deferred.
 */
export function freezeResolvedFieldAtSite(
  params: ResolveFieldAtSiteParams & {readonly preserveSingleExpressionType: true},
): FrozenResolvedField<unknown>;
export function freezeResolvedFieldAtSite(
  params: ResolveFieldAtSiteParams & {readonly preserveSingleExpressionType?: false},
): FrozenResolvedField;
export function freezeResolvedFieldAtSite(
  params: ResolveFieldAtSiteParams,
): FrozenResolvedField<unknown>;
export function freezeResolvedFieldAtSite(
  params: ResolveFieldAtSiteParams,
): FrozenResolvedField<unknown> {
  let value = '';
  let typedValue: unknown;
  let hasTypedValue = false;
  const diagnostics: WorkflowTemplateDiagnostic[] = [];
  const trace: EvaluationTraceEntry[] = [];
  const preserveSingleExpressionType = isExactSingleExpressionField(params);

  for (const segment of params.field.segments) {
    if (segment.kind === 'literal') {
      value += segment.value;
      continue;
    }

    if (!shouldFillAtSite(segment.fillTarget, params.site)) {
      if (exactTypedFieldRequiresFailure(params, segment)) {
        throw typedFieldNotFillableAtSite(segment);
      }
      diagnostics.push(missingPathDiagnostic(segment));
      continue;
    }

    const evaluated = evaluateFillableSegment(params, segment);
    trace.push(evaluated.trace);
    if (evaluated.kind === 'degraded') {
      diagnostics.push(evaluated.diagnostic);
      continue;
    }

    if (preserveSingleExpressionType) {
      typedValue = evaluated.value;
      hasTypedValue = true;
    } else {
      value += evaluated.literal;
    }
  }

  return {
    value: preserveSingleExpressionType && hasTypedValue ? typedValue : value,
    diagnostics,
    trace,
  };
}

export function resolveFieldAtSite(
  params: ResolveFieldAtSiteParams & {readonly preserveSingleExpressionType: true},
): SiteResolvedField<unknown>;
export function resolveFieldAtSite(
  params: ResolveFieldAtSiteParams & {readonly preserveSingleExpressionType?: false},
): SiteResolvedField;
export function resolveFieldAtSite(params: ResolveFieldAtSiteParams): SiteResolvedField<unknown>;
export function resolveFieldAtSite(params: ResolveFieldAtSiteParams): SiteResolvedField<unknown> {
  let value = '';
  let typedValue: unknown;
  let hasTypedValue = false;
  const diagnostics: WorkflowTemplateDiagnostic[] = [];
  const trace: EvaluationTraceEntry[] = [];
  const segments: ResolvedFieldSegment[] = [];
  let hasResidual = false;
  const preserveSingleExpressionType = isExactSingleExpressionField(params);

  for (const segment of params.field.segments) {
    if (segment.kind === 'literal') {
      value += segment.value;
      segments.push(segment);
      continue;
    }

    if (!shouldFillAtSite(segment.fillTarget, params.site)) {
      hasResidual = true;
      segments.push(segment);
      continue;
    }

    const evaluated = evaluateFillableSegment(params, segment);
    trace.push(evaluated.trace);
    if (evaluated.kind === 'degraded') {
      diagnostics.push(evaluated.diagnostic);
      segments.push({kind: 'literal', value: ''});
      continue;
    }

    if (preserveSingleExpressionType) {
      typedValue = evaluated.value;
      hasTypedValue = true;
    } else {
      value += evaluated.literal;
    }
    segments.push({kind: 'literal', value: evaluated.literal});
  }

  if (hasResidual) return {kind: 'residual', field: {segments}, diagnostics, trace};
  return {
    kind: 'frozen',
    value: preserveSingleExpressionType && hasTypedValue ? typedValue : value,
    diagnostics,
    trace,
  };
}

function isExactSingleExpressionField(params: ResolveFieldAtSiteParams): boolean {
  return (
    params.preserveSingleExpressionType === true &&
    params.field.segments.length === 1 &&
    params.field.segments[0]?.kind === 'deferred'
  );
}

type FilledFieldSegment =
  | {
      readonly kind: 'evaluated';
      readonly value: unknown;
      readonly literal: string;
      readonly trace: EvaluationTraceEntry;
    }
  | {
      readonly kind: 'degraded';
      readonly diagnostic: WorkflowTemplateDiagnostic;
      readonly trace: EvaluationTraceEntry;
    };

function evaluateFillableSegment(
  params: ResolveFieldAtSiteParams,
  segment: ResolvedFieldDeferredSegment,
): FilledFieldSegment {
  try {
    const value = evaluateWorkflowExpression(segment.expression, params.context);
    const literal = coerceWorkflowValueToString(value);
    return {
      kind: 'evaluated',
      value,
      literal,
      trace: fillTraceEntry(segment, params.site, literal),
    };
  } catch (error) {
    if (error instanceof WorkflowExpressionEvaluationError && error.reason === 'missing-path') {
      if (fieldMissingPathRequiresFailure(params, segment)) {
        throw new WorkflowTemplateResolutionError({
          source: segment.expression.source,
          cause: error,
        });
      }

      return {
        kind: 'degraded',
        diagnostic: missingPathDiagnostic(segment),
        trace: fillTraceEntry(segment, params.site, '', true),
      };
    }

    throw new WorkflowTemplateResolutionError({
      source: segment.expression.source,
      cause: error,
    });
  }
}

function fillTraceEntry(
  segment: ResolvedFieldDeferredSegment,
  site: AvailabilitySite,
  value: string,
  degraded = false,
): EvaluationTraceEntry {
  return evaluationTraceEntry({
    expression: segment.expression.source,
    roots: segment.roots,
    fillTarget: segment.fillTarget,
    evaluatedAt: site,
    value,
    ...(degraded ? {degraded: true} : {}),
  });
}

function fieldMissingPathRequiresFailure(
  params: ResolveFieldAtSiteParams,
  segment: ResolvedFieldDeferredSegment,
): boolean {
  return (
    (isExactSingleExpressionField(params) && params.failurePolicy === 'fail') ||
    missingPathRequiresFailure(segment, params.failurePolicy, params.site)
  );
}

function exactTypedFieldRequiresFailure(
  params: ResolveFieldAtSiteParams,
  segment: ResolvedFieldDeferredSegment,
): boolean {
  return (
    isExactSingleExpressionField(params) &&
    params.failurePolicy === 'fail' &&
    segment.fillTarget !== 'runner-fill'
  );
}

function typedFieldNotFillableAtSite(
  segment: ResolvedFieldDeferredSegment,
): WorkflowTemplateResolutionError {
  return new WorkflowTemplateResolutionError({
    source: segment.expression.source,
    cause: new Error('Typed field is not fillable at this site.'),
  });
}

function missingPathDiagnostic(segment: ResolvedFieldDeferredSegment): WorkflowTemplateDiagnostic {
  return {
    reason: 'missing-path',
    expression: segment.expression.source,
    contextRoots: segment.roots,
  };
}

function missingPathRequiresFailure(
  segment: ResolvedFieldDeferredSegment,
  failurePolicy: WorkflowInterpolationFailurePolicy,
  site: AvailabilitySite,
): boolean {
  if (failurePolicy !== 'fail') return false;
  const rootAvailabilities = segment.roots.flatMap((root) => {
    const availability = resolveContextRootAvailability(root);
    return availability === undefined ? [] : [availability];
  });
  return (
    rootAvailabilities.length > 0 &&
    rootAvailabilities.every((availability) => shouldFillAtSite(availability, site))
  );
}
