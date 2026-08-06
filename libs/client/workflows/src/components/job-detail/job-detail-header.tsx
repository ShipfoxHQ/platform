import {Icon} from '@shipfox/react-ui/icon';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Code, Text} from '@shipfox/react-ui/typography';
import {formatTimestamp} from '@shipfox/react-ui/utils';
import type {ReactNode} from 'react';
import {getWorkflowStatusVisual} from '#components/workflow-status/status-visuals.js';
import {WorkflowStatusIcon} from '#components/workflow-status/workflow-status-icon.js';
import type {RunAnnotationSummary} from '#core/run-annotation.js';
import {
  defaultJobExecution,
  deriveJobDisplayStatus,
  deriveJobExecutionDisplayStatus,
  type Job,
  type JobExecution,
} from '#core/workflow-run.js';
import {JobExecutionSwitcher} from './job-execution-switcher.js';
import {JobExecutionTimeText} from './job-execution-time-text.js';
import {RunAnnotationCountChip} from '../workflow-run-tabs/index.js';

export interface JobDetailHeaderProps {
  job: Job;
  selectedJobExecution: JobExecution | undefined;
  onSelectedJobExecutionChange: (jobExecutionId: string) => void;
  workspaceSlug: string;
  projectSlug: string;
  workflowRunId: string;
  runAttempt?: number | undefined;
  /** Counts for this job only. Renders a link into the run's Annotations section, never a body. */
  annotationSummary?: RunAnnotationSummary | undefined;
  jobContext?: ReactNode;
}

export function JobDetailHeader({
  job,
  selectedJobExecution,
  onSelectedJobExecutionChange,
  workspaceSlug,
  projectSlug,
  workflowRunId,
  runAttempt,
  annotationSummary,
  jobContext,
}: JobDetailHeaderProps) {
  const selectedStatus = selectedExecutionStatus(job, selectedJobExecution);
  const jobStatus = getWorkflowStatusVisual(selectedStatus);

  return (
    <header className="border-b border-border-neutral-base px-16 py-12">
      <div className="flex min-w-0 items-start justify-between gap-12">
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

          {selectedJobExecution || annotationSummary?.total ? (
            <div className="flex min-w-0 flex-wrap items-center gap-10 text-foreground-neutral-muted">
              {selectedJobExecution && job.executionCountVisible ? (
                <JobExecutionSwitcher
                  job={job}
                  selectedJobExecution={selectedJobExecution.id}
                  onSelectedJobExecutionChange={onSelectedJobExecutionChange}
                  variant="title"
                />
              ) : null}
              {selectedJobExecution ? (
                <>
                  <JobDurationMeta execution={selectedJobExecution} kind="queue" />
                  <JobDurationMeta execution={selectedJobExecution} kind="run" />
                </>
              ) : null}
              <RunAnnotationCountChip
                summary={annotationSummary}
                workspaceSlug={workspaceSlug}
                projectSlug={projectSlug}
                workflowRunId={workflowRunId}
                runAttempt={runAttempt}
                jobId={job.id}
              />
            </div>
          ) : null}
        </div>
        {jobContext}
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
  const live = time.state === 'live';
  const label = kind === 'queue' ? 'queued' : live ? 'running' : 'ran';
  const tooltipLabel = kind === 'queue' ? 'Queued' : live ? 'Running' : 'Ran';
  const tooltip = `${tooltipLabel} ${formatTimestamp(from)}${to ? ` – ${formatTimestamp(to)}` : ' – now'}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-4 whitespace-nowrap font-code text-xs leading-20 tabular-nums">
          <Icon
            name={kind === 'queue' ? 'hourglassLine' : 'timerLine'}
            size={12}
            aria-hidden="true"
          />
          <span>{label} </span>
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
