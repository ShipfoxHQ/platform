import {DEFAULT_JOB_SUCCESS} from '@shipfox/api-definitions-dto';
import {
  capTraceEntries,
  createWorkflowExpression,
  evaluatePlannedPredicateAtSite,
  predicateTraceEntry,
} from '@shipfox/expression';
import type {JobStatusReason} from '../entities/job.js';
import type {JobExecution} from '../entities/job-execution.js';
import type {PersistedEvaluationTraceEntry} from '../entities/step.js';
import {
  assembleExecutionsContext,
  assembleJobsContext,
  type JobContextInput,
} from '../step-config/assemble-run-context.js';
import type {RuntimeCompletionStatus} from '../workflow-scheduling/runtime-dag.js';

export interface DeriveJobSuccessResult {
  status: RuntimeCompletionStatus;
  statusReason: JobStatusReason | null;
  trace: readonly PersistedEvaluationTraceEntry[];
}

export function deriveJobSuccess(params: {
  success: string | null;
  executions: readonly JobExecution[];
  jobs: readonly JobContextInput[];
  vars?: Record<string, string> | undefined;
}): DeriveJobSuccessResult {
  const expression = createWorkflowExpression({
    source: params.success ?? DEFAULT_JOB_SUCCESS,
    check: {mode: 'syntax'},
  });
  const context = {
    ...(params.vars === undefined ? {} : {vars: params.vars}),
    ...assembleExecutionsContext(params.executions),
    ...assembleJobsContext(params.jobs),
  };
  const outcome = evaluatePlannedPredicateAtSite({
    expression,
    field: 'job.success',
    site: 'job-resolution',
    context,
  });
  const trace = capTraceEntries([
    {
      ...predicateTraceEntry({
        expression: expression.source,
        route: outcome.route,
        site: 'job-resolution',
        value: outcome.value,
        degraded: outcome.evaluationFailed,
      }),
      field: 'job.success',
    },
  ]);
  const passed = outcome.value;
  const status: RuntimeCompletionStatus = passed ? 'succeeded' : 'failed';
  if (status === 'succeeded') return {status, statusReason: null, trace};

  return {
    status,
    statusReason: outcome.evaluationFailed
      ? 'unknown'
      : (params.executions.find((execution) => execution.statusReason)?.statusReason ??
        'step_failed'),
    trace,
  };
}
