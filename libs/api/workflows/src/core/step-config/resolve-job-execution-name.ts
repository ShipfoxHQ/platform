import type {WorkflowModel} from '@shipfox/api-definitions-dto';
import {
  capTraceEntries,
  evaluationTraceEntry,
  getWorkflowInterpolationFieldFailurePolicy,
  resolveFieldAtSite,
  type WorkflowExpressionEvaluationContext,
  WorkflowTemplateResolutionError,
} from '@shipfox/expression';
import type {PersistedEvaluationTraceEntry} from '#core/entities/step.js';

interface WorkflowModelJobName {
  readonly executionName?: WorkflowModel['jobs'][number]['executionName'] | undefined;
}

export interface ResolveJobExecutionNameParams {
  readonly definitionId: string;
  readonly job: WorkflowModelJobName;
  readonly context: WorkflowExpressionEvaluationContext;
}

export function resolveJobExecutionName(params: ResolveJobExecutionNameParams): {
  /** The resolved override to persist. The static fallback is deliberately not persisted. */
  readonly nameOverride: string | null;
  readonly trace: readonly PersistedEvaluationTraceEntry[];
} {
  if (params.job.executionName === undefined) return {nameOverride: null, trace: []};

  try {
    const resolved = resolveFieldAtSite({
      field: {segments: params.job.executionName},
      site: 'execution-creation',
      context: params.context,
      failurePolicy: getWorkflowInterpolationFieldFailurePolicy('job.execution_name'),
    });
    return {
      nameOverride: resolved.kind === 'frozen' && resolved.value !== '' ? resolved.value : null,
      trace: capTraceEntries(
        resolved.trace.map((entry) => ({...entry, field: 'job.execution_name'})),
      ),
    };
  } catch (error) {
    if (error instanceof WorkflowTemplateResolutionError) {
      const failedSegment = params.job.executionName.find(
        (segment) => segment.kind === 'deferred' && segment.expression.source === error.source,
      );
      const trace =
        failedSegment?.kind === 'deferred'
          ? [
              {
                ...evaluationTraceEntry({
                  expression: failedSegment.expression.source,
                  roots: failedSegment.roots,
                  fillTarget: failedSegment.fillTarget,
                  evaluatedAt: 'execution-creation',
                  degraded: true,
                }),
                field: 'job.execution_name',
              },
            ]
          : [];
      return {nameOverride: null, trace: capTraceEntries(trace)};
    }
    throw error;
  }
}
