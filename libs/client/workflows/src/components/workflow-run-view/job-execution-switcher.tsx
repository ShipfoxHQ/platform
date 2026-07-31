import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@shipfox/react-ui/dropdown-menu';
import {Icon} from '@shipfox/react-ui/icon';
import {Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import {useMemo} from 'react';
import {getWorkflowStatusVisual} from '#components/workflow-status/status-visuals.js';
import {WorkflowStatusIcon} from '#components/workflow-status/workflow-status-icon.js';
import {deriveJobExecutionDisplayStatus, type Job, type JobExecution} from '#core/workflow-run.js';
import {formatJobExecutionTime, JobExecutionTimeText} from './job-execution-time-text.js';

export interface JobExecutionSwitcherProps {
  job: Job;
  selectedJobExecution: string | null;
  onSelectedJobExecutionChange: (jobExecutionId: string) => void;
  variant?: 'compact' | 'title' | undefined;
  className?: string | undefined;
}

export function JobExecutionSwitcher({
  job,
  selectedJobExecution,
  onSelectedJobExecutionChange,
  variant = 'compact',
  className,
}: JobExecutionSwitcherProps) {
  const executions = useMemo(
    () => [...job.jobExecutions].sort((left, right) => right.sequence - left.sequence),
    [job.jobExecutions],
  );
  const selected =
    executions.find((jobExecution) => jobExecution.id === selectedJobExecution) ??
    executions[0] ??
    null;

  if (selected === null) return null;

  if (!job.executionCountVisible) {
    return (
      <div
        className={cn(
          'flex min-w-0 items-center gap-6 text-sm leading-20 text-foreground-neutral-subtle',
          className,
        )}
      >
        <ExecutionSummary execution={selected} />
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex min-w-0 max-w-full items-center rounded-6 text-left transition-colors focus-visible:shadow-border-interactive-with-active focus-visible:outline-none',
          variant === 'title'
            ? '-mx-6 -my-4 gap-8 px-6 py-4 hover:bg-background-components-hover'
            : 'min-h-28 gap-6 px-8 py-4 text-sm leading-20 text-foreground-neutral-subtle hover:bg-background-components-hover',
          className,
        )}
        aria-label={`Switch job execution, currently execution ${selected.sequence}: ${selected.name}`}
      >
        {variant === 'title' ? (
          <TitleExecutionSummary execution={selected} />
        ) : (
          <ExecutionSummary execution={selected} />
        )}
        <Icon name="arrowDownSLine" className="size-14 shrink-0 text-foreground-neutral-muted" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" size="lg" className="max-h-[320px] overflow-y-auto">
        <DropdownMenuLabel>
          {executions.length} execution{executions.length === 1 ? '' : 's'}
        </DropdownMenuLabel>
        {executions.map((jobExecution) => {
          const isSelected = jobExecution.id === selected.id;

          return (
            <DropdownMenuItem
              key={jobExecution.id}
              asChild
              onSelect={() => onSelectedJobExecutionChange(jobExecution.id)}
            >
              <button
                type="button"
                aria-current={isSelected ? 'true' : undefined}
                aria-label={executionAccessibleLabel(jobExecution)}
                className="w-full text-left"
              >
                <WorkflowStatusIcon
                  status={deriveJobExecutionDisplayStatus(jobExecution)}
                  size={14}
                  tooltip={false}
                />
                <span className="font-code text-xs leading-20 text-foreground-neutral-base tabular-nums">
                  #{jobExecution.sequence}
                </span>
                <span className="min-w-0 truncate text-xs leading-20 text-foreground-neutral-base">
                  {job.displayNameForExecution(jobExecution)}
                </span>
                {!isSelected && jobExecution.statusReason ? (
                  <span className="min-w-0 flex-1 truncate text-xs leading-20 text-foreground-neutral-muted">
                    {jobExecution.statusReason}
                  </span>
                ) : (
                  <span className="min-w-0 flex-1" />
                )}
                {isSelected ? (
                  <Icon name="check" className="size-14 shrink-0 text-foreground-neutral-base" />
                ) : null}
                <JobExecutionDuration
                  execution={jobExecution}
                  className="ml-auto shrink-0 font-code text-xs leading-20 text-foreground-neutral-muted tabular-nums"
                />
              </button>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function executionAccessibleLabel(execution: JobExecution): string {
  const status = getWorkflowStatusVisual(deriveJobExecutionDisplayStatus(execution));
  return [
    `Execution #${execution.sequence}: ${execution.name}`,
    status.label,
    execution.statusReason ?? undefined,
    execution.displayDuration
      ? `duration ${formatJobExecutionTime(execution.displayDuration)}`
      : undefined,
  ]
    .filter((part): part is string => Boolean(part))
    .join(', ');
}

function TitleExecutionSummary({execution}: {execution: JobExecution}) {
  return (
    <span className="flex min-w-0 items-center gap-8">
      <Text as="span" size="sm" bold className="shrink-0 text-foreground-neutral-base">
        #{execution.sequence}
      </Text>
      <Text as="span" size="sm" bold className="min-w-0 truncate text-foreground-neutral-base">
        {execution.name}
      </Text>
    </span>
  );
}

function ExecutionSummary({execution}: {execution: JobExecution}) {
  const displayStatus = deriveJobExecutionDisplayStatus(execution);

  return (
    <span className="flex min-w-0 items-center gap-6">
      <WorkflowStatusIcon status={displayStatus} size={14} tooltip={false} />
      <span className="shrink-0 font-code text-xs leading-20 text-foreground-neutral-base tabular-nums">
        Execution #{execution.sequence}
      </span>
      {execution.statusReason ? (
        <Text as="span" size="xs" className="min-w-0 truncate text-foreground-neutral-muted">
          · {execution.statusReason}
        </Text>
      ) : null}
      <JobExecutionDuration
        execution={execution}
        className="shrink-0 font-code text-xs leading-20 text-foreground-neutral-muted tabular-nums"
      />
    </span>
  );
}

function JobExecutionDuration({
  execution,
  className,
}: {
  execution: JobExecution;
  className?: string | undefined;
}) {
  const duration = execution.displayDuration;
  if (!duration) return null;

  return (
    <span className={className}>
      <JobExecutionTimeText time={duration} />
    </span>
  );
}
