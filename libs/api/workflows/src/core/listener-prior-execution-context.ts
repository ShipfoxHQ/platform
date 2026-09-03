import type {WorkflowModel} from '@shipfox/api-definitions-dto';
import {
  extractExactContextRoots,
  type ResolvedFieldSegment,
  type WorkflowExpression,
} from '@shipfox/expression';

/**
 * Returns whether listener materialization or resolution needs event bodies from
 * prior executions. The default success predicate only reads execution status,
 * so it does not by itself require the event arrays.
 */
export function listenerPriorExecutionEventsRequired(params: {
  readonly model: WorkflowModel | null;
  readonly jobKey: string;
  readonly success?: string | null | undefined;
}): boolean {
  const job = params.model?.jobs.find((candidate) => candidate.key === params.jobKey);
  if (job === undefined) return true;

  const roots = new Set<string>();
  try {
    if (params.success !== undefined && params.success !== null) {
      addExpressionRoots(params.success, roots);
    }
    if (job.success !== undefined) addExpressionRoots(job.success, roots);
    collectExpressionRoots(params.model?.templates?.env, roots, new Set());
    collectExpressionRoots(job, roots, new Set());
  } catch {
    // A malformed or future model must keep the full context shape rather than
    // risk evaluating an expression against missing historical data.
    return true;
  }

  return roots.has('executions');
}

function collectExpressionRoots(value: unknown, roots: Set<string>, visited: Set<object>): void {
  if (value === null || typeof value !== 'object') return;
  if (isWorkflowExpression(value)) {
    addExpressionRoots(value.source, roots);
    return;
  }
  if (isDeferredSegment(value)) {
    for (const root of value.roots) roots.add(root);
    addExpressionRoots(value.expression.source, roots);
    return;
  }
  if (visited.has(value)) return;
  visited.add(value);

  if (Array.isArray(value)) {
    for (const child of value) collectExpressionRoots(child, roots, visited);
    return;
  }
  for (const child of Object.values(value)) collectExpressionRoots(child, roots, visited);
}

function addExpressionRoots(source: string, roots: Set<string>): void {
  for (const root of extractExactContextRoots(source)) roots.add(root);
}

function isWorkflowExpression(value: object): value is WorkflowExpression {
  const candidate = value as {language?: unknown; source?: unknown};
  return candidate.language === 'cel' && typeof candidate.source === 'string';
}

function isDeferredSegment(
  value: object,
): value is Extract<ResolvedFieldSegment, {kind: 'deferred'}> {
  const candidate = value as {
    kind?: unknown;
    expression?: unknown;
    roots?: unknown;
  };
  return (
    candidate.kind === 'deferred' &&
    candidate.expression !== null &&
    typeof candidate.expression === 'object' &&
    Array.isArray(candidate.roots)
  );
}
