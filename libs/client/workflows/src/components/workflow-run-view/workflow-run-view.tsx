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
import {Text} from '@shipfox/react-ui/typography';
import {useNavigate} from '@tanstack/react-router';
import {type ReactNode, useEffect, useMemo} from 'react';
import {buildRunAnnotationList, type RunAnnotationSummary} from '#core/run-annotation.js';
import {
  type EvaluationTraceEntry,
  isWorkflowRunTerminal,
  type Job,
  type WorkflowRunRerunMode,
} from '#core/workflow-run.js';
import {withoutWorkflowRunSelectionSearch} from '#core/workflow-run-url-state.js';
import {useRunAnnotationsQuery} from '#hooks/api/run-annotations.js';
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
import {
  type DerivedRunAnnotation,
  RunAnnotationList,
  RunAnnotationSummaryLine,
} from '../workflow-run-tabs/index.js';
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
  activeJobId,
  jobSearch,
  jobContent,
}: WorkflowRunViewProps) {
  const runQuery = useWorkflowRunAttemptQuery({
    workflowRunId,
    runAttempt: selection?.runAttempt ?? runAttempt,
  });
  const rerunMutation = useRerunWorkflowRunMutation(projectId);
  // Annotations are read on their own cadence rather than hydrated into the run, so the two
  // modules stay decoupled. The key is shared, so the job page's count chip costs no extra fetch.
  //
  // Polling is scoped to the surface that renders bodies. The read has no counts-only mode, so
  // every poll transfers whole Markdown bodies; doing that every four seconds behind Summary,
  // Source, and the job log spends megabytes to keep one rail number warm. Off that surface the
  // counts still refresh on navigation and on window focus.
  const annotationsQuery = useRunAnnotationsQuery({
    workflowRunId,
    runAttempt: runQuery.data?.runAttempt.attempt,
    live:
      runWorkspaceSection(tab) === 'annotations' &&
      !activeJobId &&
      Boolean(runQuery.data) &&
      !isWorkflowRunTerminal(runQuery.data?.runAttempt.status ?? 'pending'),
  });

  return (
    <RelativeTimeProvider>
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <RunViewContent
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          query={runQuery}
          annotations={annotationsQuery}
          rerunMutation={rerunMutation}
          runAttempt={runAttempt}
          selection={selection}
          tab={tab}
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
  annotations,
  rerunMutation,
  runAttempt,
  selection,
  tab,
  activeJobId,
  jobSearch,
  jobContent,
}: {
  workspaceSlug: string | undefined;
  projectSlug: string | undefined;
  query: ReturnType<typeof useWorkflowRunAttemptQuery>;
  annotations: ReturnType<typeof useRunAnnotationsQuery>;
  rerunMutation: ReturnType<typeof useRerunWorkflowRunMutation>;
  runAttempt: number | undefined;
  selection: WorkflowRunsSearch | undefined;
  tab: WorkflowRunTab | undefined;
  activeJobId: string | undefined;
  jobSearch: WorkflowJobSearch | undefined;
  jobContent: ReactNode | undefined;
}) {
  const navigate = useNavigate();
  const runData = query.data;
  const annotationSummary = annotations.summary;
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

  function clearAnnotationFilters() {
    if (!runData || !workspaceSlug || !projectSlug) return;
    const nextSearch: WorkflowRunsSearch = {...selection, tab: 'annotations'};
    delete nextSearch.jobId;
    delete nextSearch.jobExecutionId;
    delete nextSearch.stepId;
    delete nextSearch.stepAttemptId;
    delete nextSearch.severity;
    delete nextSearch.annotation;

    void navigate({
      to: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId',
      params: {workspaceSlug, projectSlug, workflowRunId: runData.id},
      search: workflowRunSearchParams(nextSearch, nextSearch) as never,
      replace: true,
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

        <div data-run-workspace-content className="flex min-h-0 min-w-0 flex-1 flex-col">
          {runData && jobContent ? (
            jobContent
          ) : runData ? (
            <RunSectionContent
              section={activeSection}
              run={runData}
              annotations={annotations}
              annotationSummary={annotationSummary}
              workspaceSlug={workspaceSlug}
              projectSlug={projectSlug}
              selection={selection}
              selectedJobId={selection?.jobId}
              onSelectGraphJob={selectGraphJob}
              onSelectAnnotationJob={selectAnnotationJob}
              onClearAnnotationFilters={clearAnnotationFilters}
              sourceSnapshot={sourceSnapshot}
              highlightedLineRange={highlightedLineRange}
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-auto p-panel">{loadingOrError}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function RunSectionContent({
  section,
  run,
  annotations,
  annotationSummary,
  workspaceSlug,
  projectSlug,
  selection,
  selectedJobId,
  onSelectGraphJob,
  onSelectAnnotationJob,
  onClearAnnotationFilters,
  sourceSnapshot,
  highlightedLineRange,
}: {
  section: RunWorkspaceSection;
  run: NonNullable<ReturnType<typeof useWorkflowRunAttemptQuery>['data']>;
  annotations: ReturnType<typeof useRunAnnotationsQuery>;
  annotationSummary: RunAnnotationSummary | undefined;
  workspaceSlug: string | undefined;
  projectSlug: string | undefined;
  selection: WorkflowRunsSearch | undefined;
  selectedJobId: string | undefined;
  onSelectGraphJob: (jobId: string | undefined, source?: JobGraphSelectionSource) => void;
  onSelectAnnotationJob: (jobId: string | undefined) => void;
  onClearAnnotationFilters: () => void;
  sourceSnapshot: NonNullable<
    ReturnType<typeof useWorkflowRunAttemptQuery>['data']
  >['sourceSnapshot'];
  highlightedLineRange: NonNullable<
    ReturnType<typeof useWorkflowRunAttemptQuery>['data']
  >['jobs'][number]['jobExecutions'][number]['steps'][number]['sourceLocation'];
}) {
  if (section === 'summary') {
    return (
      <section
        aria-label="All jobs summary"
        className="min-h-0 flex-1 overflow-auto pb-panel pt-[16px]"
      >
        <div className="mx-auto flex w-full flex-col gap-group px-frame">
          <Text as="h2" className="sr-only">
            All jobs summary
          </Text>
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
    return (
      <RunAnnotationsSection
        run={run}
        annotations={annotations}
        annotationSummary={annotationSummary}
        workspaceSlug={workspaceSlug}
        projectSlug={projectSlug}
        selection={selection}
        selectedJobId={selectedJobId}
        onSelectAnnotationJob={onSelectAnnotationJob}
        onClearAnnotationFilters={onClearAnnotationFilters}
      />
    );
  }

  return (
    <section
      aria-label="Workflow source"
      className="min-h-0 flex-1 overflow-auto pb-panel pt-[16px]"
    >
      <div className="mx-auto flex min-h-full w-full flex-col px-frame">
        <Text as="h2" className="sr-only">
          Workflow source
        </Text>
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

function RunAnnotationsSection({
  run,
  annotations,
  annotationSummary,
  workspaceSlug,
  projectSlug,
  selection,
  selectedJobId,
  onSelectAnnotationJob,
  onClearAnnotationFilters,
}: {
  run: NonNullable<ReturnType<typeof useWorkflowRunAttemptQuery>['data']>;
  annotations: ReturnType<typeof useRunAnnotationsQuery>;
  annotationSummary: RunAnnotationSummary | undefined;
  workspaceSlug: string | undefined;
  projectSlug: string | undefined;
  selection: WorkflowRunsSearch | undefined;
  selectedJobId: string | undefined;
  onSelectAnnotationJob: (jobId: string | undefined) => void;
  onClearAnnotationFilters: () => void;
}) {
  const selectedJob = run.jobs.find((job) => job.id === selectedJobId);
  const severity = selection?.severity;
  const records = annotations.annotations;

  const entries = useMemo(
    () =>
      records
        ? buildRunAnnotationList({
            annotations: records,
            jobs: run.jobs,
            severity,
            jobId: selectedJob?.id,
          })
        : undefined,
    [records, run.jobs, selectedJob?.id, severity],
  );
  const derivedAnnotations = useMemo<readonly DerivedRunAnnotation[] | undefined>(() => {
    if (!records) return undefined;
    const jobsWithAnnotations = new Set(records.map((annotation) => annotation.jobId));

    return run.jobs
      .filter((job) => {
        const style = job.status === 'failed' ? 'error' : 'warning';
        return (
          (!selectedJob || selectedJob.id === job.id) &&
          !jobsWithAnnotations.has(job.id) &&
          (job.status === 'failed' || job.status === 'skipped') &&
          job.jobExecutions.length === 0 &&
          matchesDerivedAnnotationFilters(style, selection)
        );
      })
      .map((job) => ({
        id: `derived-${job.id}`,
        style: job.status === 'failed' ? 'error' : 'warning',
        body: derivedJobAnnotation(job),
      }));
  }, [records, run.jobs, selectedJob, selection]);
  const hasSynthesizedJobAnnotations = run.jobs.some(
    (job) =>
      (job.status === 'failed' || job.status === 'skipped') && job.jobExecutions.length === 0,
  );

  return (
    <section
      aria-label="Run annotations"
      className="min-h-0 flex-1 overflow-auto pb-panel pt-[16px]"
    >
      <div className="mx-auto flex w-full flex-col gap-group px-frame">
        <Text as="h2" className="sr-only">
          Annotations
        </Text>
        <div className="flex flex-wrap items-center justify-between gap-inline">
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
        <RunAnnotationList
          // Remounting on a filter or run-attempt change resets the render window, so the next
          // list never inherits a "show more" position from different data.
          key={`${run.id}:${run.runAttempt.attempt}:${severity ?? 'all'}:${selectedJob?.id ?? 'all'}`}
          query={annotations.query}
          entries={entries}
          derivedAnnotations={derivedAnnotations}
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          workflowRunId={run.id}
          runAttempt={run.runAttempt.attempt}
          // A run with no annotations at all offers no filter to clear, whatever the URL says.
          filtered={Boolean(
            (severity || selectedJob || selection?.annotation) &&
              ((annotationSummary?.total ?? 0) > 0 || hasSynthesizedJobAnnotations),
          )}
          filteredJobName={selectedJob?.displayName}
          filteredSeverity={severity}
          onClearFilters={onClearAnnotationFilters}
          selectedAnnotationId={selection?.annotation}
        />
      </div>
    </section>
  );
}

function matchesDerivedAnnotationFilters(
  style: 'warning' | 'error',
  selection: WorkflowRunsSearch | undefined,
): boolean {
  if (selection?.severity && style !== selection.severity) return false;
  // A selected annotation is a deep-link to a real annotation record. Synthetic diagnostics
  // have no id or context, so they must not remain visible behind that selection.
  return !selection?.annotation;
}

function derivedJobAnnotation(job: Job): string {
  const reason = job.statusReason ? `Reason: \`${job.statusReason}\`` : null;
  const traceSummary = formatConditionEvaluation(job.evaluationTrace);
  const details = [reason, traceSummary].filter(Boolean).join('\n');

  if (job.status === 'skipped') {
    return [
      `**${job.displayName}** was skipped before an execution was created.`,
      '',
      'Review its dependencies or condition before re-running.',
      details,
    ]
      .filter(Boolean)
      .join('\n');
  }
  return [
    `**${job.displayName}** failed before an execution was created.`,
    '',
    'Check runner availability and workflow configuration before re-running.',
    details,
  ]
    .filter(Boolean)
    .join('\n');
}

function formatConditionEvaluation(
  trace: readonly EvaluationTraceEntry[] | null | undefined,
): string | null {
  if (!trace?.length) return null;

  return [
    'Condition evaluation:',
    ...trace.map((entry) => {
      if ('dropped' in entry) {
        return `- ${entry.dropped} additional evaluation${entry.dropped === 1 ? '' : 's'} not recorded`;
      }
      const value =
        entry.value === undefined || entry.value === '' ? '(empty)' : `\`${entry.value}\``;
      return `- \`${entry.field}\` evaluated \`${entry.expression}\` to ${value}${entry.degraded ? ' (degraded)' : ''}`;
    }),
  ].join('\n');
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
      className="hidden w-240 shrink-0 border-r border-border-neutral-base bg-background-subtle-base p-panel-compact min-[768px]:block"
    >
      <div className="flex flex-col gap-group">
        <div className="h-32 rounded-4 bg-background-components-subtle" />
        <div className="flex flex-col gap-inline">
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
