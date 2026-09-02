import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {Panel, PanelBody, PanelHeader} from '@shipfox/react-ui/panel';
import {Text} from '@shipfox/react-ui/typography';
import {Link} from '@tanstack/react-router';
import {useMemo} from 'react';
import type {
  WorkflowRunOverview,
  WorkflowRunOverviewJob,
  WorkflowRunOverviewLargeJobs,
} from '#core/workflow-run.js';
import {useWorkflowRunOverviewJobsInfiniteQuery} from '#hooks/api/workflow-run-overview.js';
import {workflowJobSearchParams} from '#routes/inputs.js';
import {JobExecutionTimeText} from '../job-detail/job-execution-time-text.js';
import {WorkflowStatusIcon} from '../workflow-status/workflow-status-icon.js';

export interface WorkflowRunLargeJobsProps {
  run: WorkflowRunOverview;
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
}

type LargeWorkflowRunOverview = Omit<WorkflowRunOverview, 'jobs'> & {
  jobs: WorkflowRunOverviewLargeJobs;
};

/**
 * The honest large-workflow surface. The overview deliberately withholds dependency edges, so
 * this list never tries to reconstruct a partial graph from the first page.
 */
export function WorkflowRunLargeJobs({run, workspaceSlug, projectSlug}: WorkflowRunLargeJobsProps) {
  if (run.jobs.kind !== 'large') return null;

  return (
    <WorkflowRunLargeJobsContent
      run={run as LargeWorkflowRunOverview}
      workspaceSlug={workspaceSlug}
      projectSlug={projectSlug}
    />
  );
}

function WorkflowRunLargeJobsContent({
  run,
  workspaceSlug,
  projectSlug,
}: Omit<WorkflowRunLargeJobsProps, 'run'> & {run: LargeWorkflowRunOverview}) {
  const initialPage = run.jobs.firstPage;
  const jobsQuery = useWorkflowRunOverviewJobsInfiniteQuery({
    workflowRunId: run.id,
    runAttempt: run.runAttempt.attempt,
    initialPage,
  });
  const jobs = useMemo(
    () => jobsQuery.data?.pages.flatMap((page) => page.items) ?? initialPage.items,
    [initialPage.items, jobsQuery.data?.pages],
  );

  return (
    <section
      aria-label="Large workflow jobs"
      className="min-h-0 flex-1 overflow-auto pb-panel pt-panel-compact"
    >
      <div className="flex w-full flex-col">
        <Panel>
          <PanelHeader className="flex-wrap items-start gap-inline">
            <div className="min-w-0 flex-1">
              <Text as="h2" size="sm" bold>
                Workflow jobs
              </Text>
              <Text as="p" size="xs" className="mt-tight text-foreground-neutral-muted">
                This workflow is too large for a complete dependency graph. Browse its{' '}
                {run.jobs.total} jobs here instead.
              </Text>
            </div>
          </PanelHeader>
          {jobsQuery.isError ? (
            <div className="px-panel-compact pt-panel-compact">
              <Callout role="alert" type="error">
                <div className="flex items-center justify-between gap-inline">
                  <Text size="xs">Could not load more workflow jobs.</Text>
                  <Button
                    type="button"
                    size="2xs"
                    variant="secondary"
                    isLoading={jobsQuery.isFetching}
                    onClick={() => void jobsQuery.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              </Callout>
            </div>
          ) : null}
          <PanelBody className="p-0">
            <ul className="divide-y divide-border-neutral-base">
              {jobs.map((job) => (
                <LargeWorkflowJobRow
                  key={job.id}
                  job={job}
                  workflowRunId={run.id}
                  workspaceSlug={workspaceSlug}
                  projectSlug={projectSlug}
                  runAttempt={run.runAttempt.attempt}
                />
              ))}
            </ul>
            {jobsQuery.hasNextPage ? (
              <div className="flex justify-center border-t border-border-neutral-base p-panel-compact">
                <Button
                  type="button"
                  size="2xs"
                  variant="secondary"
                  isLoading={jobsQuery.isFetchingNextPage}
                  disabled={jobsQuery.isFetchingNextPage}
                  onClick={() => void jobsQuery.fetchNextPage()}
                >
                  Load more jobs
                </Button>
              </div>
            ) : null}
          </PanelBody>
        </Panel>
      </div>
    </section>
  );
}

function LargeWorkflowJobRow({
  job,
  workflowRunId,
  workspaceSlug,
  projectSlug,
  runAttempt,
}: {
  job: WorkflowRunOverviewJob;
  workflowRunId: string;
  workspaceSlug: string | undefined;
  projectSlug: string | undefined;
  runAttempt: number;
}) {
  const content = (
    <>
      <WorkflowStatusIcon status={job.displayStatus} size={14} tooltip={false} />
      <span className="min-w-0 flex-1 truncate font-code text-xs text-foreground-neutral-base">
        {job.displayName}
      </span>
      {job.executionCountVisible ? (
        <span className="shrink-0 font-code text-xs tabular-nums text-foreground-neutral-muted">
          {job.executionCount}
        </span>
      ) : null}
      <span className="w-72 shrink-0 text-right font-code text-xs tabular-nums text-foreground-neutral-muted">
        {job.displayDuration ? <JobExecutionTimeText time={job.displayDuration} /> : '—'}
      </span>
    </>
  );
  const className =
    'flex min-h-40 w-full items-center gap-inline px-row py-tight text-left transition-colors hover:bg-background-neutral-hover focus-visible:shadow-focus-inset focus-visible:outline-none';

  return (
    <li>
      {workspaceSlug && projectSlug ? (
        <Link
          to="/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId/jobs/$jobId"
          params={{workspaceSlug, projectSlug, workflowRunId, jobId: job.id}}
          search={workflowJobSearchParams({runAttempt}) as never}
          className={className}
        >
          {content}
        </Link>
      ) : (
        <div className={className}>{content}</div>
      )}
    </li>
  );
}
