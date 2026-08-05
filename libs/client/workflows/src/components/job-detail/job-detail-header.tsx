import {Icon} from '@shipfox/react-ui/icon';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Code, Text} from '@shipfox/react-ui/typography';
import {formatTimestamp} from '@shipfox/react-ui/utils';
import {getWorkflowStatusVisual} from '#components/workflow-status/status-visuals.js';
import {WorkflowStatusIcon} from '#components/workflow-status/workflow-status-icon.js';
import {
  defaultJobExecution,
  deriveJobDisplayStatus,
  deriveJobExecutionDisplayStatus,
  type Job,
  type JobExecution,
} from '#core/workflow-run.js';
import {JobExecutionSwitcher} from './job-execution-switcher.js';
import {JobExecutionTimeText} from './job-execution-time-text.js';

export interface JobDetailHeaderProps {
  job: Job;
  selectedJobExecution: JobExecution | undefined;
  onSelectedJobExecutionChange: (jobExecutionId: string) => void;
}

export function JobDetailHeader({
  job,
  selectedJobExecution,
  onSelectedJobExecutionChange,
}: JobDetailHeaderProps) {
  const selectedStatus = selectedExecutionStatus(job, selectedJobExecution);
  const jobStatus = getWorkflowStatusVisual(selectedStatus);

  return (
    <header className="border-b border-border-neutral-base px-16 py-12">
      <div className="flex min-w-0 flex-col gap-8">
        <div className="flex min-w-0 items-center gap-8">
          <WorkflowStatusIcon
            status={selectedStatus}
            size={14}
            tooltip
            ariaLabel={`Job status: ${jobStatus.label}`}
          />
          <Code
            as="h1"
            variant="paragraph"
            bold
            tabIndex={-1}
            className="min-w-0 truncate text-lg leading-24 text-foreground-neutral-base outline-none"
            data-job-heading
          >
            {job.displayName}
          </Code>
        </div>

        {selectedJobExecution ? (
          <div className="flex min-w-0 flex-wrap items-center gap-10 text-foreground-neutral-muted">
            {job.executionCountVisible ? (
              <JobExecutionSwitcher
                job={job}
                selectedJobExecution={selectedJobExecution.id}
                onSelectedJobExecutionChange={onSelectedJobExecutionChange}
                variant="title"
              />
            ) : null}
            <JobDurationMeta execution={selectedJobExecution} kind="queue" />
            <JobDurationMeta execution={selectedJobExecution} kind="run" />
          </div>
        ) : null}
      </div>
    </header>
  );
}

function selectedExecutionStatus(job: Job, execution: JobExecution | undefined) {
  if (!execution) return deriveJobDisplayStatus(job);
  const defaultExecution = defaultJobExecution(job);
  return execution.id === defaultExecution?.id
    ? deriveJobDisplayStatus(job)
    : deriveJobExecutionDisplayStatus(execution);
}

function JobDurationMeta({execution, kind}: {execution: JobExecution; kind: 'queue' | 'run'}) {
  const time = kind === 'queue' ? execution.queueTime : execution.runTime;
  const from = kind === 'queue' ? execution.queuedAt : execution.startedAt;
  if (!time || !from) return null;

  const to = kind === 'queue' ? execution.startedAt : execution.finishedAt;
  const tooltip = `${kind === 'queue' ? 'Queued' : 'Ran'} ${formatTimestamp(from)}${to ? ` – ${formatTimestamp(to)}` : ' – now'}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-4 whitespace-nowrap font-code text-xs leading-20 tabular-nums">
          <Icon
            name={kind === 'queue' ? 'hourglassLine' : 'timerLine'}
            size={12}
            aria-hidden="true"
          />
          <span>{kind === 'queue' ? 'queued' : 'ran'} </span>
          <JobExecutionTimeText time={time} />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <Text as="span" size="xs">
          {tooltip}
        </Text>
      </TooltipContent>
    </Tooltip>
  );
}
