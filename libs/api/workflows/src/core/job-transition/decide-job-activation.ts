import type {WorkflowExpression} from '@shipfox/expression';
import {evaluatePlannedPredicateAtSite} from '@shipfox/expression';
import {explicitConditionTrace} from '../condition-trace.js';
import {isJobTerminal, type Job, type JobStatusReason} from '../entities/job.js';
import type {WorkflowRun} from '../entities/workflow-run.js';
import {
  assembleJobActivationContext,
  type JobContextInput,
} from '../step-config/assemble-run-context.js';
import type {RuntimeCompletionStatus} from '../workflow-scheduling/runtime-dag.js';
import {runtimeCompletionStatusForJob} from './runtime-completion-status-for-job.js';

export type JobActivationDecision =
  | {
      kind: 'start-job';
      jobId: string;
    }
  | {
      kind: 'skip-job';
      jobId: string;
      status: 'skipped';
      statusReason: JobStatusReason;
      evaluationTrace: ReturnType<typeof explicitConditionTrace>;
    }
  | {
      kind: 'terminal-job';
      jobId: string;
      status: RuntimeCompletionStatus;
      jobVersion: number;
    };

export interface DecideJobActivationInput {
  run: WorkflowRun;
  job: Job;
  condition?: WorkflowExpression | undefined;
  dependencies: readonly JobContextInput[];
  vars?: Record<string, string> | undefined;
}

export function decideJobActivation(input: DecideJobActivationInput): JobActivationDecision {
  if (isJobTerminal(input.job.status)) {
    return {
      kind: 'terminal-job',
      jobId: input.job.id,
      status: runtimeCompletionStatusForJob(input.job.status),
      jobVersion: input.job.version,
    };
  }

  if (input.condition === undefined) return {kind: 'start-job', jobId: input.job.id};

  const context = assembleJobActivationContext({
    run: input.run,
    triggerPayload: input.run.triggerPayload,
    inputs: input.run.inputs,
    vars: input.vars,
    jobs: input.dependencies,
  });
  const outcome = evaluatePlannedPredicateAtSite({
    expression: input.condition,
    field: 'job.if',
    site: context.site,
    context: context.values,
  });
  if (outcome.value) return {kind: 'start-job', jobId: input.job.id};

  return {
    kind: 'skip-job',
    jobId: input.job.id,
    status: 'skipped',
    statusReason: outcome.evaluationFailed ? 'condition_errored' : 'condition_rejected',
    evaluationTrace: explicitConditionTrace({
      expression: input.condition,
      field: 'job.if',
      route: outcome.route,
      site: context.site,
      value: outcome.value,
      degraded: outcome.evaluationFailed,
    }),
  };
}
