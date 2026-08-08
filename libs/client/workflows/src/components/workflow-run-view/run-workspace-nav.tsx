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
  defaultJobExecution,
  deriveJobDisplayStatus,
  type Job,
  type WorkflowRunDetail,
} from '#core/workflow-run.js';
import {
  type WorkflowJobSearch,
  type WorkflowRunTab,
  workflowJobSearchParams,
  workflowRunSearchParams,
} from '#routes/inputs.js';
import {JobExecutionTimeText} from '../job-detail/job-execution-time-text.js';

type RunWorkspaceSection = Exclude<WorkflowRunTab, 'jobs'>;

export interface RunWorkspaceNavProps {
  workspaceSlug: string;
  projectSlug: string;
  run: WorkflowRunDetail;
  activeSection: RunWorkspaceSection;
  currentJobId?: string | undefined;
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
  jobSearch = {},
  annotationSummary,
}: RunWorkspaceNavProps) {
  const jobs = useMemo(() => [...run.jobs].sort(compareJobs), [run.jobs]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const currentJob = jobs.find((job) => job.id === currentJobId);
  const currentLabel = currentJob?.displayName ?? sectionLabel(activeSection);

  return (
    <TimeTickerProvider intervalMs={1000} reducedMotionIntervalMs={10_000}>
      <aside className="flex min-h-0 w-full shrink-0 flex-col border-b border-border-neutral-base bg-background-neutral-background min-[768px]:w-240 min-[768px]:border-b-0 min-[768px]:border-r">
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
              activeSection={activeSection}
              currentJobId={currentJobId}
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
  activeSection,
  currentJobId,
  jobSearch,
  annotationSummary,
  mobileOpen,
  onNavigate,
}: RunWorkspaceNavProps & {
  jobs: Job[];
  jobSearch: WorkflowJobSearch;
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
    <nav aria-label="Run workspace" className="flex min-h-0 min-w-0 flex-1 flex-col gap-group">
      <ul>
        <li>
          <RunSectionLink
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
            runId={run.id}
            runAttempt={runAttempt}
            section="summary"
            current={!currentJobId && activeSection === 'summary'}
            onNavigate={onNavigate}
          />
        </li>
      </ul>

      <section
        aria-labelledby="run-workspace-jobs-heading"
        className="flex min-h-0 min-w-0 flex-1 flex-col"
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
            {jobs.length}
          </Text>
        </div>
        <ol className="min-h-0 flex-1 overflow-y-auto scrollbar">
          {jobs.map((job) => {
            const current = job.id === currentJobId;
            const execution = defaultJobExecution(job);
            const duration = execution?.displayDuration ?? job.displayDuration;

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
                    'flex min-h-32 min-w-0 items-center gap-inline rounded-4 px-tight text-left outline-none transition-colors hover:bg-background-neutral-hover focus-visible:shadow-border-interactive-with-active @max-[767px]:min-h-44 [@media(pointer:coarse)]:min-h-44',
                    current && 'bg-background-neutral-hover',
                  )}
                >
                  <WorkflowStatusIcon
                    status={deriveJobDisplayStatus(job)}
                    size={12}
                    tooltip={false}
                  />
                  <span className="min-w-0 truncate font-code text-xs leading-20 text-foreground-neutral-base">
                    {job.displayName}
                  </span>
                  <span className="ml-auto shrink-0 font-code text-xs leading-20 text-foreground-neutral-muted tabular-nums">
                    {duration ? <JobExecutionTimeText time={duration} /> : '—'}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="run-workspace-details-heading">
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
              current={!currentJobId && activeSection === 'annotations'}
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
              current={!currentJobId && activeSection === 'source'}
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
        'flex min-h-32 items-center gap-inline rounded-4 px-tight text-xs font-medium text-foreground-neutral-base outline-none transition-colors hover:bg-background-neutral-hover focus-visible:shadow-border-interactive-with-active @max-[767px]:min-h-44 [@media(pointer:coarse)]:min-h-44',
        current && 'bg-background-neutral-hover',
      )}
    >
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

function sectionLabel(section: RunWorkspaceSection): string {
  if (section === 'annotations') return 'Annotations';
  if (section === 'source') return 'Source';
  return 'Summary';
}

function compareJobs(left: Job, right: Job): number {
  return left.position - right.position || left.id.localeCompare(right.id);
}
