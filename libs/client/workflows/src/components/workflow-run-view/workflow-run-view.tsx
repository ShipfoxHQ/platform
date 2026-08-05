import {ApiError} from '@shipfox/client-api';
import {QueryLoadError} from '@shipfox/client-ui';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {RelativeTimeProvider} from '@shipfox/react-ui/relative-time';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shipfox/react-ui/select';
import {toast} from '@shipfox/react-ui/toast';
import {useNavigate} from '@tanstack/react-router';
import {type ReactNode, useEffect} from 'react';
import type {Job, WorkflowRunRerunMode} from '#core/workflow-run.js';
import type {RunAnnotationSummary} from '#core/workflow-run-tabs.js';
import {withoutWorkflowRunSelectionSearch} from '#core/workflow-run-url-state.js';
import {
  useCancelWorkflowRunMutation,
  useRerunWorkflowRunMutation,
  useWorkflowRunAttemptQuery,
} from '#hooks/api/workflow-runs.js';
import {
  type WorkflowJobSearch,
  type WorkflowRunsSearch,
  type WorkflowRunTab,
  workflowJobSearchParams,
  workflowRunSearchParams,
} from '#routes/inputs.js';
import {JobGraph} from '../job-graph/index.js';
import type {JobGraphSelectionSource} from '../job-graph/types.js';
import {WorkflowRunSummary} from '../workflow-run-summary/index.js';
import {RunAnnotationSummaryLine, RunAnnotationsEmpty} from '../workflow-run-tabs/index.js';
import {WorkflowSourceContent} from '../workflow-source-panel/index.js';
import {RunWorkspaceNav} from './run-workspace-nav.js';
import {resolveWorkflowRunSelection} from './workflow-run-selection.js';
import {
  WorkflowRunContentSkeleton,
  WorkflowRunNotFound,
  WorkflowRunSkeleton,
  WorkflowRunStaleError,
} from './workflow-run-states.js';

type RunWorkspaceSection = Exclude<WorkflowRunTab, 'jobs'>;

export interface WorkflowRunViewProps {
  projectId: string;
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
  workflowRunId?: string | undefined;
  runAttempt?: number | undefined;
  selection?: WorkflowRunsSearch | undefined;
  tab?: WorkflowRunTab | undefined;
  annotationSummary?: RunAnnotationSummary | undefined;
  activeJobId?: string | undefined;
  jobSearch?: WorkflowJobSearch | undefined;
  jobContent?: ReactNode | undefined;
}

/**
 * The persistent run workspace. Run-level sections and dedicated job routes share the same
 * header and job index, while the all-jobs Summary always opens on the dependency graph.
 */
export function WorkflowRunView({
  projectId,
  workspaceSlug,
  projectSlug,
  workflowRunId,
  runAttempt,
  selection,
  tab,
  annotationSummary,
  activeJobId,
  jobSearch,
  jobContent,
}: WorkflowRunViewProps) {
  const runQuery = useWorkflowRunAttemptQuery({
    workflowRunId,
    runAttempt: selection?.runAttempt ?? runAttempt,
  });
  const rerunMutation = useRerunWorkflowRunMutation(projectId);

  return (
    <RelativeTimeProvider>
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <RunViewContent
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          query={runQuery}
          rerunMutation={rerunMutation}
          runAttempt={runAttempt}
          selection={selection}
          tab={tab}
          annotationSummary={annotationSummary}
          activeJobId={activeJobId}
          jobSearch={jobSearch}
          jobContent={jobContent}
        />
      </div>
    </RelativeTimeProvider>
  );
}

function RunViewContent({
  workspaceSlug,
  projectSlug,
  query,
  rerunMutation,
  runAttempt,
  selection,
  tab,
  annotationSummary,
  activeJobId,
  jobSearch,
  jobContent,
}: {
  workspaceSlug: string | undefined;
  projectSlug: string | undefined;
  query: ReturnType<typeof useWorkflowRunAttemptQuery>;
  rerunMutation: ReturnType<typeof useRerunWorkflowRunMutation>;
  runAttempt: number | undefined;
  selection: WorkflowRunsSearch | undefined;
  tab: WorkflowRunTab | undefined;
  annotationSummary: RunAnnotationSummary | undefined;
  activeJobId: string | undefined;
  jobSearch: WorkflowJobSearch | undefined;
  jobContent: ReactNode | undefined;
}) {
  const navigate = useNavigate();
  const runData = query.data;
  const activeSection = runWorkspaceSection(tab);
  const cancelMutation = useCancelWorkflowRunMutation(runData);
  const sourceSnapshot = runData?.sourceSnapshot ?? null;
  const resolvedSelection =
    runData && selection ? resolveWorkflowRunSelection({run: runData, selection}) : undefined;
  const highlightedLineRange = resolvedSelection?.step?.sourceLocation ?? null;

  useEffect(() => {
    const hasLegacyJobSelection = Boolean(
      selection?.jobId ||
        selection?.jobExecutionId ||
        selection?.stepId ||
        selection?.stepAttemptId,
    );
    if (
      activeJobId ||
      activeSection !== 'summary' ||
      !hasLegacyJobSelection ||
      !resolvedSelection?.job ||
      !runData ||
      !workspaceSlug ||
      !projectSlug
    ) {
      return;
    }

    void navigate({
      to: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId/jobs/$jobId',
      params: {
        workspaceSlug,
        projectSlug,
        workflowRunId: runData.id,
        jobId: resolvedSelection.job.id,
      },
      search: workflowJobSearchParams({
        jobExecutionId: selection?.jobExecutionId,
        stepId: selection?.stepId,
        stepAttemptId: selection?.stepAttemptId,
        runAttempt: selection?.runAttempt,
      }) as never,
      replace: true,
    });
  }, [
    activeJobId,
    activeSection,
    navigate,
    projectSlug,
    resolvedSelection?.job,
    runData,
    selection,
    workspaceSlug,
  ]);

  async function rerun(mode: WorkflowRunRerunMode) {
    if (!runData || !workspaceSlug || !projectSlug) {
      toast.error('Could not start re-run from this route.');
      return;
    }
    try {
      const run = await rerunMutation.mutateAsync({workflowRunId: runData.id, mode});
      toast.success('Re-run started');
      await navigate({
        to: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId',
        params: {workspaceSlug, projectSlug, workflowRunId: run.id},
        search: ((previous: Record<string, unknown>) =>
          withoutWorkflowRunSelectionSearch(previous)) as never,
      });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not start re-run');
    }
  }

  function selectGraphJob(jobId: string | undefined, source: JobGraphSelectionSource = 'pointer') {
    if (source !== 'pointer' || !jobId || !runData || !workspaceSlug || !projectSlug) return;

    void navigate({
      to: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId/jobs/$jobId',
      params: {workspaceSlug, projectSlug, workflowRunId: runData.id, jobId},
      search: workflowJobSearchParams({
        runAttempt: selection?.runAttempt ?? runAttempt ?? runData.runAttempt.attempt,
      }) as never,
    });
  }

  function selectAnnotationJob(jobId: string | undefined) {
    if (!runData || !workspaceSlug || !projectSlug) return;
    const nextSearch: WorkflowRunsSearch = {...selection, tab: 'annotations'};
    if (jobId) nextSearch.jobId = jobId;
    else delete nextSearch.jobId;
    delete nextSearch.jobExecutionId;
    delete nextSearch.stepId;
    delete nextSearch.stepAttemptId;

    void navigate({
      to: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId',
      params: {workspaceSlug, projectSlug, workflowRunId: runData.id},
      search: workflowRunSearchParams(nextSearch, nextSearch) as never,
    });
  }

  function cancelRun() {
    cancelMutation.mutate(undefined, {
      onError: (error) => toast.error(cancelErrorMessage(error)),
    });
  }

  const fatalError = query.isError && runData === undefined;
  const loadingOrError = fatalError ? (
    query.error instanceof ApiError && query.error.status === 404 ? (
      <WorkflowRunNotFound />
    ) : (
      <QueryLoadError query={query} subject="workflow run" icon="pulseLine" />
    )
  ) : query.isPending || runData === undefined ? (
    <WorkflowRunContentSkeleton />
  ) : null;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {runData ? (
        <WorkflowRunSummary
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          run={runData}
          cancelling={cancelMutation.isPending}
          onCancel={cancelRun}
          rerunPending={rerunMutation.isPending}
          onRerun={(mode) => void rerun(mode)}
          latestAttempt={runData.latestAttempt}
        />
      ) : (
        <WorkflowRunSkeleton />
      )}
      {runData && query.isError ? <WorkflowRunStaleError query={query} /> : null}

      <div
        data-run-workspace-layout
        className="flex min-h-0 min-w-0 flex-1 flex-col border-t border-border-neutral-base min-[768px]:flex-row"
      >
        {runData && workspaceSlug && projectSlug ? (
          <RunWorkspaceNav
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
            run={runData}
            activeSection={activeSection}
            currentJobId={activeJobId}
            jobSearch={jobSearch}
            annotationSummary={annotationSummary}
          />
        ) : (
          <RunWorkspaceNavSkeleton />
        )}

        <div
          data-run-workspace-content
          className="flex min-h-0 min-w-0 flex-1 flex-col bg-background-neutral-base"
        >
          {runData && jobContent ? (
            jobContent
          ) : runData ? (
            <RunSectionContent
              section={activeSection}
              run={runData}
              annotationSummary={annotationSummary}
              workspaceSlug={workspaceSlug}
              projectSlug={projectSlug}
              selection={selection}
              selectedJobId={selection?.jobId}
              onSelectGraphJob={selectGraphJob}
              onSelectAnnotationJob={selectAnnotationJob}
              sourceSnapshot={sourceSnapshot}
              highlightedLineRange={highlightedLineRange}
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-auto p-24">{loadingOrError}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function RunSectionContent({
  section,
  run,
  annotationSummary,
  workspaceSlug,
  projectSlug,
  selection,
  selectedJobId,
  onSelectGraphJob,
  onSelectAnnotationJob,
  sourceSnapshot,
  highlightedLineRange,
}: {
  section: RunWorkspaceSection;
  run: NonNullable<ReturnType<typeof useWorkflowRunAttemptQuery>['data']>;
  annotationSummary: RunAnnotationSummary | undefined;
  workspaceSlug: string | undefined;
  projectSlug: string | undefined;
  selection: WorkflowRunsSearch | undefined;
  selectedJobId: string | undefined;
  onSelectGraphJob: (jobId: string | undefined, source?: JobGraphSelectionSource) => void;
  onSelectAnnotationJob: (jobId: string | undefined) => void;
  sourceSnapshot: NonNullable<
    ReturnType<typeof useWorkflowRunAttemptQuery>['data']
  >['sourceSnapshot'];
  highlightedLineRange: NonNullable<
    ReturnType<typeof useWorkflowRunAttemptQuery>['data']
  >['jobs'][number]['jobExecutions'][number]['steps'][number]['sourceLocation'];
}) {
  if (section === 'summary') {
    return (
      <section aria-label="All jobs summary" className="min-h-0 flex-1 overflow-auto pb-24 pt-16">
        <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-16 px-24">
          <JobGraph
            run={run}
            selectedJobId={selectedJobId}
            onSelectedJobChange={onSelectGraphJob}
            className="min-h-160 overflow-hidden"
          />
        </div>
      </section>
    );
  }

  if (section === 'annotations') {
    const selectedJob = run.jobs.find((job) => job.id === selectedJobId);
    return (
      <section aria-label="Run annotations" className="min-h-0 flex-1 overflow-auto pb-24 pt-16">
        <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-16 px-24">
          <div className="flex flex-wrap items-center justify-between gap-8">
            <RunAnnotationSummaryLine
              summary={annotationSummary}
              workspaceSlug={workspaceSlug}
              projectSlug={projectSlug}
              workflowRunId={run.id}
              search={selection}
            />
            <AnnotationJobFilter
              jobs={run.jobs}
              selectedJobId={selectedJob?.id}
              onSelect={onSelectAnnotationJob}
            />
          </div>
          <RunAnnotationsEmpty jobName={selectedJob?.displayName} />
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Workflow source" className="min-h-0 flex-1 overflow-auto pb-24 pt-16">
      <div className="mx-auto flex min-h-full w-full max-w-[1120px] px-24">
        {sourceSnapshot ? (
          <WorkflowSourceContent
            source={sourceSnapshot}
            highlightedLineRange={highlightedLineRange}
            scrollHighlightedIntoView
          />
        ) : (
          <EmptyState
            className="min-h-160 w-full"
            icon="fileDamageLine"
            title="Source snapshot unavailable"
            description={
              run.isTemporary
                ? 'Temporary runs do not capture workflow source.'
                : 'This run was created before workflow source snapshots were captured.'
            }
          />
        )}
      </div>
    </section>
  );
}

const ALL_ANNOTATION_JOBS = 'all-jobs';

function AnnotationJobFilter({
  jobs,
  selectedJobId,
  onSelect,
}: {
  jobs: Job[];
  selectedJobId: string | undefined;
  onSelect: (jobId: string | undefined) => void;
}) {
  const sortedJobs = [...jobs].sort(
    (left, right) => left.position - right.position || left.id.localeCompare(right.id),
  );

  return (
    <Select
      value={selectedJobId ?? ALL_ANNOTATION_JOBS}
      onValueChange={(value) => onSelect(value === ALL_ANNOTATION_JOBS ? undefined : value)}
    >
      <SelectTrigger
        size="small"
        aria-label="Filter annotations by job"
        className="w-full min-[480px]:w-240"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value={ALL_ANNOTATION_JOBS}>All jobs</SelectItem>
        {sortedJobs.map((job) => (
          <SelectItem key={job.id} value={job.id}>
            {job.displayName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function RunWorkspaceNavSkeleton() {
  return (
    <aside
      aria-label="Loading run navigation"
      className="hidden w-240 shrink-0 border-r border-border-neutral-base bg-background-neutral-background p-12 min-[768px]:block"
    >
      <div className="flex flex-col gap-16">
        <div className="h-32 rounded-4 bg-background-components-subtle" />
        <div className="flex flex-col gap-6">
          <div className="h-16 w-64 rounded-4 bg-background-components-subtle" />
          <div className="h-32 rounded-4 bg-background-components-subtle" />
          <div className="h-32 rounded-4 bg-background-components-subtle" />
        </div>
      </div>
    </aside>
  );
}

function runWorkspaceSection(tab: WorkflowRunTab | undefined): RunWorkspaceSection {
  return tab === 'annotations' || tab === 'source' ? tab : 'summary';
}

function cancelErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === 'run-already-finished') {
    return 'This workflow run has already finished.';
  }
  return 'Could not cancel workflow run.';
}
