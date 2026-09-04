import {ApiError} from '@shipfox/client-api';
import {QueryLoadError} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
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
import {
  buildRunAnnotationList,
  type RunAnnotationEntry,
  type RunAnnotationSummary,
  type RunJobExplanation,
} from '#core/run-annotation.js';
import {
  isWorkflowRunTerminal,
  type StepSourceLocation,
  type WorkflowRunOverview,
  type WorkflowRunOverviewJob,
  type WorkflowRunRerunMode,
  type WorkflowRunSource,
} from '#core/workflow-run.js';
import {
  withoutWorkflowRunSelectionSearch,
  workflowJobSelectionFromRunSelection,
  workflowRunSelectionFromResolution,
  workflowRunSelectionMatches,
} from '#core/workflow-run-url-state.js';
import {useWorkflowRunAnnotationSummaryQuery} from '#hooks/api/annotations.js';
import {useRunAnnotationsQuery} from '#hooks/api/run-annotations.js';
import {useRunJobExplanationsQuery} from '#hooks/api/run-job-explanations.js';
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
import {presentRunJobExplanation} from '../workflow-run-tabs/run-job-explanation.js';
import {WorkflowSourceContent} from '../workflow-source-panel/index.js';
import {RunWorkspaceNav} from './run-workspace-nav.js';
import {WorkflowRunLargeJobs} from './workflow-run-large-jobs.js';
import {
  WorkflowRunContentSkeleton,
  WorkflowRunNewerAttemptBanner,
  WorkflowRunNotFound,
  WorkflowRunSelectionNotFound,
  WorkflowRunSkeleton,
  WorkflowRunStaleError,
} from './workflow-run-states.js';

type RunWorkspaceSection = Exclude<WorkflowRunTab, 'jobs'>;
type WorkflowRunShell =
  | NonNullable<ReturnType<typeof useWorkflowRunListItem>>
  | WorkflowRunOverview;

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
}: WorkflowRunViewProps) {
  const activeSection = runWorkspaceSection(tab);
  const routeAttempt = selection?.runAttempt ?? runAttempt;
  const [pinnedAttempt, setPinnedAttempt] = useState<
    {workflowRunId: string; attempt: number} | undefined
  >();
  const explicitAttempt = routeAttempt ?? pinnedWorkflowRunAttempt(pinnedAttempt, workflowRunId);
  const hasWorkflowRunSelection = shouldResolveWorkflowRunSelection(
    activeSection,
    selection,
    activeJobId,
  );

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
    enabled: hasWorkflowRunSelection,
  });
  // A list row is a safe stale seed for the overview. A direct URL without an attempt waits for
  // the head/selection resolver and is pinned in route state before this query is enabled.
  const overviewAttempt = workflowRunOverviewAttempt({
    explicitAttempt,
    hasWorkflowRunSelection,
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
  const jobExplanationsQuery = useRunJobExplanationsQuery({
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
    waitForSelection: hasWorkflowRunSelection,
    workflowRunId,
  });
  useCanonicalizeWorkflowRunSelection({
    activeSection,
    navigate,
    projectSlug,
    selection,
    selectionResolutionEnabled: hasWorkflowRunSelection,
    selectionQuery,
    workflowRunId,
    workspaceSlug,
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
          annotations={annotationsQuery}
          jobExplanations={jobExplanationsQuery}
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
          selectionResolutionEnabled={hasWorkflowRunSelection}
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

function shouldResolveWorkflowRunSelection(
  activeSection: RunWorkspaceSection,
  selection: WorkflowRunsSearch | undefined,
  activeJobId: string | undefined,
): boolean {
  return (
    activeJobId === undefined &&
    (activeSection === 'summary' || activeSection === 'source') &&
    containsWorkflowRunSelection(selection)
  );
}

function workflowRunOverviewAttempt({
  explicitAttempt,
  hasWorkflowRunSelection,
  headAttempt,
  listAttempt,
  selectionAttempt,
  selectionQueryIsError,
  headResolved,
}: {
  explicitAttempt: number | undefined;
  hasWorkflowRunSelection: boolean;
  headAttempt: number | undefined;
  listAttempt: number | undefined;
  selectionAttempt: number | undefined;
  selectionQueryIsError: boolean;
  headResolved: boolean;
}): number | undefined {
  if (explicitAttempt !== undefined) return explicitAttempt;
  if (!hasWorkflowRunSelection) return headResolved ? (headAttempt ?? listAttempt) : undefined;
  if (selectionAttempt !== undefined) return selectionAttempt;
  return selectionQueryIsError && headResolved ? (headAttempt ?? listAttempt) : undefined;
}

function workflowRunShellForAttempt({
  overview,
  listRun,
  runAttempt,
}: {
  overview: WorkflowRunOverview | undefined;
  listRun: ReturnType<typeof useWorkflowRunListItem>;
  runAttempt: number | undefined;
}): WorkflowRunShell | undefined {
  if (overview) return overview;
  if (listRun && (runAttempt === undefined || listRun.currentAttempt === runAttempt)) {
    return listRun;
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
      (waitForSelection &&
        (selectionQuery.isPending ||
          selectionQuery.isFetching ||
          selectionQuery.isError ||
          selectionQuery.data !== undefined))
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
    selectionQuery.data,
    selectionQuery.isError,
    selectionQuery.isFetching,
    selectionQuery.isPending,
    waitForSelection,
    workflowRunId,
  ]);
}

function useCanonicalizeWorkflowRunSelection({
  activeSection,
  navigate,
  projectSlug,
  selection,
  selectionResolutionEnabled,
  selectionQuery,
  workflowRunId,
  workspaceSlug,
}: {
  activeSection: RunWorkspaceSection;
  navigate: ReturnType<typeof useNavigate>;
  projectSlug: string | undefined;
  selection: WorkflowRunsSearch | undefined;
  selectionResolutionEnabled: boolean;
  selectionQuery: ReturnType<typeof useWorkflowRunSelectionQuery>;
  workflowRunId: string | undefined;
  workspaceSlug: string | undefined;
}) {
  useEffect(() => {
    if (
      !workflowRunId ||
      !workspaceSlug ||
      !projectSlug ||
      !selectionResolutionEnabled ||
      selectionQuery.isError ||
      !selectionQuery.data
    ) {
      return;
    }

    const canonicalSelection = workflowRunSelectionFromResolution(selectionQuery.data);
    if (!canonicalSelection.jobId) return;

    if (activeSection === 'summary') {
      void navigate({
        to: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId/jobs/$jobId',
        params: {
          workspaceSlug,
          projectSlug,
          workflowRunId,
          jobId: canonicalSelection.jobId,
        },
        search: workflowJobSearchParams(
          workflowJobSelectionFromRunSelection(canonicalSelection),
        ) as never,
        replace: true,
      });
      return;
    }

    if (activeSection !== 'source' || workflowRunSelectionMatches(selection, canonicalSelection)) {
      return;
    }

    const runSearch: WorkflowRunsSearch = {...selection, tab: 'source'};
    void navigate({
      to: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId',
      params: {workspaceSlug, projectSlug, workflowRunId},
      search: workflowRunSearchParams(runSearch, canonicalSelection) as never,
      replace: true,
    });
  }, [
    activeSection,
    navigate,
    projectSlug,
    selection,
    selectionQuery.data,
    selectionQuery.isError,
    selectionResolutionEnabled,
    workflowRunId,
    workspaceSlug,
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
  annotations,
  jobExplanations,
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
  selectionResolutionEnabled,
}: {
  workspaceSlug: string | undefined;
  projectSlug: string | undefined;
  headQuery: ReturnType<typeof useWorkflowRunLineageHeadQuery>;
  overviewQuery: ReturnType<typeof useWorkflowRunOverviewQuery>;
  overview: WorkflowRunOverview | undefined;
  sourceQuery: ReturnType<typeof useWorkflowRunSourceQuery>;
  listRun: ReturnType<typeof useWorkflowRunListItem>;
  annotations: ReturnType<typeof useRunAnnotationsQuery>;
  jobExplanations: ReturnType<typeof useRunJobExplanationsQuery>;
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
  selectionResolutionEnabled: boolean;
}) {
  const navigate = useNavigate();
  const activeSection = runWorkspaceSection(tab);
  const shellRun = workflowRunShellForAttempt({overview, listRun, runAttempt});
  const resolvedJobId = selectionQuery.data?.jobId ?? undefined;
  const selectedJobId = selectedRunJobId({activeSection, selection, resolvedJobId});
  const highlightedLineRange = selectionQuery.data?.sourceLocation ?? null;
  const annotationSummary = annotationSummaryQuery.data ?? annotations.summary;
  const actionsReady = workflowRunActionsReady({overview, runAttempt, headQuery});
  const actionRun = actionsReady ? overview : undefined;
  const cancelMutation = useCancelWorkflowRunMutation(actionRun);
  const activeAttempt = runAttempt ?? overview?.runAttempt.attempt ?? shellRun?.runAttempt.attempt;

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

  function clearWorkflowRunSelection() {
    void navigate({
      search: ((previous: Record<string, unknown>) =>
        withoutWorkflowRunSelectionSearch(previous)) as never,
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
      annotations={annotations}
      jobExplanations={jobExplanations}
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
      selectionQuery={selectionQuery}
      selectionResolutionEnabled={selectionResolutionEnabled}
      onCancel={actionRun ? cancelRun : undefined}
      cancelling={cancelMutation.isPending}
      onRerun={actionRun ? (mode) => void rerun(mode) : undefined}
      onSelectGraphJob={selectGraphJob}
      onSelectAnnotationJob={selectAnnotationJob}
      onClearAnnotationFilters={clearAnnotationFilters}
      onClearSelection={clearWorkflowRunSelection}
    />
  );
}

function selectedRunJobId({
  activeSection,
  selection,
  resolvedJobId,
}: {
  activeSection: RunWorkspaceSection;
  selection: WorkflowRunsSearch | undefined;
  resolvedJobId: string | undefined;
}): string | undefined {
  if (activeSection === 'annotations') return selection?.jobId;
  if (containsWorkflowRunSelection(selection)) return resolvedJobId;
  return undefined;
}

function RunViewLayout({
  workspaceSlug,
  projectSlug,
  headQuery,
  overviewQuery,
  overview,
  sourceQuery,
  shellRun,
  annotations,
  jobExplanations,
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
  selectionQuery,
  selectionResolutionEnabled,
  onCancel,
  cancelling,
  onRerun,
  onSelectGraphJob,
  onSelectAnnotationJob,
  onClearAnnotationFilters,
  onClearSelection,
}: {
  workspaceSlug: string | undefined;
  projectSlug: string | undefined;
  headQuery: ReturnType<typeof useWorkflowRunLineageHeadQuery>;
  overviewQuery: ReturnType<typeof useWorkflowRunOverviewQuery>;
  overview: WorkflowRunOverview | undefined;
  sourceQuery: ReturnType<typeof useWorkflowRunSourceQuery>;
  shellRun: WorkflowRunShell | undefined;
  annotations: ReturnType<typeof useRunAnnotationsQuery>;
  jobExplanations: ReturnType<typeof useRunJobExplanationsQuery>;
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
  selectionQuery: ReturnType<typeof useWorkflowRunSelectionQuery>;
  selectionResolutionEnabled: boolean;
  onCancel?: (() => void) | undefined;
  cancelling: boolean;
  onRerun?: ((mode: WorkflowRunRerunMode) => void) | undefined;
  onSelectGraphJob: (jobId: string | undefined, source?: JobGraphSelectionSource) => void;
  onSelectAnnotationJob: (jobId: string | undefined) => void;
  onClearAnnotationFilters: () => void;
  onClearSelection: () => void;
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
              activeJob={activeJob}
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
              jobContent={jobContent}
              activeSection={activeSection}
              annotations={annotations}
              jobExplanations={jobExplanations}
              annotationSummary={annotationSummary}
              workspaceSlug={workspaceSlug}
              projectSlug={projectSlug}
              selection={selection}
              selectionQuery={selectionQuery}
              selectionResolutionEnabled={selectionResolutionEnabled}
              selectedJobId={selectedJobId}
              onSelectGraphJob={onSelectGraphJob}
              onSelectAnnotationJob={onSelectAnnotationJob}
              onClearAnnotationFilters={onClearAnnotationFilters}
              onClearSelection={onClearSelection}
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
  jobContent,
  activeSection,
  annotations,
  jobExplanations,
  annotationSummary,
  workspaceSlug,
  projectSlug,
  selection,
  selectionQuery,
  selectionResolutionEnabled,
  selectedJobId,
  onSelectGraphJob,
  onSelectAnnotationJob,
  onClearAnnotationFilters,
  onClearSelection,
  highlightedLineRange,
}: {
  boundaryQuery:
    | ReturnType<typeof useWorkflowRunOverviewQuery>
    | ReturnType<typeof useWorkflowRunLineageHeadQuery>;
  overviewQuery: ReturnType<typeof useWorkflowRunOverviewQuery>;
  overview: WorkflowRunOverview | undefined;
  sourceQuery: ReturnType<typeof useWorkflowRunSourceQuery>;
  shellRun: WorkflowRunShell | undefined;
  jobContent: ReactNode | undefined;
  activeSection: RunWorkspaceSection;
  annotations: ReturnType<typeof useRunAnnotationsQuery>;
  jobExplanations: ReturnType<typeof useRunJobExplanationsQuery>;
  annotationSummary: RunAnnotationSummary | undefined;
  workspaceSlug: string | undefined;
  projectSlug: string | undefined;
  selection: WorkflowRunsSearch | undefined;
  selectionQuery: ReturnType<typeof useWorkflowRunSelectionQuery>;
  selectionResolutionEnabled: boolean;
  selectedJobId: string | undefined;
  onSelectGraphJob: (jobId: string | undefined, source?: JobGraphSelectionSource) => void;
  onSelectAnnotationJob: (jobId: string | undefined) => void;
  onClearAnnotationFilters: () => void;
  onClearSelection: () => void;
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
  const selectionBoundary = workflowRunSelectionBoundary({
    onClearSelection,
    query: selectionQuery,
    enabled: selectionResolutionEnabled,
  });
  if (selectionBoundary) return selectionBoundary;
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

  const sectionFallback = workspaceSectionFallback({activeSection, sourceQuery});
  if (sectionFallback) return sectionFallback;

  return (
    <RunSectionContent
      section={activeSection}
      run={overview}
      annotations={annotations}
      jobExplanations={jobExplanations}
      annotationSummary={annotationSummary}
      workspaceSlug={workspaceSlug}
      projectSlug={projectSlug}
      selection={selection}
      selectedJobId={selectedJobId}
      onSelectGraphJob={onSelectGraphJob}
      onSelectAnnotationJob={onSelectAnnotationJob}
      onClearAnnotationFilters={onClearAnnotationFilters}
      source={sourceQuery.data}
      sourceQuery={sourceQuery}
      highlightedLineRange={highlightedLineRange}
    />
  );
}

function workspaceSectionFallback({
  activeSection,
  sourceQuery,
}: {
  activeSection: RunWorkspaceSection;
  sourceQuery: ReturnType<typeof useWorkflowRunSourceQuery>;
}): ReactNode | undefined {
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

function workflowRunSelectionBoundary({
  onClearSelection,
  query,
  enabled,
}: {
  onClearSelection: () => void;
  query: ReturnType<typeof useWorkflowRunSelectionQuery>;
  enabled: boolean;
}): ReactNode | undefined {
  if (!enabled || !query.isError) return undefined;
  if (!(query.error instanceof ApiError && query.error.status === 404)) return undefined;
  return (
    <div className="min-h-0 flex-1 overflow-auto p-panel">
      <WorkflowRunSelectionNotFound onClearSelection={onClearSelection} />
    </div>
  );
}

function containsWorkflowRunSelection(selection: WorkflowRunsSearch | undefined): boolean {
  return Boolean(
    selection?.jobId || selection?.jobExecutionId || selection?.stepId || selection?.stepAttemptId,
  );
}

function RunSectionContent({
  section,
  run,
  annotations,
  jobExplanations,
  annotationSummary,
  workspaceSlug,
  projectSlug,
  selection,
  selectedJobId,
  onSelectGraphJob,
  onSelectAnnotationJob,
  onClearAnnotationFilters,
  source,
  sourceQuery,
  highlightedLineRange,
}: {
  section: RunWorkspaceSection;
  run: WorkflowRunOverview;
  annotations: ReturnType<typeof useRunAnnotationsQuery>;
  jobExplanations: ReturnType<typeof useRunJobExplanationsQuery>;
  annotationSummary: RunAnnotationSummary | undefined;
  workspaceSlug: string | undefined;
  projectSlug: string | undefined;
  selection: WorkflowRunsSearch | undefined;
  selectedJobId: string | undefined;
  onSelectGraphJob: (jobId: string | undefined, source?: JobGraphSelectionSource) => void;
  onSelectAnnotationJob: (jobId: string | undefined) => void;
  onClearAnnotationFilters: () => void;
  source: WorkflowRunSource | undefined;
  sourceQuery: ReturnType<typeof useWorkflowRunSourceQuery>;
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
    return (
      <RunAnnotationsSection
        run={run}
        annotations={annotations}
        jobExplanations={jobExplanations}
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
        {sourceQuery.isError && source !== undefined ? (
          <WorkflowSourceStaleError query={sourceQuery} />
        ) : null}
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

function WorkflowSourceStaleError({query}: {query: ReturnType<typeof useWorkflowRunSourceQuery>}) {
  return (
    <Callout role="status" aria-live="polite" type="warning" variant="secondary">
      <div className="flex min-w-0 flex-1 items-center justify-between gap-inline">
        <Text size="xs">Could not refresh workflow source.</Text>
        <Button
          type="button"
          size="2xs"
          variant="secondary"
          isLoading={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Retry
        </Button>
      </div>
    </Callout>
  );
}

function RunAnnotationsSection({
  run,
  annotations,
  jobExplanations,
  annotationSummary,
  workspaceSlug,
  projectSlug,
  selection,
  selectedJobId,
  onSelectAnnotationJob,
  onClearAnnotationFilters,
}: {
  run: WorkflowRunOverview;
  annotations: ReturnType<typeof useRunAnnotationsQuery>;
  jobExplanations: ReturnType<typeof useRunJobExplanationsQuery>;
  annotationSummary: RunAnnotationSummary | undefined;
  workspaceSlug: string | undefined;
  projectSlug: string | undefined;
  selection: WorkflowRunsSearch | undefined;
  selectedJobId: string | undefined;
  onSelectAnnotationJob: (jobId: string | undefined) => void;
  onClearAnnotationFilters: () => void;
}) {
  const severity = selection?.severity;
  const annotationEntries = annotations.entries;
  const explanations = jobExplanations.explanations;
  const jobs = useMemo(
    () => annotationJobOptions(run, annotationEntries, explanations),
    [annotationEntries, explanations, run],
  );
  const selectedJob = jobs.find((job) => job.id === selectedJobId);
  const effectiveJobId = selectedJob?.id;

  const entries = useMemo(
    () =>
      annotationEntries
        ? buildRunAnnotationList({
            entries: annotationEntries,
            severity,
            jobId: effectiveJobId,
          })
        : undefined,
    [annotationEntries, effectiveJobId, severity],
  );
  const derivedAnnotations = useMemo<readonly DerivedRunAnnotation[] | undefined>(() => {
    if (!explanations) return undefined;
    return explanations
      .map((explanation) => ({explanation, presentation: presentRunJobExplanation(explanation)}))
      .filter(({explanation, presentation}) => {
        return (
          (!effectiveJobId || effectiveJobId === explanation.jobId) &&
          matchesDerivedAnnotationFilters(presentation.style, selection)
        );
      })
      .map(({explanation, presentation}) => ({
        id: `derived-${explanation.jobId}`,
        jobId: explanation.jobId,
        jobPosition: explanation.jobPosition,
        ...presentation,
        jobName: explanation.jobName,
      }))
      .sort(
        (left, right) =>
          left.jobPosition - right.jobPosition || left.jobId.localeCompare(right.jobId),
      );
  }, [effectiveJobId, explanations, selection]);
  const annotationTotal = Math.max(annotationSummary?.total ?? 0, annotationEntries?.length ?? 0);
  const hasKnownDiagnostics =
    annotationTotal > 0 ||
    (explanations?.length ?? 0) > 0 ||
    annotations.query.hasNextPage ||
    jobExplanations.query.hasNextPage;

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
              jobs={jobs}
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
            jobExplanationsQuery={jobExplanations.query}
            entries={entries}
            derivedAnnotations={derivedAnnotations}
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
            workflowRunId={run.id}
            runAttempt={run.runAttempt.attempt}
            // A run with no annotations at all offers no filter to clear, whatever the URL says.
            filtered={Boolean((severity || effectiveJobId) && hasKnownDiagnostics)}
            filteredJobName={selectedJob?.name}
            filteredSeverity={severity}
            onClearFilters={onClearAnnotationFilters}
          />
        </Panel>
      </div>
    </section>
  );
}

function matchesDerivedAnnotationFilters(
  style: DerivedRunAnnotation['style'],
  selection: WorkflowRunsSearch | undefined,
): boolean {
  return !selection?.severity || style === selection.severity;
}

const ALL_ANNOTATION_JOBS = 'all-jobs';

interface AnnotationJobOption {
  id: string;
  name: string;
  position: number;
}

function annotationJobOptions(
  run: WorkflowRunOverview,
  entries: readonly RunAnnotationEntry[] | undefined,
  explanations: readonly RunJobExplanation[] | undefined,
): AnnotationJobOption[] {
  const options = new Map<string, AnnotationJobOption>();
  const overviewJobs = run.jobs.kind === 'complete' ? run.jobs.items : run.jobs.firstPage.items;
  for (const job of overviewJobs) {
    options.set(job.id, {id: job.id, name: job.displayName, position: job.position});
  }
  for (const entry of entries ?? []) {
    options.set(entry.annotation.jobId, {
      id: entry.annotation.jobId,
      name: entry.jobName,
      position: entry.jobPosition,
    });
  }
  for (const explanation of explanations ?? []) {
    options.set(explanation.jobId, {
      id: explanation.jobId,
      name: explanation.jobName,
      position: explanation.jobPosition,
    });
  }

  return [...options.values()].sort(
    (left, right) => left.position - right.position || left.id.localeCompare(right.id),
  );
}

function AnnotationJobFilter({
  jobs,
  selectedJobId,
  onSelect,
}: {
  jobs: readonly AnnotationJobOption[];
  selectedJobId: string | undefined;
  onSelect: (jobId: string | undefined) => void;
}) {
  const selectedJobName = jobs.find((job) => job.id === selectedJobId)?.name;

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
        {jobs.map((job) => (
          <SelectItem key={job.id} value={job.id}>
            {job.name}
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
