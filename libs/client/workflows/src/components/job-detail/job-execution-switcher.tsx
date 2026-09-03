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
import {useMemo, useState} from 'react';
import {getWorkflowStatusVisual} from '#components/workflow-status/status-visuals.js';
import {WorkflowStatusIcon} from '#components/workflow-status/workflow-status-icon.js';
import {
  type BoundedExecutionCount,
  deriveJobExecutionDisplayStatus,
  type Job,
  type JobExecution,
  type WorkflowRunOverviewExecution,
} from '#core/workflow-run.js';
import {
  flattenWorkflowJobExecutionPages,
  useWorkflowJobExecutionsInfiniteQuery,
} from '#hooks/api/workflow-job-detail.js';
import {formatJobExecutionTime, JobExecutionTimeText} from './job-execution-time-text.js';

type JobExecutionOption = JobExecution | WorkflowRunOverviewExecution;

export interface JobExecutionSwitcherProps {
  job: Job;
  selectedJobExecution: string | null;
  onSelectedJobExecutionChange: (jobExecutionId: string) => void;
  executionCount?: BoundedExecutionCount | undefined;
  variant?: 'compact' | 'title' | undefined;
  className?: string | undefined;
}

export function JobExecutionSwitcher({
  job,
  selectedJobExecution,
  onSelectedJobExecutionChange,
  executionCount,
  variant = 'compact',
  className,
}: JobExecutionSwitcherProps) {
  const fallbackExecutions = useMemo(
    () => [...job.jobExecutions].sort((left, right) => right.sequence - left.sequence),
    [job.jobExecutions],
  );
  const selected =
    fallbackExecutions.find((jobExecution) => jobExecution.id === selectedJobExecution) ??
    fallbackExecutions[0] ??
    null;

  if (selected === null) return null;

  const historyVisible = executionCountVisible(job, executionCount);
  if (!historyVisible) {
    return (
      <div
        className={cn(
          'flex min-w-0 items-center gap-inline text-sm leading-20 text-foreground-neutral-subtle',
          className,
        )}
      >
        <ExecutionSummary execution={selected} />
      </div>
    );
  }

  return (
    <JobExecutionSwitcherMenu
      job={job}
      selectedJobExecution={selectedJobExecution}
      onSelectedJobExecutionChange={onSelectedJobExecutionChange}
      executionCount={executionCount}
      fallbackExecutions={fallbackExecutions}
      variant={variant}
      className={className}
    />
  );
}

function JobExecutionSwitcherMenu({
  job,
  selectedJobExecution,
  onSelectedJobExecutionChange,
  executionCount,
  fallbackExecutions,
  variant,
  className,
}: JobExecutionSwitcherProps & {fallbackExecutions: JobExecution[]}) {
  const [open, setOpen] = useState(false);
  const executionsQuery = useWorkflowJobExecutionsInfiniteQuery({
    jobId: job.id,
    enabled: open,
  });
  const historyExecutions = useMemo(
    () => flattenWorkflowJobExecutionPages(executionsQuery.data),
    [executionsQuery.data],
  );
  const executions = useMemo(() => {
    const options: JobExecutionOption[] =
      historyExecutions.length > 0 ? [...historyExecutions] : [...fallbackExecutions];
    for (const fallback of fallbackExecutions) {
      if (!options.some((execution) => execution.id === fallback.id)) options.push(fallback);
    }
    return options.sort((left, right) => right.sequence - left.sequence);
  }, [fallbackExecutions, historyExecutions]);
  const selected =
    executions.find((jobExecution) => jobExecution.id === selectedJobExecution) ??
    executions[0] ??
    null;

  if (selected === null) return null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex min-w-0 max-w-full items-center rounded-6 text-left transition-colors focus-visible:shadow-border-interactive-with-active focus-visible:outline-none',
          variant === 'title'
            ? '-mx-inline -my-[4px] gap-inline px-tight py-[4px] hover:bg-background-components-hover'
            : 'min-h-28 gap-inline px-tight py-[4px] text-sm leading-20 text-foreground-neutral-subtle hover:bg-background-components-hover',
          className,
        )}
        aria-label={`Switch job execution, currently execution ${selected.sequence}: ${executionDisplayName(selected)}`}
      >
        {variant === 'title' ? (
          <TitleExecutionSummary execution={selected} />
        ) : (
          <ExecutionSummary execution={selected} />
        )}
        <Icon name="arrowDownSLine" className="size-14 shrink-0 text-foreground-neutral-muted" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" size="lg" className="max-h-[320px] overflow-y-auto">
        <DropdownMenuLabel>{executionCountLabel(executions, executionCount)}</DropdownMenuLabel>
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
                  status={executionDisplayStatus(jobExecution)}
                  size={14}
                  tooltip={false}
                />
                <span className="font-code text-xs leading-20 text-foreground-neutral-base tabular-nums">
                  #{jobExecution.sequence}
                </span>
                <span className="min-w-0 truncate text-xs leading-20 text-foreground-neutral-base">
                  {executionDisplayName(jobExecution)}
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

function executionAccessibleLabel(execution: JobExecutionOption): string {
  const status = getWorkflowStatusVisual(executionDisplayStatus(execution));
  return [
    `Execution #${execution.sequence}: ${executionDisplayName(execution)}`,
    status.label,
    execution.statusReason ?? undefined,
    execution.displayDuration
      ? `duration ${formatJobExecutionTime(execution.displayDuration)}`
      : undefined,
  ]
    .filter((part): part is string => Boolean(part))
    .join(', ');
}

function TitleExecutionSummary({execution}: {execution: JobExecutionOption}) {
  return (
    <span className="flex min-w-0 items-center gap-inline">
      <Text as="span" size="sm" bold className="shrink-0 text-foreground-neutral-base">
        #{execution.sequence}
      </Text>
      <Text as="span" size="sm" bold className="min-w-0 truncate text-foreground-neutral-base">
        {executionDisplayName(execution)}
      </Text>
    </span>
  );
}

function ExecutionSummary({execution}: {execution: JobExecutionOption}) {
  const displayStatus = executionDisplayStatus(execution);

  return (
    <span className="flex min-w-0 items-center gap-inline">
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
  execution: JobExecutionOption;
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

function executionDisplayStatus(execution: JobExecutionOption) {
  return 'displayStatus' in execution
    ? execution.displayStatus
    : deriveJobExecutionDisplayStatus(execution);
}

function executionDisplayName(execution: JobExecutionOption): string {
  return execution.name;
}

function executionCountVisible(job: Job, count: BoundedExecutionCount | undefined): boolean {
  if (count === undefined) return job.executionCountVisible;
  return count === '100+' || job.mode === 'listening' || count > 1;
}

function executionCountLabel(
  executions: readonly JobExecutionOption[],
  count: BoundedExecutionCount | undefined,
): string {
  const value = count ?? executions.length;
  return `${value} execution${value === 1 ? '' : 's'}`;
}
