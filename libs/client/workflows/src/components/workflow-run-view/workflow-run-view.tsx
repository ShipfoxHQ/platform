import {ApiError} from '@shipfox/client-api';
import {QueryLoadError} from '@shipfox/client-ui';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Panel, PanelBody, PanelHeader} from '@shipfox/react-ui/panel';
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
import {type ReactNode, useEffect, useMemo, useRef, useState} from 'react';
import {buildRunAnnotationList, type RunAnnotationSummary} from '#core/run-annotation.js';
import {
  type EvaluationTraceEntry,
  isWorkflowRunTerminal,
  type Job,
  type StepSourceLocation,
  type WorkflowRunDetail,
  type WorkflowRunOverview,
  type WorkflowRunOverviewJob,
  type WorkflowRunRerunMode,
  type WorkflowRunSource,
} from '#core/workflow-run.js';
import {withoutWorkflowRunSelectionSearch} from '#core/workflow-run-url-state.js';
import {useWorkflowRunAnnotationSummaryQuery} from '#hooks/api/annotations.js';
import {useRunAnnotationsQuery} from '#hooks/api/run-annotations.js';
import {toWorkflowRunLineageHeadFromRecord} from '#hooks/api/workflow-run-mapper.js';
import {
  useWorkflowRunLineageHeadQuery,
  useWorkflowRunOverviewQuery,
  useWorkflowRunSourceQuery,
} from '#hooks/api/workflow-run-overview.js';
import {useWorkflowRunSelectionQuery} from '#hooks/api/workflow-run-selection.js';
import {
  useCancelWorkflowRunMutation,
  useRerunWorkflowRunMutation,
  useWorkflowRunAttemptQuery,
  useWorkflowRunListItem,
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
import {WorkflowRunLargeJobs} from './workflow-run-large-jobs.js';
import {resolveWorkflowRunSelection} from './workflow-run-selection.js';
import {
  WorkflowRunContentSkeleton,
  WorkflowRunNewerAttemptBanner,
  WorkflowRunNotFound,
  WorkflowRunSkeleton,
  WorkflowRunStaleError,
} from './workflow-run-states.js';

type RunWorkspaceSection = Exclude<WorkflowRunTab, 'jobs'>;
type WorkflowRunShell =
  | NonNullable<ReturnType<typeof useWorkflowRunListItem>>
  | WorkflowRunOverview
  | WorkflowRunDetail;

export interface WorkflowRunViewProps {
  projectId: string;
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
  workflowRunId?: string | undefined;
  runAttempt?: number | undefined;
  selection?: WorkflowRunsSearch | undefined;
  tab?: WorkflowRunTab | undefined;
  activeJobId?: string | undefined;
  activeJob?: WorkflowRunOverviewJob | undefined;
  jobSearch?: WorkflowJobSearch | undefined;
  jobContent?: ReactNode | undefined;
  /** Run-level legacy bridge data, retained only for mixed-deployment run sections. */
  legacyQuery?: ReturnType<typeof useWorkflowRunAttemptQuery> | undefined;
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
  activeJob,
  jobSearch,
  jobContent,
  legacyQuery: providedLegacyQuery,
}: WorkflowRunViewProps) {
  const activeSection = runWorkspaceSection(tab);
  const routeAttempt = selection?.runAttempt ?? runAttempt;
  const [pinnedAttempt, setPinnedAttempt] = useState<
    {workflowRunId: string; attempt: number} | undefined
  >();
  const explicitAttempt = routeAttempt ?? pinnedWorkflowRunAttempt(pinnedAttempt, workflowRunId);
  const hasLegacyJobSelection = containsLegacyJobSelection(selection);

  useEffect(() => {
    if (routeAttempt !== undefined) setPinnedAttempt(undefined);
  }, [routeAttempt]);

  const listRun = useWorkflowRunListItem(workflowRunId);
  const initialHead = workflowRunLineageHeadSeed(listRun);
  const headQuery = useWorkflowRunLineageHeadQuery({
    workflowRunId,
    initialData: initialHead,
  });
  const selectionQuery = useWorkflowRunSelectionQuery({
    workflowRunId,
    runAttempt: explicitAttempt,
    jobId: selection?.jobId,
    jobExecutionId: selection?.jobExecutionId,
    stepId: selection?.stepId,
    stepAttemptId: selection?.stepAttemptId,
    enabled: shouldResolveLegacySelection(hasLegacyJobSelection, activeJobId),
  });
  // A list row is a safe stale seed for the overview. A direct URL without an attempt waits for
  // the head/selection resolver and is pinned in route state before this query is enabled.
  const overviewAttempt = workflowRunOverviewAttempt({
    explicitAttempt,
    hasLegacyJobSelection,
    listAttempt: listRun?.currentAttempt,
    selectionAttempt: selectionQuery.data?.workflowRunAttempt,
    selectionQueryIsError: selectionQuery.isError,
    headAttempt: headQuery.data?.currentAttempt,
    headResolved: !headQuery.isPending && !headQuery.isFetching && !headQuery.isError,
  });
  const overviewQuery = useWorkflowRunOverviewQuery({
    workflowRunId,
    runAttempt: overviewAttempt,
  });
  const overview = useMemo(() => {
    const data = overviewQuery.data;
    const head = headQuery.data;
    if (!data || !head) return data;
    return {...data, currentAttempt: head.currentAttempt, latestAttempt: head.latestAttempt};
  }, [headQuery.data, overviewQuery.data]);
  const sourceQuery = useWorkflowRunSourceQuery({
    workflowRunId,
    enabled: activeSection === 'source',
  });
  const legacyBridgeEnabled = shouldLoadLegacyBridge({
    activeJobId,
    activeSection,
    hasLegacyJobSelection,
    selectionQueryIsError: selectionQuery.isError,
  });
  const legacyBridgeQuery = useWorkflowRunAttemptQuery({
    workflowRunId,
    runAttempt: overviewAttempt,
    enabled: legacyBridgeEnabled && providedLegacyQuery === undefined,
    requestKind: 'bridge',
  });
  const legacyQuery = providedLegacyQuery ?? legacyBridgeQuery;
  const overviewStatus = overviewQuery.data?.runAttempt.status;
  const annotationSummaryQuery = useWorkflowRunAnnotationSummaryQuery(
    workflowRunId,
    overviewAttempt,
    undefined,
    {
      enabled: shouldLoadAnnotationSummary({workflowRunId, overviewAttempt, activeJobId}),
      polling: shouldPollRunAnnotations(activeSection, activeJobId, overviewStatus),
    },
  );
  const rerunMutation = useRerunWorkflowRunMutation(projectId);
  const annotationsQuery = useRunAnnotationsQuery({
    workflowRunId,
    runAttempt: overviewAttempt,
    enabled: shouldLoadRunAnnotations(activeSection, activeJobId),
    live: shouldLiveRunAnnotations(activeSection, activeJobId, overviewQuery.data, overviewStatus),
  });

  const navigate = useNavigate();
  usePinWorkflowRunAttempt({
    headQuery,
    navigate,
    onPin: setPinnedAttempt,
    routeAttempt,
    selectionQuery,
    waitForSelection: shouldResolveLegacySelection(hasLegacyJobSelection, activeJobId),
    workflowRunId,
  });
  useRefreshWorkflowRunHeadOnTerminal({headQuery, overviewStatus});

  return (
    <RelativeTimeProvider>
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <RunViewContent
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          headQuery={headQuery}
          overviewQuery={overviewQuery}
          overview={overview}
          sourceQuery={sourceQuery}
          listRun={listRun}
          legacyQuery={legacyQuery}
          annotations={annotationsQuery}
          annotationSummaryQuery={annotationSummaryQuery}
          rerunMutation={rerunMutation}
          runAttempt={overviewAttempt}
          selection={selection}
          tab={tab}
          activeJobId={activeJobId}
          activeJob={activeJob}
          jobSearch={jobSearch}
          jobContent={jobContent}
          selectionQuery={selectionQuery}
        />
      </div>
    </RelativeTimeProvider>
  );
}

function pinnedWorkflowRunAttempt(
  pinnedAttempt: {workflowRunId: string; attempt: number} | undefined,
  workflowRunId: string | undefined,
): number | undefined {
  if (!pinnedAttempt || pinnedAttempt.workflowRunId !== workflowRunId) return undefined;
  return pinnedAttempt.attempt;
}

function workflowRunLineageHeadSeed(listRun: ReturnType<typeof useWorkflowRunListItem>) {
  if (!listRun) return undefined;
  return toWorkflowRunLineageHeadFromRecord({
    currentAttempt: listRun.currentAttempt,
    latestAttempt: listRun.latestAttempt,
    status: listRun.status,
    updatedAt: listRun.updatedAt,
  });
}

function shouldResolveLegacySelection(
  hasLegacyJobSelection: boolean,
  activeJobId: string | undefined,
): boolean {
  return hasLegacyJobSelection && activeJobId === undefined;
}

function workflowRunOverviewAttempt({
  explicitAttempt,
  hasLegacyJobSelection,
  headAttempt,
  listAttempt,
  selectionAttempt,
  selectionQueryIsError,
  headResolved,
}: {
  explicitAttempt: number | undefined;
  hasLegacyJobSelection: boolean;
  headAttempt: number | undefined;
  listAttempt: number | undefined;
  selectionAttempt: number | undefined;
  selectionQueryIsError: boolean;
  headResolved: boolean;
}): number | undefined {
  if (explicitAttempt !== undefined) return explicitAttempt;
  if (!hasLegacyJobSelection) return headResolved ? (headAttempt ?? listAttempt) : undefined;
  if (selectionAttempt !== undefined) return selectionAttempt;
  return selectionQueryIsError && headResolved ? (headAttempt ?? listAttempt) : undefined;
}

function workflowRunShellForAttempt({
  overview,
  listRun,
  legacyRun,
  runAttempt,
}: {
  overview: WorkflowRunOverview | undefined;
  listRun: ReturnType<typeof useWorkflowRunListItem>;
  legacyRun: WorkflowRunDetail | undefined;
  runAttempt: number | undefined;
}): WorkflowRunShell | undefined {
  if (overview) return overview;
  if (listRun && (runAttempt === undefined || listRun.currentAttempt === runAttempt)) {
    return listRun;
  }
  if (legacyRun && (runAttempt === undefined || legacyRun.runAttempt.attempt === runAttempt)) {
    return legacyRun;
  }
  return undefined;
}

function workflowRunActionsReady({
  overview,
  runAttempt,
  headQuery,
}: {
  overview: WorkflowRunOverview | undefined;
  runAttempt: number | undefined;
  headQuery: ReturnType<typeof useWorkflowRunLineageHeadQuery>;
}): boolean {
  return Boolean(
    overview &&
      runAttempt !== undefined &&
      overview.runAttempt.attempt === runAttempt &&
      headQuery.data?.currentAttempt === runAttempt &&
      !headQuery.isPending &&
      !headQuery.isFetching &&
      !headQuery.isError,
  );
}

function shouldLoadLegacyBridge({
  activeJobId,
  activeSection,
  hasLegacyJobSelection,
  selectionQueryIsError,
}: {
  activeJobId: string | undefined;
  activeSection: RunWorkspaceSection;
  hasLegacyJobSelection: boolean;
  selectionQueryIsError: boolean;
}): boolean {
  if (activeJobId !== undefined) return false;
  return activeSection === 'annotations' || (hasLegacyJobSelection && selectionQueryIsError);
}

function shouldLoadAnnotationSummary({
  activeJobId,
  overviewAttempt,
  workflowRunId,
}: {
  activeJobId: string | undefined;
  overviewAttempt: number | undefined;
  workflowRunId: string | undefined;
}): boolean {
  return Boolean(workflowRunId) && overviewAttempt !== undefined && activeJobId === undefined;
}

function shouldLoadRunAnnotations(
  activeSection: RunWorkspaceSection,
  activeJobId: string | undefined,
): boolean {
  return activeSection === 'annotations' && activeJobId === undefined;
}

function shouldPollRunAnnotations(
  activeSection: RunWorkspaceSection,
  activeJobId: string | undefined,
  overviewStatus: WorkflowRunOverview['runAttempt']['status'] | undefined,
): boolean {
  return (
    shouldLoadRunAnnotations(activeSection, activeJobId) &&
    !isWorkflowRunTerminal(overviewStatus ?? 'pending')
  );
}

function shouldLiveRunAnnotations(
  activeSection: RunWorkspaceSection,
  activeJobId: string | undefined,
  overview: WorkflowRunOverview | undefined,
  overviewStatus: WorkflowRunOverview['runAttempt']['status'] | undefined,
): boolean {
  return (
    shouldLoadRunAnnotations(activeSection, activeJobId) &&
    Boolean(overview) &&
    !isWorkflowRunTerminal(overviewStatus ?? 'pending')
  );
}

function usePinWorkflowRunAttempt({
  headQuery,
  navigate,
  onPin,
  routeAttempt,
  selectionQuery,
  waitForSelection,
  workflowRunId,
}: {
  headQuery: ReturnType<typeof useWorkflowRunLineageHeadQuery>;
  navigate: ReturnType<typeof useNavigate>;
  onPin: (value: {workflowRunId: string; attempt: number}) => void;
  routeAttempt: number | undefined;
  selectionQuery: ReturnType<typeof useWorkflowRunSelectionQuery>;
  waitForSelection: boolean;
  workflowRunId: string | undefined;
}) {
  useEffect(() => {
    if (
      !workflowRunId ||
      routeAttempt !== undefined ||
      headQuery.isPending ||
      headQuery.isFetching ||
      headQuery.isError ||
      (waitForSelection && (selectionQuery.isPending || selectionQuery.isFetching))
    ) {
      return;
    }
    const attempt = selectionQuery.data?.workflowRunAttempt ?? headQuery.data?.currentAttempt;
    if (attempt === undefined) return;

    onPin({workflowRunId, attempt});
    void navigate({
      search: ((previous: Record<string, unknown>) => ({
        ...previous,
        runAttempt: attempt,
      })) as never,
      replace: true,
    });
  }, [
    headQuery.data?.currentAttempt,
    headQuery.isError,
    headQuery.isFetching,
    headQuery.isPending,
    navigate,
    onPin,
    routeAttempt,
    selectionQuery.isFetching,
    selectionQuery.isPending,
    selectionQuery.data?.workflowRunAttempt,
    waitForSelection,
    workflowRunId,
  ]);
}

function useRefreshWorkflowRunHeadOnTerminal({
  headQuery,
  overviewStatus,
}: {
  headQuery: ReturnType<typeof useWorkflowRunLineageHeadQuery>;
  overviewStatus: WorkflowRunOverview['runAttempt']['status'] | undefined;
}) {
  const previousOverviewStatus = useRef<typeof overviewStatus>(undefined);
  useEffect(() => {
    if (overviewStatus === undefined) return;
    const previous = previousOverviewStatus.current;
    previousOverviewStatus.current = overviewStatus;
    if (previous && !isWorkflowRunTerminal(previous) && isWorkflowRunTerminal(overviewStatus)) {
      void headQuery.refetch();
    }
  }, [headQuery, overviewStatus]);
}

function RunViewContent({
  workspaceSlug,
  projectSlug,
  headQuery,
  overviewQuery,
  overview,
  sourceQuery,
  listRun,
  legacyQuery,
  annotations,
  annotationSummaryQuery,
  rerunMutation,
  runAttempt,
  selection,
  selectionQuery,
  tab,
  activeJobId,
  activeJob,
  jobSearch,
  jobContent,
}: {
  workspaceSlug: string | undefined;
  projectSlug: string | undefined;
  headQuery: ReturnType<typeof useWorkflowRunLineageHeadQuery>;
  overviewQuery: ReturnType<typeof useWorkflowRunOverviewQuery>;
  overview: WorkflowRunOverview | undefined;
  sourceQuery: ReturnType<typeof useWorkflowRunSourceQuery>;
  listRun: ReturnType<typeof useWorkflowRunListItem>;
  legacyQuery: ReturnType<typeof useWorkflowRunAttemptQuery> | undefined;
  annotations: ReturnType<typeof useRunAnnotationsQuery>;
  annotationSummaryQuery: ReturnType<typeof useWorkflowRunAnnotationSummaryQuery>;
  rerunMutation: ReturnType<typeof useRerunWorkflowRunMutation>;
  runAttempt: number | undefined;
  selection: WorkflowRunsSearch | undefined;
  selectionQuery: ReturnType<typeof useWorkflowRunSelectionQuery>;
  tab: WorkflowRunTab | undefined;
  activeJobId: string | undefined;
  activeJob: WorkflowRunOverviewJob | undefined;
  jobSearch: WorkflowJobSearch | undefined;
  jobContent: ReactNode | undefined;
}) {
  const navigate = useNavigate();
  const activeSection = runWorkspaceSection(tab);
  const legacyRun = legacyQuery?.data;
  const shellRun = workflowRunShellForAttempt({overview, listRun, legacyRun, runAttempt});
  const resolvedSelection =
    legacyRun && selection ? resolveWorkflowRunSelection({run: legacyRun, selection}) : undefined;
  const resolvedJobId = selectionQuery.data?.jobId ?? resolvedSelection?.job?.id;
  const selectedJobId = containsLegacyJobSelection(selection) ? resolvedJobId : undefined;
  const highlightedLineRange =
    selectionQuery.data?.sourceLocation ?? resolvedSelection?.step?.sourceLocation ?? null;
  const annotationSummary = annotationSummaryQuery.data ?? annotations.summary;
  const actionsReady = workflowRunActionsReady({overview, runAttempt, headQuery});
  const actionRun = actionsReady ? overview : undefined;
  const cancelMutation = useCancelWorkflowRunMutation(actionRun);
  const activeAttempt = runAttempt ?? overview?.runAttempt.attempt ?? shellRun?.runAttempt.attempt;

  useEffect(() => {
    if (
      !shouldRedirectLegacyJob({
        activeJobId,
        activeSection,
        hasLegacyJobSelection: containsLegacyJobSelection(selection),
        hasResolvedJob: Boolean(resolvedJobId),
        hasRunData: Boolean(shellRun),
        workspaceSlug,
        projectSlug,
      }) ||
      !resolvedJobId ||
      !shellRun ||
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
        workflowRunId: shellRun.id,
        jobId: resolvedJobId,
      },
      search: workflowJobSearchParams({
        jobExecutionId: selection?.jobExecutionId,
        stepId: selection?.stepId,
        stepAttemptId: selection?.stepAttemptId,
        runAttempt: selectionQuery.data?.workflowRunAttempt ?? activeAttempt,
      }) as never,
      replace: true,
    });
  }, [
    activeAttempt,
    activeJobId,
    activeSection,
    navigate,
    projectSlug,
    resolvedJobId,
    selection,
    selectionQuery.data?.workflowRunAttempt,
    shellRun,
    workspaceSlug,
  ]);

  async function rerun(mode: WorkflowRunRerunMode) {
    if (!actionRun || !workspaceSlug || !projectSlug) {
      toast.error('Could not start re-run from this route.');
      return;
    }
    try {
      const run = await rerunMutation.mutateAsync({workflowRunId: actionRun.id, mode});
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
    if (source !== 'pointer' || !jobId || !shellRun || !workspaceSlug || !projectSlug) return;

    void navigate({
      to: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId/jobs/$jobId',
      params: {workspaceSlug, projectSlug, workflowRunId: shellRun.id, jobId},
      search: workflowJobSearchParams({runAttempt: activeAttempt}) as never,
    });
  }

  function selectAnnotationJob(jobId: string | undefined) {
    if (!shellRun || !workspaceSlug || !projectSlug) return;
    const nextSearch: WorkflowRunsSearch = {...selection, tab: 'annotations'};
    if (jobId) nextSearch.jobId = jobId;
    else delete nextSearch.jobId;
    delete nextSearch.jobExecutionId;
    delete nextSearch.stepId;
    delete nextSearch.stepAttemptId;

    void navigate({
      to: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId',
      params: {workspaceSlug, projectSlug, workflowRunId: shellRun.id},
      search: workflowRunSearchParams(nextSearch, nextSearch) as never,
    });
  }

  function clearAnnotationFilters() {
    if (!shellRun || !workspaceSlug || !projectSlug) return;
    const nextSearch: WorkflowRunsSearch = {...selection, tab: 'annotations'};
    delete nextSearch.jobId;
    delete nextSearch.jobExecutionId;
    delete nextSearch.stepId;
    delete nextSearch.stepAttemptId;
    delete nextSearch.severity;

    void navigate({
      to: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId',
      params: {workspaceSlug, projectSlug, workflowRunId: shellRun.id},
      search: workflowRunSearchParams(nextSearch, nextSearch) as never,
      replace: true,
    });
  }

  function cancelRun() {
    cancelMutation.mutate(undefined, {
      onError: (error) => toast.error(cancelErrorMessage(error)),
    });
  }

  return (
    <RunViewLayout
      workspaceSlug={workspaceSlug}
      projectSlug={projectSlug}
      headQuery={headQuery}
      overviewQuery={overviewQuery}
      overview={overview}
      sourceQuery={sourceQuery}
      shellRun={shellRun}
      legacyQuery={legacyQuery}
      annotations={annotations}
      annotationSummary={annotationSummary}
      rerunPending={rerunMutation.isPending}
      activeSection={activeSection}
      activeJobId={activeJobId}
      activeJob={activeJob}
      jobSearch={jobSearch}
      selection={selection}
      selectedJobId={selectedJobId}
      jobContent={jobContent}
      highlightedLineRange={highlightedLineRange}
      onCancel={actionRun ? cancelRun : undefined}
      cancelling={cancelMutation.isPending}
      onRerun={actionRun ? (mode) => void rerun(mode) : undefined}
      onSelectGraphJob={selectGraphJob}
      onSelectAnnotationJob={selectAnnotationJob}
      onClearAnnotationFilters={clearAnnotationFilters}
    />
  );
}

function RunViewLayout({
  workspaceSlug,
  projectSlug,
  headQuery,
  overviewQuery,
  overview,
  sourceQuery,
  shellRun,
  legacyQuery,
  annotations,
  annotationSummary,
  rerunPending,
  activeSection,
  activeJobId,
  activeJob,
  jobSearch,
  selection,
  selectedJobId,
  jobContent,
  highlightedLineRange,
  onCancel,
  cancelling,
  onRerun,
  onSelectGraphJob,
  onSelectAnnotationJob,
  onClearAnnotationFilters,
}: {
  workspaceSlug: string | undefined;
  projectSlug: string | undefined;
  headQuery: ReturnType<typeof useWorkflowRunLineageHeadQuery>;
  overviewQuery: ReturnType<typeof useWorkflowRunOverviewQuery>;
  overview: WorkflowRunOverview | undefined;
  sourceQuery: ReturnType<typeof useWorkflowRunSourceQuery>;
  shellRun: WorkflowRunShell | undefined;
  legacyQuery: ReturnType<typeof useWorkflowRunAttemptQuery> | undefined;
  annotations: ReturnType<typeof useRunAnnotationsQuery>;
  annotationSummary: RunAnnotationSummary | undefined;
  rerunPending: boolean;
  activeSection: RunWorkspaceSection;
  activeJobId: string | undefined;
  activeJob: WorkflowRunOverviewJob | undefined;
  jobSearch: WorkflowJobSearch | undefined;
  selection: WorkflowRunsSearch | undefined;
  selectedJobId: string | undefined;
  jobContent: ReactNode | undefined;
  highlightedLineRange: StepSourceLocation | null;
  onCancel?: (() => void) | undefined;
  cancelling: boolean;
  onRerun?: ((mode: WorkflowRunRerunMode) => void) | undefined;
  onSelectGraphJob: (jobId: string | undefined, source?: JobGraphSelectionSource) => void;
  onSelectAnnotationJob: (jobId: string | undefined) => void;
  onClearAnnotationFilters: () => void;
}) {
  const newerAttempt =
    shellRun && headQuery.data && headQuery.data.latestAttempt > shellRun.runAttempt.attempt
      ? headQuery.data.latestAttempt
      : undefined;
  const boundaryQuery = overviewQuery.isEnabled ? overviewQuery : headQuery;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {shellRun ? (
        <WorkflowRunSummary
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          run={shellRun}
          cancelling={cancelling}
          onCancel={onCancel}
          rerunPending={rerunPending}
          onRerun={onRerun}
          latestAttempt={headQuery.data?.latestAttempt ?? shellRun.latestAttempt}
        />
      ) : (
        <WorkflowRunSkeleton />
      )}
      {!activeJobId && newerAttempt && workspaceSlug && projectSlug && shellRun ? (
        <WorkflowRunNewerAttemptBanner
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          runId={shellRun.id}
          currentAttempt={shellRun.runAttempt.attempt}
          latestAttempt={newerAttempt}
        />
      ) : null}
      {overview && overviewQuery.isError ? <WorkflowRunStaleError query={overviewQuery} /> : null}
      <div
        data-run-workspace-layout
        className="flex min-h-0 min-w-0 flex-1 flex-col border-t border-border-neutral-base"
      >
        <div
          data-run-workspace-frame
          className="flex min-h-0 min-w-0 w-full flex-1 flex-col min-[768px]:flex-row"
        >
          {shellRun && workspaceSlug && projectSlug ? (
            <RunWorkspaceNav
              workspaceSlug={workspaceSlug}
              projectSlug={projectSlug}
              run={shellRun}
              activeSection={activeSection}
              currentJobId={activeJobId}
              activeJob={
                activeJob ??
                (activeJobId
                  ? legacyQuery?.data?.jobs.find((job) => job.id === activeJobId)
                  : undefined)
              }
              jobSearch={jobSearch}
              annotationSummary={annotationSummary}
            />
          ) : (
            <RunWorkspaceNavSkeleton />
          )}
          <div data-run-workspace-content className="flex min-h-0 min-w-0 flex-1 flex-col">
            <RunWorkspaceContent
              boundaryQuery={boundaryQuery}
              overviewQuery={overviewQuery}
              overview={overview}
              sourceQuery={sourceQuery}
              shellRun={shellRun}
              legacyQuery={legacyQuery}
              jobContent={jobContent}
              activeSection={activeSection}
              annotations={annotations}
              annotationSummary={annotationSummary}
              workspaceSlug={workspaceSlug}
              projectSlug={projectSlug}
              selection={selection}
              selectedJobId={selectedJobId}
              onSelectGraphJob={onSelectGraphJob}
              onSelectAnnotationJob={onSelectAnnotationJob}
              onClearAnnotationFilters={onClearAnnotationFilters}
              highlightedLineRange={highlightedLineRange}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function RunWorkspaceContent({
  boundaryQuery,
  overviewQuery,
  overview,
  sourceQuery,
  shellRun,
  legacyQuery,
  jobContent,
  activeSection,
  annotations,
  annotationSummary,
  workspaceSlug,
  projectSlug,
  selection,
  selectedJobId,
  onSelectGraphJob,
  onSelectAnnotationJob,
  onClearAnnotationFilters,
  highlightedLineRange,
}: {
  boundaryQuery:
    | ReturnType<typeof useWorkflowRunOverviewQuery>
    | ReturnType<typeof useWorkflowRunLineageHeadQuery>;
  overviewQuery: ReturnType<typeof useWorkflowRunOverviewQuery>;
  overview: WorkflowRunOverview | undefined;
  sourceQuery: ReturnType<typeof useWorkflowRunSourceQuery>;
  shellRun: WorkflowRunShell | undefined;
  legacyQuery: ReturnType<typeof useWorkflowRunAttemptQuery> | undefined;
  jobContent: ReactNode | undefined;
  activeSection: RunWorkspaceSection;
  annotations: ReturnType<typeof useRunAnnotationsQuery>;
  annotationSummary: RunAnnotationSummary | undefined;
  workspaceSlug: string | undefined;
  projectSlug: string | undefined;
  selection: WorkflowRunsSearch | undefined;
  selectedJobId: string | undefined;
  onSelectGraphJob: (jobId: string | undefined, source?: JobGraphSelectionSource) => void;
  onSelectAnnotationJob: (jobId: string | undefined) => void;
  onClearAnnotationFilters: () => void;
  highlightedLineRange: StepSourceLocation | null;
}) {
  if (
    jobContent === undefined &&
    boundaryQuery.isError &&
    (shellRun === undefined || !overviewQuery.isEnabled)
  ) {
    const error =
      boundaryQuery.error instanceof ApiError && boundaryQuery.error.status === 404 ? (
        <WorkflowRunNotFound />
      ) : (
        <QueryLoadError query={boundaryQuery} subject="workflow run" icon="pulseLine" />
      );
    return <div className="min-h-0 flex-1 overflow-auto p-panel">{error}</div>;
  }
  if (jobContent) return jobContent;
  if (overviewQuery.isError && overview === undefined) {
    return (
      <div className="min-h-0 flex-1 overflow-auto p-panel">
        <QueryLoadError query={overviewQuery} subject="workflow run overview" icon="pulseLine" />
      </div>
    );
  }
  if (overview === undefined) {
    return (
      <div className="min-h-0 flex-1 overflow-auto p-panel">
        <WorkflowRunContentSkeleton />
      </div>
    );
  }

  const sectionFallback = workspaceSectionFallback({activeSection, legacyQuery, sourceQuery});
  if (sectionFallback) return sectionFallback;

  return (
    <RunSectionContent
      section={activeSection}
      run={overview}
      legacyRun={legacyQuery?.data}
      annotations={annotations}
      annotationSummary={annotationSummary}
      workspaceSlug={workspaceSlug}
      projectSlug={projectSlug}
      selection={selection}
      selectedJobId={selectedJobId}
      onSelectGraphJob={onSelectGraphJob}
      onSelectAnnotationJob={onSelectAnnotationJob}
      onClearAnnotationFilters={onClearAnnotationFilters}
      source={sourceQuery.data}
      highlightedLineRange={highlightedLineRange}
    />
  );
}

function workspaceSectionFallback({
  activeSection,
  legacyQuery,
  sourceQuery,
}: {
  activeSection: RunWorkspaceSection;
  legacyQuery: ReturnType<typeof useWorkflowRunAttemptQuery> | undefined;
  sourceQuery: ReturnType<typeof useWorkflowRunSourceQuery>;
}): ReactNode | undefined {
  if (
    activeSection === 'annotations' &&
    (!legacyQuery || legacyQuery.isPending || legacyQuery.data === undefined)
  ) {
    if (legacyQuery?.isError) {
      return (
        <div className="min-h-0 flex-1 overflow-auto p-panel">
          <QueryLoadError query={legacyQuery} subject="workflow run details" icon="pulseLine" />
        </div>
      );
    }
    return (
      <div className="min-h-0 flex-1 overflow-auto p-panel">
        <WorkflowRunContentSkeleton />
      </div>
    );
  }

  if (activeSection === 'source' && (sourceQuery.isPending || sourceQuery.data === undefined)) {
    if (sourceQuery.isError) {
      return (
        <div className="min-h-0 flex-1 overflow-auto p-panel">
          <QueryLoadError query={sourceQuery} subject="workflow run source" icon="pulseLine" />
        </div>
      );
    }
    return (
      <div className="min-h-0 flex-1 overflow-auto p-panel">
        <WorkflowRunContentSkeleton />
      </div>
    );
  }

  return undefined;
}

function containsLegacyJobSelection(selection: WorkflowRunsSearch | undefined): boolean {
  return Boolean(
    selection?.jobId || selection?.jobExecutionId || selection?.stepId || selection?.stepAttemptId,
  );
}

function shouldRedirectLegacyJob({
  activeJobId,
  activeSection,
  hasLegacyJobSelection,
  hasResolvedJob,
  hasRunData,
  workspaceSlug,
  projectSlug,
}: {
  activeJobId: string | undefined;
  activeSection: ReturnType<typeof runWorkspaceSection>;
  hasLegacyJobSelection: boolean;
  hasResolvedJob: boolean;
  hasRunData: boolean;
  workspaceSlug: string | undefined;
  projectSlug: string | undefined;
}): boolean {
  return (
    !activeJobId &&
    activeSection === 'summary' &&
    hasLegacyJobSelection &&
    hasResolvedJob &&
    hasRunData &&
    Boolean(workspaceSlug) &&
    Boolean(projectSlug)
  );
}

function RunSectionContent({
  section,
  run,
  legacyRun,
  annotations,
  annotationSummary,
  workspaceSlug,
  projectSlug,
  selection,
  selectedJobId,
  onSelectGraphJob,
  onSelectAnnotationJob,
  onClearAnnotationFilters,
  source,
  highlightedLineRange,
}: {
  section: RunWorkspaceSection;
  run: WorkflowRunOverview;
  legacyRun: WorkflowRunDetail | undefined;
  annotations: ReturnType<typeof useRunAnnotationsQuery>;
  annotationSummary: RunAnnotationSummary | undefined;
  workspaceSlug: string | undefined;
  projectSlug: string | undefined;
  selection: WorkflowRunsSearch | undefined;
  selectedJobId: string | undefined;
  onSelectGraphJob: (jobId: string | undefined, source?: JobGraphSelectionSource) => void;
  onSelectAnnotationJob: (jobId: string | undefined) => void;
  onClearAnnotationFilters: () => void;
  source: WorkflowRunSource | undefined;
  highlightedLineRange: StepSourceLocation | null;
}) {
  if (section === 'summary') {
    return (
      <section
        aria-label="All jobs summary"
        className="min-h-0 flex-1 overflow-auto pb-panel pt-panel-compact"
      >
        <div className="flex w-full flex-col gap-group">
          <Text as="h2" className="sr-only">
            All jobs summary
          </Text>
          {run.jobs.kind === 'large' ? (
            <WorkflowRunLargeJobs
              run={run}
              workspaceSlug={workspaceSlug}
              projectSlug={projectSlug}
            />
          ) : (
            <Panel className="min-h-160">
              <PanelBody className="min-h-160 bg-background-components-base p-0">
                <JobGraph
                  run={run}
                  selectedJobId={selectedJobId}
                  onSelectedJobChange={onSelectGraphJob}
                  className="min-h-160 overflow-hidden"
                />
              </PanelBody>
            </Panel>
          )}
        </div>
      </section>
    );
  }

  if (section === 'annotations') {
    if (!legacyRun) {
      return (
        <div className="min-h-0 flex-1 overflow-auto p-panel">
          <WorkflowRunContentSkeleton />
        </div>
      );
    }
    return (
      <RunAnnotationsSection
        run={legacyRun}
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
      className="min-h-0 flex-1 overflow-auto pb-panel pt-panel-compact"
    >
      <div className="flex min-h-full w-full flex-col">
        <Text as="h2" className="sr-only">
          Workflow source
        </Text>
        <Panel className="min-h-160 flex-1">
          <PanelBody className="min-h-160 flex-1 p-0">
            {source?.kind === 'available' ? (
              <WorkflowSourceContent
                source={source.sourceSnapshot}
                highlightedLineRange={highlightedLineRange}
                scrollHighlightedIntoView
              />
            ) : (
              <EmptyState
                variant="panel"
                className="min-h-160"
                icon="fileDamageLine"
                title="Source snapshot unavailable"
                description={sourceUnavailableDescription(source)}
              />
            )}
          </PanelBody>
        </Panel>
      </div>
    </section>
  );
}

function sourceUnavailableDescription(source: WorkflowRunSource | undefined): string {
  if (!source || source.kind === 'available') {
    return 'This run does not have a source snapshot to display.';
  }
  if (source.reason === 'temporary_run') return 'Temporary runs do not capture workflow source.';
  if (source.reason === 'legacy_snapshot_too_large') {
    return 'This workflow source snapshot is too large to display.';
  }
  return 'This run was created before workflow source snapshots were captured.';
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
  run: WorkflowRunDetail;
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
        jobName: job.displayName,
        body: derivedJobAnnotation(job),
      }));
  }, [records, run.jobs, selectedJob, selection]);
  const hasSynthesizedJobAnnotations = run.jobs.some(
    (job) =>
      (job.status === 'failed' || job.status === 'skipped') && job.jobExecutions.length === 0,
  );
  const annotationTotal = Math.max(annotationSummary?.total ?? 0, records?.length ?? 0);

  return (
    <section
      aria-label="Run annotations"
      className="min-h-0 flex-1 overflow-auto pb-panel pt-panel-compact"
    >
      <div className="flex w-full flex-col">
        <Text as="h2" className="sr-only">
          Annotations
        </Text>
        <Panel>
          <PanelHeader className="flex-wrap">
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
          </PanelHeader>
          {/* The list owns the panel body: its rows are flush cells divided by the panel's own
              hairlines, and each of its other states wants its own padding. */}
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
              (severity || selectedJob) && (annotationTotal > 0 || hasSynthesizedJobAnnotations),
            )}
            filteredJobName={selectedJob?.displayName}
            filteredSeverity={severity}
            onClearFilters={onClearAnnotationFilters}
          />
        </Panel>
      </div>
    </section>
  );
}

function matchesDerivedAnnotationFilters(
  style: 'warning' | 'error',
  selection: WorkflowRunsSearch | undefined,
): boolean {
  return !selection?.severity || style === selection.severity;
}

/** The row is titled by its job, so the body opens with what happened rather than repeating it. */
function derivedJobAnnotation(job: Job): string {
  const reason = job.statusReason ? `Reason: \`${job.statusReason}\`` : null;
  const traceSummary = formatConditionEvaluation(job.evaluationTrace);
  const details = [reason, traceSummary].filter(Boolean).join('\n');

  if (job.status === 'skipped') {
    return [
      'Skipped before an execution was created.',
      '',
      'Review its dependencies or condition before re-running.',
      details,
    ]
      .filter(Boolean)
      .join('\n');
  }
  return [
    'Failed before an execution was created.',
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
  const selectedJobName = jobs.find((job) => job.id === selectedJobId)?.displayName;

  return (
    <Select
      value={selectedJobId ?? ALL_ANNOTATION_JOBS}
      onValueChange={(value) => onSelect(value === ALL_ANNOTATION_JOBS ? undefined : value)}
    >
      <SelectTrigger
        size="small"
        aria-label="Filter annotations by job"
        // Job names are user-authored and the trigger truncates them. Radix renders the value
        // itself, so only a caller that knows the selected job can offer the full name back.
        title={selectedJobName ?? 'All jobs'}
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
      className="hidden w-240 shrink-0 p-panel-compact min-[768px]:block"
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
