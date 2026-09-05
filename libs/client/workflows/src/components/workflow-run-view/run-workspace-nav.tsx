import {Collapsible, CollapsibleTrigger} from '@shipfox/react-ui/collapsible';
import {Icon} from '@shipfox/react-ui/icon';
import {TimeTickerProvider} from '@shipfox/react-ui/time-ticker';
import {Text} from '@shipfox/react-ui/typography';
import {cn} from '@shipfox/react-ui/utils';
import {Link} from '@tanstack/react-router';
import {useEffect, useMemo, useRef, useState} from 'react';
import {WorkflowStatusIcon} from '#components/workflow-status/workflow-status-icon.js';
import type {RunAnnotationSummary} from '#core/run-annotation.js';
import {
  deriveJobDisplayStatus,
  type WorkflowRunJobSummary,
  type WorkflowRunListItem,
  type WorkflowRunOverview,
  type WorkflowRunOverviewJob,
} from '#core/workflow-run.js';
import {
  type WorkflowJobSearch,
  type WorkflowRunTab,
  workflowJobSearchParams,
  workflowRunSearchParams,
} from '#routes/inputs.js';
import {JobExecutionTimeText} from '../job-detail/job-execution-time-text.js';

type RunWorkspaceSection = Exclude<WorkflowRunTab, 'jobs'>;
type RunWorkspaceRun = WorkflowRunOverview | WorkflowRunListItem;
type RunWorkspaceJob = WorkflowRunOverviewJob | WorkflowRunJobSummary;

const RUN_WORKSPACE_LINK_CLASS_NAME =
  'relative flex min-h-32 items-center gap-inline rounded-4 px-tight outline-none transition-colors hover:bg-background-neutral-hover focus-visible:shadow-border-interactive-with-active @max-[767px]:min-h-44 [@media(pointer:coarse)]:min-h-44';

export interface RunWorkspaceNavProps {
  workspaceSlug: string;
  projectSlug: string;
  run: RunWorkspaceRun;
  activeSection: RunWorkspaceSection;
  currentJobId?: string | undefined;
  activeJob?: RunWorkspaceJob | undefined;
  jobSearch?: WorkflowJobSearch | undefined;
  annotationSummary?: RunAnnotationSummary | undefined;
}

/**
 * The stable navigation model shared by run-level and job-level routes. The graph explains
 * topology; this compact index makes moving between dedicated job pages predictable.
 */
export function RunWorkspaceNav({
  workspaceSlug,
  projectSlug,
  run,
  activeSection,
  currentJobId,
  activeJob,
  jobSearch = {},
  annotationSummary,
}: RunWorkspaceNavProps) {
  const {jobs, jobCount} = useMemo(() => workspaceJobs(run, activeJob), [activeJob, run]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const currentJob =
    jobs.find((job) => job.id === currentJobId) ??
    (currentJobId && workspaceHasCompleteJobIndex(run) ? jobs[0] : undefined);
  const resolvedCurrentJobId = currentJob?.id;
  const currentLabel = workspaceCurrentLabel(currentJob, currentJobId, activeSection);

  return (
    <TimeTickerProvider intervalMs={1000} reducedMotionIntervalMs={10_000}>
      <aside className="flex min-h-0 w-full shrink-0 flex-col border-b border-border-neutral-base min-[768px]:w-240 min-[768px]:border-b-0">
        <Collapsible
          open={mobileOpen}
          onOpenChange={setMobileOpen}
          className="flex min-h-0 flex-col min-[768px]:flex-1"
        >
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex min-h-44 w-full items-center justify-between gap-cluster px-row text-left outline-none focus-visible:shadow-border-interactive-with-active min-[768px]:hidden"
              aria-label="Toggle run navigation"
            >
              <span className="min-w-0">
                <Text as="span" size="xs" className="block text-foreground-neutral-muted">
                  Run navigation
                </Text>
                <span className="block truncate font-code text-xs leading-20 text-foreground-neutral-base">
                  {currentLabel}
                </span>
              </span>
              <Icon
                name="chevronDown"
                size={14}
                aria-hidden="true"
                className={cn(
                  'shrink-0 text-foreground-neutral-muted transition-transform',
                  mobileOpen && 'rotate-180',
                )}
              />
            </button>
          </CollapsibleTrigger>
          <div
            className={cn(
              'flex min-h-0 max-h-[50vh] flex-col overflow-y-auto p-tight scrollbar min-[768px]:min-h-0 min-[768px]:max-h-none min-[768px]:flex-1 min-[768px]:flex min-[768px]:overflow-hidden min-[768px]:p-[12px]',
              !mobileOpen && 'hidden',
            )}
          >
            <RunWorkspaceNavContent
              workspaceSlug={workspaceSlug}
              projectSlug={projectSlug}
              run={run}
              jobs={jobs}
              jobCount={jobCount}
              activeSection={activeSection}
              currentJobId={resolvedCurrentJobId}
              activeJobId={currentJobId}
              jobSearch={jobSearch}
              annotationSummary={annotationSummary}
              mobileOpen={mobileOpen}
              onNavigate={() => setMobileOpen(false)}
            />
          </div>
        </Collapsible>
      </aside>
    </TimeTickerProvider>
  );
}

function RunWorkspaceNavContent({
  workspaceSlug,
  projectSlug,
  run,
  jobs,
  jobCount,
  activeSection,
  currentJobId,
  activeJobId,
  jobSearch,
  annotationSummary,
  mobileOpen,
  onNavigate,
}: RunWorkspaceNavProps & {
  jobs: RunWorkspaceJob[];
  jobCount: number;
  jobSearch: WorkflowJobSearch;
  activeJobId?: string | undefined;
  mobileOpen: boolean;
  onNavigate: () => void;
}) {
  const currentRowRef = useRef<HTMLAnchorElement>(null);
  const runAttempt = jobSearch.runAttempt ?? run.runAttempt.attempt;

  useEffect(() => {
    if (!currentJobId || mobileOpen) return;
    currentRowRef.current?.scrollIntoView({block: 'nearest'});
  }, [currentJobId, mobileOpen]);

  useEffect(() => {
    if (!currentJobId || !mobileOpen) return;
    currentRowRef.current?.scrollIntoView({block: 'nearest'});
  }, [currentJobId, mobileOpen]);

  return (
    <nav aria-label="Run workspace" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ul className="border-b border-border-neutral-base pb-row">
        <li>
          <RunSectionLink
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
            runId={run.id}
            runAttempt={runAttempt}
            section="summary"
            current={!activeJobId && activeSection === 'summary'}
            onNavigate={onNavigate}
          />
        </li>
      </ul>

      <section
        aria-labelledby="run-workspace-jobs-heading"
        className="flex min-h-0 min-w-0 flex-1 flex-col border-b border-border-neutral-base py-row"
      >
        <div className="flex items-center justify-between gap-inline px-tight pb-[6px]">
          <Text
            as="h2"
            id="run-workspace-jobs-heading"
            size="xs"
            bold
            className="text-foreground-neutral-muted"
          >
            Jobs
          </Text>
          <Text as="span" size="xs" className="font-code text-foreground-neutral-subtle">
            {jobCount}
          </Text>
        </div>
        <ol className="min-h-0 flex-1 overflow-y-auto scrollbar">
          {jobs.map((job) => {
            const current = job.id === currentJobId;
            const duration = workspaceJobDuration(job);

            return (
              <li key={job.id}>
                <Link
                  ref={current ? currentRowRef : undefined}
                  to="/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId/jobs/$jobId"
                  params={{workspaceSlug, projectSlug, workflowRunId: run.id, jobId: job.id}}
                  search={workflowJobSearchParams({runAttempt}) as never}
                  onClick={onNavigate}
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    RUN_WORKSPACE_LINK_CLASS_NAME,
                    'min-w-0 text-left',
                    current && 'bg-background-neutral-hover',
                  )}
                >
                  {current ? <RunWorkspaceActiveBar /> : null}
                  <WorkflowStatusIcon
                    status={workspaceJobDisplayStatus(job)}
                    size={12}
                    tooltip={false}
                  />
                  <span className="min-w-0 truncate font-code text-xs leading-20 text-foreground-neutral-base">
                    {workspaceJobDisplayName(job)}
                  </span>
                  <span className="ml-auto shrink-0 font-code text-xs leading-20 text-foreground-neutral-muted tabular-nums">
                    {duration ? <JobExecutionTimeText time={duration} /> : '-'}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="run-workspace-details-heading" className="pt-row">
        <Text
          as="h2"
          id="run-workspace-details-heading"
          size="xs"
          bold
          className="px-tight pb-[6px] text-foreground-neutral-muted"
        >
          Run details
        </Text>
        <ul>
          <li>
            <RunSectionLink
              workspaceSlug={workspaceSlug}
              projectSlug={projectSlug}
              runId={run.id}
              runAttempt={runAttempt}
              section="annotations"
              current={!activeJobId && activeSection === 'annotations'}
              count={annotationSummary?.total}
              countTruncated={annotationSummary?.truncated}
              onNavigate={onNavigate}
            />
          </li>
          <li>
            <RunSectionLink
              workspaceSlug={workspaceSlug}
              projectSlug={projectSlug}
              runId={run.id}
              runAttempt={runAttempt}
              section="source"
              current={!activeJobId && activeSection === 'source'}
              onNavigate={onNavigate}
            />
          </li>
        </ul>
      </section>
    </nav>
  );
}

function RunSectionLink({
  workspaceSlug,
  projectSlug,
  runId,
  runAttempt,
  section,
  current,
  count,
  countTruncated = false,
  onNavigate,
}: {
  workspaceSlug: string;
  projectSlug: string;
  runId: string;
  runAttempt: number;
  section: RunWorkspaceSection;
  current: boolean;
  count?: number | undefined;
  /** The read hit its page budget, so the count is a lower bound and renders as `N+`. */
  countTruncated?: boolean | undefined;
  onNavigate?: (() => void) | undefined;
}) {
  return (
    <Link
      to="/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId"
      params={{workspaceSlug, projectSlug, workflowRunId: runId}}
      search={
        workflowRunSearchParams(
          {runAttempt, ...(section === 'summary' ? {} : {tab: section})},
          {runAttempt},
        ) as never
      }
      onClick={onNavigate}
      aria-current={current ? 'page' : undefined}
      aria-label={
        count
          ? `${sectionLabel(section)}, ${countTruncated ? `${count} or more` : count}`
          : undefined
      }
      className={cn(
        RUN_WORKSPACE_LINK_CLASS_NAME,
        'text-xs font-medium text-foreground-neutral-base',
        current && 'bg-background-neutral-hover',
      )}
    >
      {current ? <RunWorkspaceActiveBar /> : null}
      {sectionLabel(section)}
      {count ? (
        <span
          aria-hidden="true"
          className="ml-auto font-code text-xs text-foreground-neutral-muted tabular-nums"
        >
          {count}
          {countTruncated ? '+' : ''}
        </span>
      ) : null}
    </Link>
  );
}

function RunWorkspaceActiveBar() {
  return (
    <span
      aria-hidden="true"
      data-run-workspace-active-bar
      className="absolute inset-y-0 left-0 w-2 rounded-l-4 bg-border-highlights-interactive"
    />
  );
}

function sectionLabel(section: RunWorkspaceSection): string {
  if (section === 'annotations') return 'Annotations';
  if (section === 'source') return 'Source';
  return 'Summary';
}

function workspaceCurrentLabel(
  currentJob: RunWorkspaceJob | undefined,
  currentJobId: string | undefined,
  activeSection: RunWorkspaceSection,
): string {
  if (currentJob) return workspaceJobDisplayName(currentJob);
  if (currentJobId) return 'Job';
  return sectionLabel(activeSection);
}

function workspaceJobs(
  run: RunWorkspaceRun,
  activeJob: RunWorkspaceJob | undefined,
): {jobs: RunWorkspaceJob[]; jobCount: number} {
  if ('preview' in run.jobs) {
    const jobs: RunWorkspaceJob[] = [...run.jobs.preview];
    if (activeJob && !jobs.some((job) => job.id === activeJob.id)) jobs.push(activeJob);
    return {jobs: jobs.sort(compareJobs), jobCount: run.jobs.total};
  }
  if (run.jobs.kind === 'complete') {
    const jobs: RunWorkspaceJob[] = [...run.jobs.items];
    if (activeJob && !jobs.some((job) => job.id === activeJob.id)) jobs.push(activeJob);
    return {jobs: jobs.sort(compareJobs), jobCount: run.jobs.total};
  }
  const jobs: RunWorkspaceJob[] = [...run.jobs.firstPage.items];
  if (activeJob && !jobs.some((job) => job.id === activeJob.id)) jobs.push(activeJob);
  return {
    jobs: jobs.sort(compareJobs),
    jobCount: run.jobs.total,
  };
}

function workspaceHasCompleteJobIndex(run: RunWorkspaceRun): boolean {
  return 'kind' in run.jobs && run.jobs.kind === 'complete';
}

function workspaceJobDisplayName(job: RunWorkspaceJob): string {
  return job.name ?? job.key;
}

function workspaceJobDisplayStatus(job: RunWorkspaceJob) {
  if ('defaultExecution' in job) return job.displayStatus;
  return deriveJobDisplayStatus({...job, jobExecutions: []});
}

function workspaceJobDuration(job: RunWorkspaceJob) {
  if ('defaultExecution' in job) return job.displayDuration;
  return null;
}

function compareJobs(left: RunWorkspaceJob, right: RunWorkspaceJob): number {
  return left.position - right.position || left.id.localeCompare(right.id);
}
