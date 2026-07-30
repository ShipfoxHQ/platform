import {
  capTraceEntries,
  evaluatePlannedPredicateAtSite,
  predicateTraceEntry,
  type ResolvedField,
  type WorkflowExpression,
} from '@shipfox/expression';
import {assembleGateContext} from '../step-config/assemble-run-context.js';
import {completeStepField} from '../step-config/fields.js';
import type {GateOutcome, StepReport} from './decide-step-transition.js';

// The exact `uncheckable` reason recorded when the gate's CEL expression itself
// throws (as opposed to a missing exit code). The DTO mapper keys on this string to
// surface a distinct `evaluation_error` gate result, so the producer and the mapper
// must share this constant rather than duplicating the literal.
export const GATE_EVALUATION_ERROR_REASON = 'gate expression evaluation failed';

// The gate as parsed from a step's materialized `config.gate` (snake_case JSON).
export interface StepGate {
  success?: WorkflowExpression;
  onFailure?: {restartFrom: string; feedback?: string; feedbackTemplate?: ResolvedField};
}

// Read the gate persisted on a step's config by the materializer. Returns
// undefined when the step has no gate of interest.
export function readStepGate(config: Record<string, unknown>): StepGate | undefined {
  const gate = config.gate;
  if (!gate || typeof gate !== 'object') return undefined;
  const raw = gate as Record<string, unknown>;

  const successRaw = raw.success as Record<string, unknown> | undefined;
  const success =
    successRaw && typeof successRaw.source === 'string'
      ? // The model validated this expression before materialization; the stored
        // JSON is structurally a WorkflowExpression.
        (successRaw as unknown as WorkflowExpression)
      : undefined;

  const onFailureRaw = raw.on_failure as Record<string, unknown> | undefined;
  const feedbackTemplateRaw = onFailureRaw?.feedback_template as
    | Record<string, unknown>
    | undefined;
  const feedbackTemplate =
    Array.isArray(feedbackTemplateRaw?.segments) &&
    feedbackTemplateRaw.segments.every((segment) => typeof segment === 'object' && segment !== null)
      ? (feedbackTemplateRaw as unknown as ResolvedField)
      : undefined;
  const onFailure =
    onFailureRaw && typeof onFailureRaw.restart_from === 'string'
      ? {
          restartFrom: onFailureRaw.restart_from,
          ...(typeof onFailureRaw.feedback === 'string' ? {feedback: onFailureRaw.feedback} : {}),
          ...(feedbackTemplate === undefined ? {} : {feedbackTemplate}),
        }
      : undefined;

  if (!success && !onFailure) return undefined;
  return {
    ...(success ? {success} : {}),
    ...(onFailure ? {onFailure} : {}),
  };
}

/**
 * Gate evaluation fails closed: a missing exit code or CEL evaluation error is
 * `uncheckable` (a plain command failure), never a gate failure that can restart.
 *
 * Callers hold step-row locks while this runs. Keep the CEL context bounded
 * unless evaluation gets a budget outside the lock. The materializer only
 * persists CEL expressions, and this evaluator only needs the validated source.
 */
export function evaluateGate(
  gate: StepGate | undefined,
  result: StepReport,
  vars?: Record<string, string> | undefined,
): GateOutcome {
  if (!gate?.success) return {kind: 'no-gate'};
  const source = gate.success.source;

  if (result.exitCode === null || result.exitCode === undefined) {
    return {kind: 'uncheckable', reason: 'step produced no exit code'};
  }

  const context = assembleGateContext({
    status: result.status,
    exitCode: result.exitCode,
    output: result.output,
    vars,
  });
  const outcome = evaluatePlannedPredicateAtSite({
    expression: gate.success,
    field: 'step.success',
    site: context.site,
    context: context.values,
  });
  const trace = capTraceEntries([
    {
      ...predicateTraceEntry({
        expression: source,
        route: outcome.route,
        site: context.site,
        value: outcome.value,
        degraded: outcome.evaluationFailed,
      }),
      field: 'step.success',
    },
  ]);
  if (outcome.evaluationFailed) {
    return {kind: 'uncheckable', reason: GATE_EVALUATION_ERROR_REASON, source, trace};
  }
  return outcome.value ? {kind: 'passed', source, trace} : {kind: 'failed', source, trace};
}

export function evaluateGateFeedback(params: {
  readonly gate: StepGate;
  readonly result: StepReport;
  readonly definitionId: string;
  readonly vars?: Record<string, string> | undefined;
}): string {
  const feedbackTemplate = params.gate.onFailure?.feedbackTemplate;
  if (feedbackTemplate === undefined) {
    return params.gate.onFailure?.feedback ?? 'gate condition not met';
  }

  const context = assembleGateContext({
    status: params.result.status,
    exitCode: params.result.exitCode ?? null,
    output: params.result.output,
    vars: params.vars,
  });
  return completeStepField({
    field: 'step.feedback',
    errorField: 'step.feedback',
    template: feedbackTemplate,
    context,
    definitionId: params.definitionId,
  });
}

// Build the audit payload recorded on the step attempt for a gate evaluation.
// Includes the evaluated `exit_code` so the gate decision is reconstructable from
// the attempt row alone, independent of the column shape.
export function gateResultPayload(
  outcome: GateOutcome,
  exitCode: number | null | undefined,
): Record<string, unknown> | null {
  const exit_code = exitCode ?? null;
  switch (outcome.kind) {
    case 'no-gate':
      return null;
    case 'passed':
      return {
        passed: true,
        source: outcome.source,
        exit_code,
        ...(outcome.trace === undefined ? {} : {trace: outcome.trace}),
      };
    case 'failed':
      return {
        passed: false,
        source: outcome.source,
        exit_code,
        ...(outcome.trace === undefined ? {} : {trace: outcome.trace}),
      };
    case 'uncheckable':
      return {
        passed: false,
        uncheckable: true,
        reason: outcome.reason,
        exit_code,
        ...(outcome.source === undefined ? {} : {source: outcome.source}),
        ...(outcome.trace === undefined ? {} : {trace: outcome.trace}),
      };
  }
}
