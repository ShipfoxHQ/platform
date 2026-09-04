import type {JobExecutionUsage} from '@shipfox/client-usage';
import {JobUsageCells} from '@shipfox/client-usage';
import {Icon} from '@shipfox/react-ui/icon';
import {Tooltip, TooltipContent, TooltipTrigger} from '@shipfox/react-ui/tooltip';
import {Code, Text} from '@shipfox/react-ui/typography';
import {formatTimestamp} from '@shipfox/react-ui/utils';
import type {ReactNode} from 'react';
import {getWorkflowStatusVisual} from '#components/workflow-status/status-visuals.js';
import {WorkflowStatusIcon} from '#components/workflow-status/workflow-status-icon.js';
import type {RunAnnotationSummary} from '#core/run-annotation.js';
import {
  type BoundedExecutionCount,
  defaultJobExecution,
  deriveJobDisplayStatus,
  deriveJobExecutionDisplayStatus,
  type Job,
  type JobExecution,
  type JobExecutionDisplayStatus,
} from '#core/workflow-run.js';
import {RunAnnotationCountChip} from '../workflow-run-tabs/index.js';
import {JobExecutionSwitcher} from './job-execution-switcher.js';
import {JobExecutionTimeText} from './job-execution-time-text.js';

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
  /** The compact selected-job response carries this count without materializing history. */
  executionCount?: BoundedExecutionCount | undefined;
  executionCountVisible?: boolean | undefined;
  executionDisplayStatus?: JobExecutionDisplayStatus | undefined;
  usage?: JobExecutionUsage | undefined;
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
  executionCount,
  executionCountVisible,
  executionDisplayStatus,
  usage,
}: JobDetailHeaderProps) {
  const selectedStatus = selectedExecutionStatus(job, selectedJobExecution, executionDisplayStatus);
  const jobStatus = getWorkflowStatusVisual(selectedStatus);

  return (
    <header className="px-row py-row">
      <div className="flex min-w-0 items-start justify-between gap-cluster">
        <div className="flex min-w-0 flex-col gap-inline">
          <div className="flex min-w-0 items-center gap-inline">
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
            <div className="flex min-w-0 flex-wrap items-center gap-inline text-foreground-neutral-muted">
              {selectedJobExecution && (executionCountVisible ?? job.executionCountVisible) ? (
                <JobExecutionSwitcher
                  job={job}
                  selectedJobExecution={selectedJobExecution.id}
                  onSelectedJobExecutionChange={onSelectedJobExecutionChange}
                  executionCount={executionCount}
                  variant="title"
                />
              ) : null}
              {selectedJobExecution ? (
                <>
                  <JobDurationMeta execution={selectedJobExecution} kind="queue" />
                  <JobDurationMeta execution={selectedJobExecution} kind="run" />
                </>
              ) : null}
              <JobUsageCells usage={usage} />
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

function selectedExecutionStatus(
  job: Job,
  execution: JobExecution | undefined,
  knownStatus: JobExecutionDisplayStatus | undefined,
) {
  if (knownStatus) return knownStatus;
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
  let label = 'ran';
  let tooltipLabel = 'Ran';
  if (kind === 'queue') {
    label = 'queued';
    tooltipLabel = 'Queued';
  } else if (live) {
    label = 'running';
    tooltipLabel = 'Running';
  }
  const tooltip = `${tooltipLabel} ${formatTimestamp(from)}${to ? ` – ${formatTimestamp(to)}` : ' – now'}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-tight whitespace-nowrap font-code text-xs leading-20 tabular-nums">
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
