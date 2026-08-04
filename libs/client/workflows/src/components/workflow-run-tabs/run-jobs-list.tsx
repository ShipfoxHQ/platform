import {EmptyState} from '@shipfox/react-ui/empty-state';
import {useTimeTick} from '@shipfox/react-ui/time-ticker';
import {cn} from '@shipfox/react-ui/utils';
import {
  defaultJobExecution,
  deriveJobDisplayStatus,
  deriveJobExecutionDisplayStatus,
  type Job,
} from '#core/workflow-run.js';
import {formatJobDurationAccessibleLabel} from '../job-graph/job-duration-format.js';
import {JobDurationLabel} from '../job-graph/job-duration-label.js';
import {JobCard} from '../workflow-run-view/job-card.js';
import {WorkflowStatusIcon} from '../workflow-status/workflow-status-icon.js';

export interface RunJobsListProps {
  jobs: Job[];
  selectedJobId?: string | undefined;
  onSelectedJobChange: (jobId: string | undefined) => void;
  workspaceSlug?: string | undefined;
  selectedJobExecution: ReturnType<typeof defaultJobExecution>;
  selectedAttemptId: string | null | undefined;
  onSelectedJobExecutionChange: ((jobExecutionId: string | undefined) => void) | undefined;
  onSelectedAttemptChange: ((attemptId: string | undefined) => void) | undefined;
  sourcePanelId?: string | undefined;
  sourceAvailable?: boolean | undefined;
  focusedSourceStepId?: string | null | undefined;
  onOpenStepSource?: Parameters<typeof JobCard>[0]['onOpenStepSource'];
}

export function RunJobsList({
  jobs,
  selectedJobId,
  onSelectedJobChange,
  workspaceSlug,
  selectedJobExecution,
  selectedAttemptId,
  onSelectedJobExecutionChange,
  onSelectedAttemptChange,
  sourcePanelId,
  sourceAvailable,
  focusedSourceStepId,
  onOpenStepSource,
}: RunJobsListProps) {
  useTimeTick();

  if (jobs.length === 0) {
    return (
      <section
        aria-label="Workflow jobs"
        className="rounded-8 border border-border-neutral-base bg-background-components-base"
      >
        <div className="min-h-160">
          <RunJobsEmptyState />
        </div>
      </section>
    );
  }

  const orderedJobs = [...jobs].sort(compareJobs);

  return (
    <section aria-label="Workflow jobs" className="flex min-w-0 flex-col gap-8">
      <ul aria-label="Run jobs" className="m-0 flex min-w-0 list-none flex-col gap-8 p-0">
        {orderedJobs.map((job) => {
          const selected = job.id === selectedJobId;
          const status = deriveJobDisplayStatus(job);
          const execution = defaultJobExecution(job);
          const durationLabel = formatJobDurationAccessibleLabel(
            job.displayDuration,
            execution ? deriveJobExecutionDisplayStatus(execution) : undefined,
          );
          const rowLabel = [
            job.displayName,
            statusLabel(status),
            durationLabel,
            job.carriedOver ? 'reused' : undefined,
          ]
            .filter((part): part is string => Boolean(part))
            .join(', ');

          return (
            <li key={job.id} className="min-w-0">
              <button
                type="button"
                aria-expanded={selected}
                aria-controls={selected ? `job-card-${job.id}` : undefined}
                aria-label={rowLabel}
                onClick={() => onSelectedJobChange(selected ? undefined : job.id)}
                className={cn(
                  'relative flex min-h-44 w-full min-w-0 items-center gap-8 rounded-8 bg-background-neutral-base px-12 text-left shadow-button-neutral outline-none transition-colors hover:bg-background-components-hover focus-visible:shadow-button-neutral-focus',
                  selected &&
                    'bg-background-components-hover hover:bg-background-components-pressed',
                )}
              >
                {selected ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-6 left-0 w-px rounded-full bg-border-highlights-interactive"
                  />
                ) : null}
                <WorkflowStatusIcon status={status} size={14} tooltip={false} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground-neutral-base">
                  {job.displayName}
                </span>
                <JobDurationLabel duration={job.displayDuration} />
              </button>
              {selected ? (
                <div id={`job-card-${job.id}`} className="mt-8">
                  <JobCard
                    workspaceSlug={workspaceSlug}
                    job={job}
                    selectedJobExecution={selectedJobExecution}
                    selectedAttemptId={job.carriedOver ? undefined : selectedAttemptId}
                    onSelectedJobExecutionChange={onSelectedJobExecutionChange}
                    onSelectedAttemptChange={onSelectedAttemptChange}
                    sourcePanelId={sourcePanelId}
                    sourceAvailable={sourceAvailable}
                    focusedSourceStepId={focusedSourceStepId}
                    onOpenStepSource={onOpenStepSource}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RunJobsEmptyState() {
  return (
    <EmptyState
      icon="componentLine"
      title="No jobs yet"
      description="This run has not materialized jobs."
    />
  );
}

function compareJobs(left: Job, right: Job): number {
  return (
    left.position - right.position ||
    left.displayName.localeCompare(right.displayName) ||
    left.id.localeCompare(right.id)
  );
}

function statusLabel(status: ReturnType<typeof deriveJobDisplayStatus>): string {
  return status === 'listening' ? 'Listening' : status.charAt(0).toUpperCase() + status.slice(1);
}
