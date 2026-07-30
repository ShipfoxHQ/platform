import type {WorkflowModel} from '@shipfox/api-definitions-dto';
import {
  capTraceEntries,
  getWorkflowInterpolationFieldFailurePolicy,
  type ResolvedFieldSegment,
  resolveFieldAtSite,
  type WorkflowExpressionEvaluationContext,
  WorkflowTemplateResolutionError,
} from '@shipfox/expression';
import type {PersistedEvaluationTraceEntry} from '#core/entities/step.js';

const DISALLOWED_DISPLAY_CHARACTER_RE = /[\p{Cc}\p{Cf}]/gu;
const MAX_WORKFLOW_RUN_NAME_LENGTH = 255;

export type WorkflowRunNameResolutionCause =
  | 'missing_value'
  | 'evaluation_error'
  | 'empty_value'
  | 'sanitization';

export interface WorkflowRunNameDegradation {
  readonly cause: WorkflowRunNameResolutionCause;
  readonly expression?: string | undefined;
}

export interface ResolveWorkflowRunNameResult {
  readonly value: string | null;
  readonly trace: readonly PersistedEvaluationTraceEntry[];
  readonly degradation?: WorkflowRunNameDegradation | undefined;
}

export function resolveWorkflowRunName(params: {
  readonly runName: WorkflowModel['runName'];
  readonly context: WorkflowExpressionEvaluationContext;
}): ResolveWorkflowRunNameResult {
  if (params.runName === undefined) return {value: null, trace: []};

  try {
    const resolved = resolveFieldAtSite({
      field: {segments: params.runName},
      site: 'run-creation',
      context: params.context,
      failurePolicy: getWorkflowInterpolationFieldFailurePolicy('workflow.run_name'),
    });
    const trace = capTraceEntries(
      resolved.trace.map((entry) => ({...entry, field: 'workflow.run_name'})),
    );

    if (resolved.kind !== 'frozen' || resolved.diagnostics.length > 0) {
      return degraded(trace, {
        cause: 'missing_value',
        expression: resolved.diagnostics[0]?.expression ?? firstExpressionSource(params.runName),
      });
    }

    if (resolved.value === '') {
      return degraded(trace, {
        cause: 'empty_value',
        expression: firstExpressionSource(params.runName),
      });
    }

    const sanitized = sanitizeWorkflowDisplayText(resolved.value);
    if (sanitized === '') {
      return degraded(trace, {
        cause: 'sanitization',
        expression: firstExpressionSource(params.runName),
      });
    }

    return {
      value: sanitized,
      trace,
      ...(sanitized === resolved.value
        ? {}
        : {
            degradation: {
              cause: 'sanitization' as const,
              expression: firstExpressionSource(params.runName),
            },
          }),
    };
  } catch (error) {
    return degraded([], {
      cause: 'evaluation_error',
      expression:
        error instanceof WorkflowTemplateResolutionError
          ? error.source
          : firstExpressionSource(params.runName),
    });
  }
}

export function sanitizeWorkflowDisplayText(value: string): string {
  return value
    .replace(DISALLOWED_DISPLAY_CHARACTER_RE, ' ')
    .trim()
    .slice(0, MAX_WORKFLOW_RUN_NAME_LENGTH);
}

function degraded(
  trace: readonly PersistedEvaluationTraceEntry[],
  degradation: WorkflowRunNameDegradation,
): ResolveWorkflowRunNameResult {
  return {value: null, trace, degradation};
}

function firstExpressionSource(template: readonly ResolvedFieldSegment[]): string | undefined {
  return template.find((segment) => segment.kind === 'deferred')?.expression.source;
}
