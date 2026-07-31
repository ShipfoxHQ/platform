import {TriggerSourceIcon} from '@shipfox/client-triggers';
import {Badge} from '@shipfox/react-ui/badge';
import {Button} from '@shipfox/react-ui/button';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Icon} from '@shipfox/react-ui/icon';
import {RelativeTime} from '@shipfox/react-ui/relative-time';
import {useTimeTick} from '@shipfox/react-ui/time-ticker';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Text} from '@shipfox/react-ui/typography';
import type {ReactNode} from 'react';
import {Fragment, useId, useRef, useState} from 'react';
import {getWorkflowStatusVisual} from '#components/workflow-status/status-visuals.js';
import {
  AGENT_CONFIG_ISSUES,
  defaultJobExecution,
  deriveJobDisplayStatus,
  deriveJobExecutionDisplayStatus,
  type Job,
  type JobDisplayStatus,
  type JobExecution,
  type JobExecutionTime,
  STEP_ERROR_REASONS,
  type Step,
  type StepError,
  type StepSourceLocation,
  WORKFLOW_JOB_STATUSES,
  workflowRunTriggerDisplayLabel,
  workflowRunTriggerLabel,
} from '#core/workflow-run.js';
import {type StepExpandedContext, StepList, type StepListEmptyState} from '../step-list/index.js';
import {AgentConfigFailureCallout} from './agent-config-failure-callout.js';
import {JobExecutionSwitcher} from './job-execution-switcher.js';
import {formatJobExecutionTime, JobExecutionTimeText} from './job-execution-time-text.js';
import {StepAttemptLogPanel} from './step-attempt-log-panel.js';

const STATUS_BADGE_LABEL_WIDTH_CH = Math.max(
  ...[...WORKFLOW_JOB_STATUSES, 'listening' as const].map(
    (status) => getWorkflowStatusVisual(status).label.length,
  ),
);

interface LocalSelectedAttempt {
  jobExecutionId: string | undefined;
  attemptId: string | null;
}

export function JobCard({
  workspaceId,
  job,
  selectedJobExecution,
  selectedAttemptId,
  onSelectedJobExecutionChange,
  onSelectedAttemptChange,
  renderExpandedStep,
  sourcePanelId,
  sourceAvailable,
  focusedSourceStepId,
  onOpenStepSource,
}: {
  workspaceId: string;
  job: Job;
  selectedJobExecution: JobExecution | undefined;
  selectedAttemptId: string | null | undefined;
  onSelectedJobExecutionChange: ((jobExecutionId: string | undefined) => void) | undefined;
  onSelectedAttemptChange: ((attemptId: string | undefined) => void) | undefined;
  renderExpandedStep?: ((context: StepExpandedContext) => ReactNode) | undefined;
  sourcePanelId?: string | undefined;
  sourceAvailable?: boolean | undefined;
  focusedSourceStepId?: string | null | undefined;
  onOpenStepSource?:
    | ((stepId: string, location: StepSourceLocation, trigger: HTMLButtonElement | null) => void)
    | undefined;
}) {
  const titleId = useId();
  const sourceButtonRef = useRef<HTMLButtonElement>(null);
  const [localSelectedAttempt, setLocalSelectedAttempt] = useState<LocalSelectedAttempt>({
    jobExecutionId: undefined,
    attemptId: null,
  });
  const title = selectedJobExecution?.displayName ?? job.displayName;
  const isNonDefaultExecutionSelected =
    selectedJobExecution !== undefined && selectedJobExecution.id !== defaultJobExecution(job)?.id;
  const selectedExecutionStatus = isNonDefaultExecutionSelected
    ? deriveJobExecutionDisplayStatus(selectedJobExecution)
    : deriveJobDisplayStatus(job);
  const effectiveSelectedAttemptId =
    selectedAttemptId === undefined &&
    localSelectedAttempt.jobExecutionId === selectedJobExecution?.id
      ? localSelectedAttempt.attemptId
      : selectedAttemptId;
  const selectedSourceAction = selectedStepSourceAction(
    selectedJobExecution,
    effectiveSelectedAttemptId,
  );
  const defaultRenderExpandedStep = ({
    step,
    stepId,
    attempt,
    attemptError,
    attemptStatus,
    carriedOver,
  }: StepExpandedContext) =>
    carriedOver ? (
      <CarriedOverStepPanel />
    ) : (
      <StepAttemptDetailPanel
        workspaceId={workspaceId}
        step={step}
        stepId={stepId}
        attempt={attempt}
        attemptError={attemptError}
        attemptStatus={attemptStatus}
      />
    );

  function selectAttempt(attemptId: string | undefined) {
    if (selectedAttemptId === undefined) {
      setLocalSelectedAttempt({
        jobExecutionId: selectedJobExecution?.id,
        attemptId: attemptId ?? null,
      });
    }

    onSelectedAttemptChange?.(attemptId);
  }

  return (
    <section
      aria-labelledby={titleId}
      className="flex min-h-0 flex-col rounded-8 border border-border-neutral-base bg-background-components-base"
    >
      <div className="grid min-h-52 min-w-0 grid-cols-1 gap-y-4 px-16 py-12">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-10">
          {job.mode === 'listening' &&
          job.jobExecutions.length > 0 &&
          onSelectedJobExecutionChange ? (
            <>
              <Text as="h2" id={titleId} size="sm" bold className="sr-only">
                {title}
              </Text>
              <div className="flex min-w-0 items-center gap-8">
                <JobStatusBadge status={selectedExecutionStatus} />
                <JobExecutionSwitcher
                  job={job}
                  selectedJobExecution={selectedJobExecution?.id ?? null}
                  onSelectedJobExecutionChange={onSelectedJobExecutionChange}
                  variant="title"
                />
              </div>
            </>
          ) : (
            <div className="flex min-w-0 items-center gap-8">
              <JobStatusBadge status={selectedExecutionStatus} />
              <div className="flex min-w-0 items-center gap-8">
                <Text
                  as="h2"
                  id={titleId}
                  size="sm"
                  bold
                  className="min-w-0 truncate text-foreground-neutral-base"
                >
                  {title}
                </Text>
              </div>
            </div>
          )}
          {sourceAvailable && selectedSourceAction && sourcePanelId && onOpenStepSource ? (
            <div className="flex min-w-max items-center gap-6">
              <Button
                ref={sourceButtonRef}
                type="button"
                variant="secondary"
                size="xs"
                aria-controls={sourcePanelId}
                aria-expanded={focusedSourceStepId === selectedSourceAction.stepId}
                onClick={() =>
                  onOpenStepSource(
                    selectedSourceAction.stepId,
                    selectedSourceAction.location,
                    sourceButtonRef.current,
                  )
                }
              >
                View source
              </Button>
            </div>
          ) : null}
        </div>
        <JobExecutionMetadata execution={selectedJobExecution} />
      </div>
      <div className="min-h-0 border-t border-border-neutral-strong">
        {selectedJobExecution ? (
          <StepList
            job={job}
            jobExecution={selectedJobExecution}
            selectedAttemptId={selectedAttemptId}
            onSelectedAttemptChange={selectAttempt}
            autoSelectActiveAttempt
            emptyState={emptyStateForJob(job, selectedJobExecution)}
            showHeader={false}
            className="rounded-none border-0 bg-transparent"
            renderExpandedStep={renderExpandedStep ?? defaultRenderExpandedStep}
          />
        ) : (
          <JobExecutionEmptyState job={job} />
        )}
      </div>
    </section>
  );
}

function JobStatusBadge({status}: {status: JobDisplayStatus}) {
  const visual = getWorkflowStatusVisual(status);

  return (
    <Badge variant={visual.badge} size="xs">
      <span className="text-center" style={{width: `${STATUS_BADGE_LABEL_WIDTH_CH}ch`}}>
        {visual.label}
      </span>
    </Badge>
  );
}

function JobExecutionEmptyState({job}: {job: Job}) {
  const emptyState = emptyStateForMissingExecution(job);

  return (
    <EmptyState
      className="min-h-120 px-16 py-20"
      icon="componentLine"
      title={emptyState.title}
      description={emptyState.description}
      variant="compact"
    />
  );
}

function JobExecutionMetadata({execution}: {execution: JobExecution | undefined}) {
  if (!execution) return null;

  const queueTime = execution.queueTime;
  const runTime = execution.runTime;
  const executionStartedAt = execution.startedAt ?? execution.queuedAt ?? execution.createdAt;
  const items = [
    execution.triggerEvents.length > 0 ? {key: 'trigger', kind: 'trigger' as const} : null,
    {key: 'started', kind: 'started' as const, value: executionStartedAt},
    queueTime
      ? {key: 'queue', icon: 'hourglassLine' as const, kind: 'queue' as const, time: queueTime}
      : null,
    runTime ? {key: 'run', icon: 'timerLine' as const, kind: 'run' as const, time: runTime} : null,
  ].filter((item) => item !== null);

  if (items.length === 0) return null;

  return (
    <div className="flex min-w-0 items-center gap-12 overflow-hidden text-foreground-neutral-muted">
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {index > 0 ? <MetadataSeparator /> : null}
          {item.kind === 'started' ? (
            <RelativeTime
              value={item.value}
              className="shrink-0 whitespace-nowrap text-xs leading-20 text-foreground-neutral-muted"
            />
          ) : item.kind === 'trigger' ? (
            <JobExecutionTriggerMetadata execution={execution} />
          ) : (
            <JobExecutionMetadataItem
              icon={item.icon}
              kind={item.kind}
              time={item.time}
              displayStatus={deriveJobExecutionDisplayStatus(execution)}
            />
          )}
        </Fragment>
      ))}
    </div>
  );
}

function JobExecutionTriggerMetadata({execution}: {execution: JobExecution}) {
  const triggerEvent = execution.triggerEvents[0];
  if (!triggerEvent) return null;

  const triggerLabel = workflowRunTriggerLabel({
    triggerSource: triggerEvent.source,
    triggerEvent: triggerEvent.event,
  });
  const triggerDisplayLabel = workflowRunTriggerDisplayLabel({
    triggerSource: triggerEvent.source,
    triggerEvent: triggerEvent.event,
  });
  const triggerCount = execution.triggerEvents.length;
  const countLabel = triggerCount > 1 ? ` (${triggerCount})` : '';
  const tooltip = triggerCount > 1 ? `${triggerLabel} (${triggerCount} events)` : triggerLabel;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={tooltip}
          className="inline-flex min-w-0 max-w-full cursor-default items-center gap-4 rounded-4 border-0 bg-transparent p-0 text-left text-foreground-neutral-muted outline-none focus-visible:shadow-border-interactive-with-active"
        >
          <TriggerSourceIcon
            provider={triggerEvent.source}
            source={triggerEvent.source}
            aria-hidden="true"
            className="size-12 shrink-0"
          />
          <Text as="span" size="xs" className="min-w-0 truncate">
            {triggerDisplayLabel}
            {countLabel}
          </Text>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <Text as="span" size="xs" className="block max-w-[360px] break-words">
          {tooltip}
        </Text>
      </TooltipContent>
    </Tooltip>
  );
}

function JobExecutionMetadataItem({
  icon,
  kind,
  time,
  displayStatus,
}: {
  icon: 'hourglassLine' | 'timerLine';
  kind: 'queue' | 'run';
  time: JobExecutionTime;
  displayStatus: JobExecution['status'];
}) {
  useTimeTick();

  const tooltip = `${jobExecutionTimeVerb(kind, time, displayStatus)} for ${formatJobExecutionTime(time)}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={tooltip}
          className="inline-flex min-w-0 cursor-default items-center gap-4 rounded-4 border-0 bg-transparent p-0 text-foreground-neutral-muted outline-none focus-visible:shadow-border-interactive-with-active"
        >
          <Icon name={icon} className="size-12 shrink-0" aria-hidden="true" />
          <span className="shrink-0 text-xs leading-20 text-foreground-neutral-muted tabular-nums">
            <JobExecutionTimeText time={time} />
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <Text as="span" size="xs">
          {tooltip}
        </Text>
      </TooltipContent>
    </Tooltip>
  );
}

function jobExecutionTimeVerb(
  kind: 'queue' | 'run',
  time: JobExecutionTime,
  displayStatus: JobExecution['status'],
): string {
  if (kind === 'queue') return time.state === 'live' ? 'Queueing' : 'Queued';
  if (time.state !== 'live') return 'Ran';
  if (displayStatus === 'running') return 'Running';
  return displayStatus === 'pending' ? 'Runner assigned' : 'Execution elapsed';
}

function MetadataSeparator() {
  return <span aria-hidden="true" className="h-12 w-px shrink-0 bg-border-neutral-strong" />;
}

function selectedStepSourceAction(
  jobExecution: JobExecution | undefined,
  selectedAttemptId: string | null | undefined,
): {stepId: string; location: StepSourceLocation} | null {
  if (!jobExecution || !selectedAttemptId) return null;

  for (const step of jobExecution.steps) {
    const selected =
      selectedAttemptId === `carried-over:${step.id}` ||
      step.attempts.some((attempt) => attempt.id === selectedAttemptId);
    if (selected && step.sourceLocation) {
      return {stepId: step.id, location: step.sourceLocation};
    }
  }

  return null;
}

function StepAttemptDetailPanel({
  workspaceId,
  step,
  stepId,
  attempt,
  attemptError,
  attemptStatus,
}: {
  workspaceId: string;
  step: Step;
  stepId: string;
  attempt: number;
  attemptError: Record<string, unknown> | null;
  attemptStatus: string;
}) {
  const selectedAttemptError = toSelectedAttemptError(step, attemptError) ?? step.error;

  return (
    <div className="flex min-w-0 flex-col gap-10">
      {isAgentConfigFailure(step, selectedAttemptError) ? (
        <AgentConfigFailureCallout
          workspaceId={workspaceId}
          config={step.agentConfig}
          error={selectedAttemptError}
        />
      ) : null}
      <StepAttemptLogPanel stepId={stepId} attempt={attempt} attemptStatus={attemptStatus} />
    </div>
  );
}

function toSelectedAttemptError(
  step: Step,
  error: Record<string, unknown> | null,
): StepError | null {
  if (error === null) return null;

  const rawReason = error.reason;
  const parsedReason =
    typeof rawReason === 'string' &&
    STEP_ERROR_REASONS.has(rawReason as StepError['reason'] & string)
      ? (rawReason as NonNullable<StepError['reason']>)
      : undefined;
  const rawAgentConfigIssue = error.agentConfigIssue ?? error.agent_config_issue;
  const agentConfigIssue =
    typeof rawAgentConfigIssue === 'string' &&
    AGENT_CONFIG_ISSUES.has(rawAgentConfigIssue as NonNullable<StepError['agentConfigIssue']>)
      ? (rawAgentConfigIssue as NonNullable<StepError['agentConfigIssue']>)
      : undefined;
  const exitCode = error.exitCode ?? error.exit_code;
  const resolvedReason = parsedReason
    ? parsedReason
    : agentConfigIssue
      ? 'agent_config_invalid'
      : undefined;

  if (resolvedReason === undefined) return null;

  return {
    message: typeof error.message === 'string' ? error.message : '',
    exitCode: exitCode === null || typeof exitCode === 'number' ? exitCode : null,
    signal: typeof error.signal === 'string' ? error.signal : undefined,
    reason: resolvedReason,
    agentConfigIssue,
    category: step.type === 'setup' || step.type === 'checkout' ? 'setup' : 'user',
  };
}

function isAgentConfigFailure(step: Step, error: StepError | null): boolean {
  return step.type === 'agent' && error?.reason === 'agent_config_invalid';
}

function emptyStateForJob(job: Job, jobExecution: JobExecution): StepListEmptyState | undefined {
  if (job.carriedOver) {
    return {
      title: 'Carried over from a previous attempt',
      description: 'This job did not execute in this run.',
      status: 'succeeded',
    };
  }

  const displayStatus =
    job.mode === 'listening'
      ? deriveJobExecutionDisplayStatus(jobExecution)
      : deriveJobDisplayStatus(job);

  if (jobExecution.status === 'running' && displayStatus === 'pending') {
    return {
      title: 'Runner preparing job',
      description: 'A runner is assigned. Steps will appear here when work begins.',
      status: displayStatus,
    };
  }

  if (displayStatus === 'pending') {
    return {
      title: 'Waiting for this job to start',
      description: 'Steps will appear here once the job starts.',
      status: displayStatus,
    };
  }

  if (displayStatus === 'running') {
    return {
      title: 'Waiting for the first step',
      description: 'The first running step will appear here shortly.',
      status: displayStatus,
    };
  }

  if (displayStatus === 'cancelled') {
    return {
      title: 'Cancelled before start',
      description: 'This job was cancelled before any step started.',
      status: displayStatus,
    };
  }

  if (displayStatus === 'succeeded' || displayStatus === 'failed') {
    return {
      title: 'No steps recorded',
      description: `Execution #${jobExecution.sequence} finished without recorded steps.`,
      status: displayStatus,
    };
  }

  return undefined;
}

function emptyStateForMissingExecution(job: Job): StepListEmptyState {
  if (job.carriedOver) {
    return {
      title: 'Carried over from a previous attempt',
      description: 'This job did not execute in this run.',
      status: 'succeeded',
    };
  }

  if (job.mode === 'listening' && job.listenerStatus === 'listening') {
    return {
      title: 'Waiting for trigger events',
      description: 'Matching trigger events will create job executions here.',
      status: deriveJobDisplayStatus(job),
    };
  }

  if (job.mode === 'listening' && job.listenerStatus === 'resolved') {
    return {
      title: 'Listener resolved without executions',
      description: 'No matching trigger event created a job execution before the listener stopped.',
      status: job.status,
    };
  }

  if (job.status === 'pending') {
    return {
      title: 'Waiting for this job to start',
      description: 'No execution has been created for this job yet.',
      status: 'pending',
    };
  }

  if (job.status === 'skipped') {
    return {
      title: 'This job was skipped',
      description: skippedJobDescription(job.statusReason),
      status: 'skipped',
    };
  }

  if (job.status === 'cancelled') {
    return {
      title: 'Cancelled before start',
      description: 'This job was cancelled before an execution was created.',
      status: 'cancelled',
    };
  }

  return {
    title: 'Execution details unavailable',
    description: 'This job finished, but no job execution record is available.',
    status: job.status,
  };
}

function CarriedOverStepPanel() {
  return (
    <EmptyState
      className="min-h-120 rounded-8 border border-border-neutral-base bg-background-components-base px-16 py-20"
      icon="componentLine"
      title="Carried over from a previous attempt"
      description="Not executed in this run."
      variant="compact"
    />
  );
}

function skippedJobDescription(reason: Job['statusReason']): string {
  switch (reason) {
    case 'dependency_not_completed':
      return 'A required job did not complete, so this job was skipped.';
    case 'default_gate_rejected':
      return 'A required job did not succeed, so this job was skipped.';
    case 'condition_false':
    case 'condition_rejected':
      return 'The job condition did not match, so this job was skipped.';
    case 'condition_errored':
      return 'The job condition could not be evaluated, so this job was skipped.';
    case 'user_cancelled':
    case 'run_cancelled':
    case 'timed_out':
    case 'runner_lost':
    case 'step_failed':
    case 'unknown':
    case null:
      return 'This job did not start.';
  }
}
