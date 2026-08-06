import type {EvaluationTraceDto, EvaluationTraceEntryDto} from '@shipfox/api-workflows-dto';
import type {PersistedEvaluationTraceEntry} from '#core/entities/step.js';

export function toEvaluationTraceDto(
  trace: readonly PersistedEvaluationTraceEntry[] | null | undefined,
): EvaluationTraceDto | null {
  if (trace === null || trace === undefined) return null;
  return trace.map(toEvaluationTraceEntryDto);
}

function toEvaluationTraceEntryDto(entry: PersistedEvaluationTraceEntry): EvaluationTraceEntryDto {
  if ('dropped' in entry) return {truncated: true, dropped: entry.dropped};

  return {
    expression: entry.expression,
    roots: [...entry.roots],
    fill_target: entry.fillTarget,
    evaluated_at: entry.evaluatedAt,
    field: entry.field,
    ...(entry.value === undefined ? {} : {value: entry.value}),
    ...(entry.truncated === undefined ? {} : {truncated: entry.truncated}),
    ...(entry.exprTruncated === undefined ? {} : {expr_truncated: entry.exprTruncated}),
    ...(entry.reference === undefined ? {} : {reference: entry.reference}),
    ...(entry.degraded === undefined ? {} : {degraded: entry.degraded}),
    ...(entry.envKey === undefined ? {} : {env_key: entry.envKey}),
  };
}
