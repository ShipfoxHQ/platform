import type {JobStatus} from './entities/job.js';
import type {WorkflowRunStatus} from './entities/workflow-run.js';

export class DefinitionNotFoundError extends Error {
  constructor(definitionId: string) {
    super(`Definition not found: ${definitionId}`);
    this.name = 'DefinitionNotFoundError';
  }
}

export class ProjectMismatchError extends Error {
  constructor(definitionProjectId: string, requestProjectId: string) {
    super(
      `Definition belongs to project ${definitionProjectId}, but request targets project ${requestProjectId}`,
    );
    this.name = 'ProjectMismatchError';
  }
}

export class WorkspaceSuspendedError extends Error {
  constructor(readonly workspaceId: string) {
    super(`Workspace is suspended: ${workspaceId}`);
    this.name = 'WorkspaceSuspendedError';
  }
}

export class WorkspaceDeletedError extends Error {
  constructor(readonly workspaceId: string) {
    super(`Workspace is deleted: ${workspaceId}`);
    this.name = 'WorkspaceDeletedError';
  }
}

export class WorkspaceNotFoundError extends Error {
  constructor(readonly workspaceId: string) {
    super(`Workspace not found: ${workspaceId}`);
    this.name = 'WorkspaceNotFoundError';
  }
}

export class AgentConfigUnresolvableError extends Error {
  constructor(
    readonly definitionId: string,
    options?: ErrorOptions | undefined,
  ) {
    super(`Agent configuration cannot be resolved for definition ${definitionId}`, options);
    this.name = 'AgentConfigUnresolvableError';
  }
}

export class AgentIntegrationMaterializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentIntegrationMaterializationError';
  }
}

export type InterpolationUnresolvableField =
  | 'run'
  | 'env'
  | 'agent.prompt'
  | 'agent.model'
  | 'agent.provider'
  | 'agent.thinking'
  | 'job.runner'
  | 'job.outputs'
  | 'job.execution_name'
  | 'workflow.run_name'
  | 'step.name'
  | 'step.working_directory'
  | 'step.feedback'
  | 'checkout.project'
  | 'checkout.connection'
  | 'checkout.repository'
  | 'checkout.ref'
  | 'checkout.path';

export class InterpolationUnresolvableError extends Error {
  readonly field: InterpolationUnresolvableField;
  readonly source: string;
  readonly envKey?: string;

  constructor(
    readonly definitionId: string,
    params: {
      readonly field: InterpolationUnresolvableField;
      readonly source: string;
      readonly envKey?: string;
      readonly cause?: unknown;
    },
  ) {
    super(interpolationUnresolvableMessage(definitionId, params), {cause: params.cause});
    this.name = 'InterpolationUnresolvableError';
    this.field = params.field;
    this.source = params.source;
    if (params.envKey !== undefined) this.envKey = params.envKey;
  }
}

function interpolationUnresolvableMessage(
  definitionId: string,
  params: {
    readonly field: InterpolationUnresolvableField;
    readonly source: string;
    readonly envKey?: string;
  },
): string {
  const envSuffix = params.envKey === undefined ? '' : ` (${params.envKey})`;
  return `Workflow interpolation cannot be resolved for definition ${definitionId}: ${params.field}${envSuffix} uses \`${params.source}\`. Use has(x) ? x : '' for optional references.`;
}

/**
 * True when a `runWorkflow` failure can never succeed on retry: the definition is gone or
 * the subscription points at the wrong project. Callers (e.g. the trigger dispatcher) use this
 * to skip a permanently-broken target instead of retrying it forever. Every other failure is
 * treated as transient so at-least-once delivery can converge.
 */
export function isPermanentRunWorkflowError(error: unknown): boolean {
  return (
    error instanceof DefinitionNotFoundError ||
    error instanceof ProjectMismatchError ||
    error instanceof AgentConfigUnresolvableError ||
    error instanceof AgentIntegrationMaterializationError ||
    error instanceof InterpolationUnresolvableError ||
    error instanceof InvalidJobRunnerLabelsError
  );
}

export class JobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`Job not found or has no steps: ${jobId}`);
    this.name = 'JobNotFoundError';
  }
}

export class InvalidJobRunnerLabelsError extends Error {
  constructor(
    readonly labels: readonly string[],
    readonly requestedLabels: readonly string[] = labels,
  ) {
    const requestedSuffix =
      requestedLabels.join(', ') === labels.join(', ')
        ? ''
        : ` (requested: ${requestedLabels.join(', ')})`;
    super(`Job runner labels are invalid: ${labels.join(', ')}${requestedSuffix}`);
    this.name = 'InvalidJobRunnerLabelsError';
  }
}

export class JobOutputTooLargeError extends Error {
  readonly overshootBytes: number;

  constructor(
    readonly outputKey: string,
    readonly limitBytes: number,
    readonly measuredBytes: number,
    readonly scope: 'value' | 'total',
  ) {
    const overshootBytes = measuredBytes - limitBytes;
    super(
      scope === 'total'
        ? `Job outputs exceed the total size limit of ${limitBytes} bytes at "${outputKey}" ` +
            `(measured ${measuredBytes} bytes; overshoot ${overshootBytes} bytes).`
        : `Job output "${outputKey}" exceeds the per-value size limit of ${limitBytes} bytes ` +
            `(measured ${measuredBytes} bytes; overshoot ${overshootBytes} bytes).`,
    );
    this.name = 'JobOutputTooLargeError';
    this.overshootBytes = overshootBytes;
  }
}

export class JobOutputTooManyEntriesError extends Error {
  constructor(
    readonly entryCount: number,
    readonly limitEntries: number,
  ) {
    super(`Job outputs cannot define more than ${limitEntries} entries (found ${entryCount})`);
    this.name = 'JobOutputTooManyEntriesError';
  }
}

export class JobOutputNotJsonSafeError extends Error {
  constructor(
    readonly outputKey: string,
    readonly reason: string,
  ) {
    super(`Job output "${outputKey}" cannot be persisted as JSON: ${reason}`);
    this.name = 'JobOutputNotJsonSafeError';
  }
}

// The job named by a lease is terminal, so it must not exchange its lease for
// fresh checkout credentials. Server state is the final gate, not the token.
export class JobNotActiveError extends Error {
  constructor(
    readonly jobId: string,
    readonly status: JobStatus,
  ) {
    super(`Job ${jobId} is ${status} and cannot mint checkout credentials`);
    this.name = 'JobNotActiveError';
  }
}

export class WorkflowRunNotFoundError extends Error {
  constructor(workflowRunId: string) {
    super(`Workflow run not found: ${workflowRunId}`);
    this.name = 'WorkflowRunNotFoundError';
  }
}

export class WorkflowRunNotCancellableError extends Error {
  constructor(
    readonly workflowRunId: string,
    readonly status: WorkflowRunStatus,
  ) {
    super(`Workflow run ${workflowRunId} is ${status} and cannot be cancelled`);
    this.name = 'WorkflowRunNotCancellableError';
  }
}

export class SourceRunNotFoundError extends Error {
  constructor(workflowRunId: string) {
    super(`Source workflow run not found: ${workflowRunId}`);
    this.name = 'SourceRunNotFoundError';
  }
}

export class RunNotTerminalError extends Error {
  constructor(workflowRunId: string) {
    super(`Workflow run is not terminal: ${workflowRunId}`);
    this.name = 'RunNotTerminalError';
  }
}

export class NoFailedJobsError extends Error {
  constructor(workflowRunId: string) {
    super(`Workflow run has no failed or cancelled jobs to re-run: ${workflowRunId}`);
    this.name = 'NoFailedJobsError';
  }
}

// The checkout target cannot be resolved, so there is nothing to check out.
export class CheckoutIntentUnresolvedError extends Error {
  constructor(target: {kind: 'project' | 'connection'; value: string}) {
    super(`Checkout intent unresolved: ${target.kind} ${target.value} not found`);
    this.name = 'CheckoutIntentUnresolvedError';
  }
}

export class CheckoutConfigInvalidError extends Error {
  constructor(readonly stepId: string) {
    super(`Checkout config is invalid for step ${stepId}`);
    this.name = 'CheckoutConfigInvalidError';
  }
}

export class StepNotFoundError extends Error {
  constructor(stepId: string, jobId: string) {
    super(`Step ${stepId} not found in job ${jobId}`);
    this.name = 'StepNotFoundError';
  }
}

export class StepNotRunningError extends Error {
  constructor(stepId: string, jobId: string) {
    super(`Step ${stepId} in job ${jobId} is not running and cannot accept a result`);
    this.name = 'StepNotRunningError';
  }
}

// A report whose attempt is ahead of the step's current attempt. The host
// allocates attempt numbers, so a runner can never report one it was not
// dispatched: this is a protocol error, not an idempotent no-op.
export class StepAttemptAheadError extends Error {
  constructor(
    readonly stepId: string,
    readonly jobId: string,
    readonly reportedAttempt: number,
    readonly currentAttempt: number,
  ) {
    super(
      `Step ${stepId} in job ${jobId} reported attempt ${reportedAttempt} ahead of current attempt ${currentAttempt}`,
    );
    this.name = 'StepAttemptAheadError';
  }
}
