// biome-ignore-all lint/a11y/noRedundantRoles: the job log region keeps an explicit role for the public accessibility contract.
// biome-ignore-all lint/a11y/noNoninteractiveTabindex: the job log region is intentionally keyboard focusable.

import {ApiError} from '@shipfox/client-api';
import {QueryLoadError} from '@shipfox/client-ui';
import {Badge} from '@shipfox/react-ui/badge';
import {Button, IconButton} from '@shipfox/react-ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@shipfox/react-ui/dropdown-menu';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Icon} from '@shipfox/react-ui/icon';
import {Panel, PanelActions, PanelBody, PanelHeader} from '@shipfox/react-ui/panel';
import {SearchInline} from '@shipfox/react-ui/search';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {TimeTickerProvider} from '@shipfox/react-ui/time-ticker';
import {Text} from '@shipfox/react-ui/typography';
import {Link} from '@tanstack/react-router';
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {RunAnnotationSummary} from '#core/run-annotation.js';
import {summarizeJobAnnotations} from '#core/run-annotation.js';
import {
  type BoundedExecutionCount,
  isTerminalJobExecutionStatus,
  isWorkflowRunTerminal,
  type Job,
  type JobExecution,
  type JobExecutionDisplayStatus,
  type WorkflowJobDetail,
  type WorkflowJobStepSummary,
} from '#core/workflow-run.js';
import {useWorkflowRunAnnotationSummaryQuery} from '#hooks/api/annotations.js';
import {useRunAnnotationsQuery} from '#hooks/api/run-annotations.js';
import type {useWorkflowJobDetailQuery} from '#hooks/api/workflow-job-detail.js';
import {
  flattenWorkflowExecutionStepsPages,
  flattenWorkflowStepAttemptPages,
  useWorkflowExecutionStepsInfiniteQuery,
  useWorkflowStepAttemptsInfiniteQuery,
} from '#hooks/api/workflow-job-detail.js';
import {
  mergeWorkflowJobStepAttempts,
  mergeWorkflowJobStepSummaries,
  toLegacyJobForJobDetail,
  type WorkflowJobDetailPresentationOptions,
} from '#hooks/api/workflow-job-detail-mapper.js';
import type {useWorkflowRunAttemptQuery} from '#hooks/api/workflow-runs.js';
import {
  type WorkflowJobSearch,
  workflowJobSearchParams,
  workflowRunSearchParams,
} from '#routes/inputs.js';
import {type StepExpandedContext, StepList} from '../step-list/index.js';
import {
  buildStepListModel,
  getStepStatusVisual,
  type StepListModel,
  type StepModel,
} from '../step-list/step-list-model.js';
import {
  WorkflowRunNotFound,
  WorkflowRunStaleError,
} from '../workflow-run-view/workflow-run-states.js';
import {JobContextPanel} from './job-context-panel.js';
import {JobDetailHeader} from './job-detail-header.js';
import {
  CarriedOverStepPanel,
  emptyStateForJob,
  emptyStateForMissingExecution,
  jobSucceededSummary,
  MaterializedOutputFailureNotice,
} from './job-empty-states.js';
import {
  resolveWorkflowJobSelection,
  type WorkflowJobLandingSelection,
  workflowJobLandingSelection,
} from './job-selection.js';
import {StepAttemptLogPanel} from './step-attempt-log-panel.js';
import {StepInspectorSheet} from './step-troubleshooting.js';

type InspectorState = {key: string; attemptId: string | null};
type JobDetailQuery =
  | ReturnType<typeof useWorkflowRunAttemptQuery>
  | ReturnType<typeof useWorkflowJobDetailQuery>;
interface JobDetailData {
  id: string;
  runAttempt: {
    attempt: number;
    status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  };
  job: Job;
  executionCount: BoundedExecutionCount;
  executionCountVisible: boolean;
  executionDisplayStatus: JobExecutionDisplayStatus | undefined;
}

export interface JobDetailViewProps {
  workspaceSlug: string;
  projectSlug: string;
  workflowRunId: string;
  jobId: string;
  search: WorkflowJobSearch;
  query: JobDetailQuery;
  selectedJobQuery?: boolean;
  newerAttempt?: number | undefined;
  newerJob?: Pick<Job, 'id'> | undefined;
  onSelectionChange: (selection: WorkflowJobSearch) => void;
}

export function JobDetailView({
  workspaceSlug,
  projectSlug,
  workflowRunId,
  jobId,
  search,
  query,
  selectedJobQuery = false,
  newerAttempt,
  newerJob,
  onSelectionChange,
}: JobDetailViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pageScrollRef = useRef<HTMLDivElement>(null);
  const landingSelectionRef = useRef<FrozenLandingSelection | undefined>(undefined);
  const [logSearch, setLogSearch] = useState('');
  const [wrapLogs, setWrapLogs] = useState(false);
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [expandedLogAttemptIds, setExpandedLogAttemptIds] = useState<readonly string[]>([]);
  const [logRefreshTokens, setLogRefreshTokens] = useState<Record<string, number>>({});
  const [logFetchingByAttemptId, setLogFetchingByAttemptId] = useState<Record<string, boolean>>({});
  const selectedJobResources = useSelectedJobDetailPresentation({
    data: query.data,
    selectedDetailUpdatedAt: query.dataUpdatedAt,
    selectedJobQuery,
    jobId,
  });
  const detailData = normalizeJobDetailData(
    query.data,
    workflowRunId,
    jobId,
    selectedJobResources.detailPresentation,
  );
  const hasLoadedData = detailData !== undefined;
  // Reuse the run workspace's bounded annotation read for the job header chip. The separate
  // summary query below stays counts-only and is scoped to the inspector's selected execution.
  const annotations = useRunAnnotationsQuery({
    workflowRunId,
    runAttempt: detailData?.runAttempt.attempt,
  });
  const jobAnnotationSummary = summarizeLoadedJobAnnotations(annotations, jobId);
  const inspectorResetKey = `${jobId}:${search.jobExecutionId ?? ''}`;
  const [inspectorState, setInspectorState] = useState<InspectorState>(() => ({
    key: inspectorResetKey,
    attemptId: null,
  }));
  const inspectorOpenAttemptId =
    inspectorState.key === inspectorResetKey ? inspectorState.attemptId : null;
  const annotationExecutionId = resolveAnnotationExecutionId(detailData, jobId, search);
  const annotationPolling = shouldPollJobAnnotations(detailData);
  const annotationSummaryQuery = useWorkflowRunAnnotationSummaryQuery(
    detailData?.id,
    detailData?.runAttempt.attempt,
    annotationExecutionId,
    {polling: annotationPolling},
  );

  useEffect(() => {
    if (!jobId || !hasLoadedData) return;
    const heading = rootRef.current?.querySelector<HTMLElement>('[data-job-heading]');
    // The heading is intentionally the route-change focus target: it announces the new job
    // after rail navigation without putting focus on a decorative status element.
    heading?.focus({preventScroll: true});
  }, [hasLoadedData, jobId]);

  const handleLogFetchingChange = useCallback((attemptId: string, isFetching: boolean) => {
    setLogFetchingByAttemptId((current) => {
      if (current[attemptId] === isFetching) return current;
      return {...current, [attemptId]: isFetching};
    });
  }, []);

  const queryBoundary = jobDetailQueryBoundary(query, selectedJobQuery);
  if (queryBoundary !== undefined) return queryBoundary;

  if (!detailData) {
    return (
      <JobNotFoundState
        workspaceSlug={workspaceSlug}
        projectSlug={projectSlug}
        workflowRunId={workflowRunId}
        search={search}
      />
    );
  }
  const run = detailData;
  const {job} = detailData;

  const detailState = resolveJobDetailState({
    job,
    search,
    landingSelectionRef,
    expandedLogAttemptIds,
    logFetchingByAttemptId,
  });
  const {
    selectedJobExecution,
    landingSelection,
    selectedAttemptId,
    runningSelection,
    expandedLogSelection,
    selectedLogAttempt,
    selectedLogStatus,
    logIsFetching,
    showRetargetNotice,
    succeededSummary,
  } = detailState;

  function selectExecution(jobExecutionId: string) {
    onSelectionChange({
      ...search,
      jobExecutionId,
      stepId: undefined,
      stepAttemptId: undefined,
    });
  }

  function selectAttempt(attemptId: string | undefined) {
    if (!selectedJobExecution) return;
    if (!attemptId) {
      onSelectionChange({
        ...search,
        jobExecutionId: selectedJobExecution.id,
        stepId: undefined,
        stepAttemptId: undefined,
      });
      return;
    }

    const match = findAttempt(selectedJobExecution, attemptId);
    if (!match) return;
    onSelectionChange({
      ...search,
      jobExecutionId: selectedJobExecution.id,
      stepId: match.step.id,
      stepAttemptId: match.attemptId,
    });
  }

  function onInspectorOpenChange(attemptId: string | null) {
    setInspectorState({key: inspectorResetKey, attemptId});
  }

  function retargetToRunningStep() {
    if (!runningSelection || !selectedJobExecution) return;
    onSelectionChange({
      ...search,
      jobExecutionId: selectedJobExecution.id,
      stepId: runningSelection.stepId,
      stepAttemptId: runningSelection.attemptId,
    });
  }

  function refreshLogs() {
    if (!selectedLogAttempt) return;
    setLogRefreshTokens((current) => ({
      ...current,
      [selectedLogAttempt.id]: (current[selectedLogAttempt.id] ?? 0) + 1,
    }));
  }

  return (
    <TimeTickerProvider intervalMs={1000} reducedMotionIntervalMs={10_000}>
      <div ref={rootRef} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {query.isError ? <WorkflowRunStaleError query={query} /> : null}
        {newerJob && newerAttempt && newerAttempt > run.runAttempt.attempt ? (
          <NewerAttemptNotice
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
            runId={run.id}
            jobId={newerJob.id}
            attempt={newerAttempt}
          />
        ) : null}
        <div ref={pageScrollRef} className="@container min-h-0 flex-1 overflow-auto pb-panel">
          <section aria-label={`${job.displayName} logs`} className="flex w-full flex-col">
            <section className="min-w-0 overflow-hidden">
              <JobDetailHeader
                job={job}
                selectedJobExecution={selectedJobExecution}
                onSelectedJobExecutionChange={selectExecution}
                workspaceSlug={workspaceSlug}
                projectSlug={projectSlug}
                workflowRunId={run.id}
                runAttempt={run.runAttempt.attempt}
                annotationSummary={jobAnnotationSummary}
                executionCount={detailData.executionCount}
                executionCountVisible={detailData.executionCountVisible}
                executionDisplayStatus={detailData.executionDisplayStatus}
                jobContext={
                  selectedJobExecution ? (
                    <JobContextPanel job={job} execution={selectedJobExecution} />
                  ) : undefined
                }
              />
              <Panel data-job-log-panel className="min-w-0">
                <JobLogPanelHeader
                  stepLabel={expandedLogSelection?.stepLabel}
                  attempt={selectedLogAttempt?.attempt}
                  status={selectedLogStatus}
                  search={logSearch}
                  onSearchChange={setLogSearch}
                  onRefresh={refreshLogs}
                  refreshing={logIsFetching}
                  showLineNumbers={showLineNumbers}
                  onShowLineNumbersChange={setShowLineNumbers}
                  wrap={wrapLogs}
                  onWrapChange={setWrapLogs}
                  disabled={!selectedLogAttempt}
                />
                <PanelBody className="min-w-0 p-0">
                  <Text as="h2" className="sr-only">
                    Logs
                  </Text>
                  {selectedJobExecution ? (
                    <>
                      <MaterializedOutputFailureNotice jobExecution={selectedJobExecution} />
                      <StepList
                        job={job}
                        jobExecution={selectedJobExecution}
                        selectedAttemptId={selectedAttemptId}
                        defaultSelectedAttemptId={landingSelection?.attemptId}
                        onSelectedAttemptChange={selectAttempt}
                        onExpandedAttemptIdsChange={setExpandedLogAttemptIds}
                        inspectorOpenAttemptId={inspectorOpenAttemptId}
                        onInspectorOpenChange={onInspectorOpenChange}
                        autoSelectActiveAttempt
                        emptyState={emptyStateForJob(job, selectedJobExecution)}
                        showHeader={false}
                        className="rounded-none border-0 bg-transparent shadow-none"
                        renderStepFooter={(step) => (
                          <StepAttemptHistoryControl
                            step={step}
                            stepSummary={selectedJobResources.presentedStepById.get(step.id)}
                            attemptsStepId={selectedJobResources.attemptsStepId}
                            attemptsQuery={selectedJobResources.attemptsQuery}
                            onRequest={selectedJobResources.requestOlderAttempts}
                          />
                        )}
                        renderExpandedStep={(context) => (
                          <ExpandedStep
                            context={context}
                            pageScrollRef={pageScrollRef}
                            search={logSearch}
                            wrap={wrapLogs}
                            showLineNumbers={showLineNumbers}
                            attemptId={context.attemptId}
                            refreshToken={logRefreshTokens[context.attemptId] ?? 0}
                            onFetchingChange={handleLogFetchingChange}
                          />
                        )}
                        renderInspector={(entry) => (
                          <StepInspectorSheet
                            entry={entry}
                            open
                            onOpenChange={(open) => onInspectorOpenChange(open ? entry.id : null)}
                            workspaceSlug={workspaceSlug}
                            projectSlug={projectSlug}
                            workflowRunId={run.id}
                            runAttempt={run.runAttempt.attempt}
                            jobId={job.id}
                            annotationCount={annotationCountForStep(
                              annotationSummaryQuery.data,
                              entry.step.id,
                              entry.attempt,
                            )}
                            onViewLogs={() => {
                              onInspectorOpenChange(null);
                              selectAttempt(entry.id);
                            }}
                          />
                        )}
                      />
                      <SelectedJobStepsPagination query={selectedJobResources.stepsQuery} />
                    </>
                  ) : (
                    <EmptyStateForMissingExecution job={job} />
                  )}
                </PanelBody>
              </Panel>
            </section>
            {showRetargetNotice && runningSelection ? (
              <div
                role="status"
                aria-live="polite"
                className="flex min-w-0 items-center justify-between gap-inline border-t border-border-neutral-base px-row py-row"
              >
                <Text size="xs" className="min-w-0 text-foreground-neutral-muted">
                  Run moved on to{' '}
                  <span className="font-code text-foreground-neutral-base">
                    {runningSelection.stepLabel}
                  </span>
                  .
                </Text>
                <button
                  type="button"
                  className="shrink-0 rounded-4 px-tight py-[4px] text-xs font-medium text-foreground-highlight-interactive outline-none focus-visible:shadow-border-interactive-with-active"
                  onClick={retargetToRunningStep}
                >
                  Jump to it
                </button>
              </div>
            ) : null}
            {succeededSummary ? (
              <Text size="xs" className="px-row py-row text-foreground-neutral-muted">
                {succeededSummary}
              </Text>
            ) : null}
          </section>
        </div>
      </div>
    </TimeTickerProvider>
  );
}

function summarizeLoadedJobAnnotations(
  annotations: ReturnType<typeof useRunAnnotationsQuery>,
  jobId: string,
): RunAnnotationSummary | undefined {
  if (!annotations.annotations) return undefined;
  return summarizeJobAnnotations(annotations.annotations, jobId, {
    truncated: annotations.summary?.truncated ?? false,
  });
}

function resolveAnnotationExecutionId(
  run: JobDetailData | undefined,
  jobId: string,
  search: WorkflowJobSearch,
): string | undefined {
  if (!run || run.job.id !== jobId) return search.jobExecutionId;
  return resolveWorkflowJobSelection({job: run.job, selection: search}).jobExecution?.id;
}

function shouldPollJobAnnotations(run: JobDetailData | undefined): boolean {
  if (!run) return true;
  return !isWorkflowRunTerminal(run.runAttempt.status);
}

function jobDetailQueryBoundary(
  query: JobDetailQuery,
  selectedJobQuery: boolean,
): ReactNode | undefined {
  if (query.isPending || query.data === undefined) {
    if (!query.isError) return <JobDetailSkeleton />;
  }
  if (!query.isError || query.data !== undefined) return undefined;
  if (query.error instanceof ApiError && query.error.status === 404) {
    if (selectedJobQuery) return undefined;
    return <WorkflowRunNotFound />;
  }
  return <QueryLoadError query={query} subject="workflow job" icon="pulseLine" />;
}

function normalizeJobDetailData(
  data: JobDetailQuery['data'],
  workflowRunId: string,
  jobId: string,
  presentation?: WorkflowJobDetailPresentationOptions,
): JobDetailData | undefined {
  if (!data) return undefined;
  if (isWorkflowJobDetail(data)) {
    if (data.job.id !== jobId) return undefined;
    return {
      id: data.workflowRunId,
      runAttempt: {
        attempt: data.workflowRunAttempt,
        status: jobDetailRunStatus(data),
      },
      job: toLegacyJobForJobDetail(data, presentation),
      executionCount: data.job.executionCount,
      executionCountVisible: data.job.executionCountVisible,
      executionDisplayStatus: data.selectedExecution?.displayStatus,
    };
  }

  const job = data.jobs.find((candidate) => candidate.id === jobId);
  return job
    ? {
        id: data.id || workflowRunId,
        runAttempt: data.runAttempt,
        job,
        executionCount: job.jobExecutions.length,
        executionCountVisible: job.executionCountVisible,
        executionDisplayStatus: undefined,
      }
    : undefined;
}

function useSelectedJobDetailPresentation({
  data,
  selectedDetailUpdatedAt,
  selectedJobQuery,
  jobId,
}: {
  data: JobDetailQuery['data'];
  selectedDetailUpdatedAt: number;
  selectedJobQuery: boolean;
  jobId: string;
}) {
  const selectedJobDetail =
    selectedJobQuery && data && isWorkflowJobDetail(data) && data.job.id === jobId
      ? data
      : undefined;
  const selectedDetailExecution = selectedJobDetail?.selectedExecution ?? undefined;
  const [attemptsStepId, setAttemptsStepId] = useState<string | undefined>(undefined);
  const pendingAttemptsStepIdRef = useRef<string | undefined>(undefined);
  const previousSelectedResourceKeyRef = useRef<string | undefined>(undefined);
  const selectedResourceKey = `${selectedJobQuery ? 'selected' : 'legacy'}:${jobId}:${selectedDetailExecution?.id ?? ''}`;

  useEffect(() => {
    if (previousSelectedResourceKeyRef.current === selectedResourceKey) return;
    previousSelectedResourceKeyRef.current = selectedResourceKey;
    pendingAttemptsStepIdRef.current = undefined;
    setAttemptsStepId(undefined);
  }, [selectedResourceKey]);

  const stepsQuery = useWorkflowExecutionStepsInfiniteQuery({
    jobId: selectedJobDetail?.job.id,
    executionId: selectedDetailExecution?.id,
    initialPage: selectedDetailExecution?.steps,
    polling:
      selectedDetailExecution !== undefined &&
      !isTerminalJobExecutionStatus(selectedDetailExecution.status),
    enabled: selectedJobQuery && selectedDetailExecution !== undefined,
  });
  const loadedSteps = useMemo(
    () => flattenWorkflowExecutionStepsPages(stepsQuery.data),
    [stepsQuery.data],
  );
  const stepsResourceIsNewer = stepsQuery.dataUpdatedAt >= selectedDetailUpdatedAt;
  const presentedSteps = useMemo(() => {
    const embeddedSteps = selectedDetailExecution?.steps.items ?? [];
    return mergeWorkflowJobStepSummaries(
      stepsResourceIsNewer ? [embeddedSteps, loadedSteps] : [loadedSteps, embeddedSteps],
    );
  }, [loadedSteps, selectedDetailExecution?.steps.items, stepsResourceIsNewer]);
  const presentedStepById = useMemo(
    () => new Map(presentedSteps.map((step) => [step.id, step] as const)),
    [presentedSteps],
  );
  const attemptsStep = attemptsStepId ? presentedStepById.get(attemptsStepId) : undefined;
  const attemptsQuery = useWorkflowStepAttemptsInfiniteQuery({
    stepId: attemptsStepId,
    initialPage: attemptsStep?.attempts,
    enabled: selectedJobQuery && attemptsStepId !== undefined,
  });
  const loadedAttempts = useMemo(
    () => flattenWorkflowStepAttemptPages(attemptsQuery.data),
    [attemptsQuery.data],
  );
  const attemptsResourceIsNewer = attemptsQuery.dataUpdatedAt >= selectedDetailUpdatedAt;
  const presentedAttemptsByStepId = useMemo(() => {
    if (!attemptsStepId) return undefined;
    const embeddedAttempts = attemptsStep?.attempts.items ?? [];
    return new Map([
      [
        attemptsStepId,
        mergeWorkflowJobStepAttempts(
          attemptsResourceIsNewer
            ? [embeddedAttempts, loadedAttempts]
            : [loadedAttempts, embeddedAttempts],
        ),
      ],
    ]);
  }, [attemptsResourceIsNewer, attemptsStep?.attempts.items, attemptsStepId, loadedAttempts]);

  useEffect(() => {
    if (
      pendingAttemptsStepIdRef.current !== attemptsStepId ||
      attemptsStepId === undefined ||
      attemptsQuery.isFetchingNextPage
    ) {
      return;
    }
    pendingAttemptsStepIdRef.current = undefined;
    if (attemptsQuery.hasNextPage) void attemptsQuery.fetchNextPage();
  }, [
    attemptsQuery.fetchNextPage,
    attemptsQuery.hasNextPage,
    attemptsQuery.isFetchingNextPage,
    attemptsStepId,
  ]);

  const requestOlderAttempts = useCallback(
    (stepId: string) => {
      if (attemptsStepId !== stepId) {
        pendingAttemptsStepIdRef.current = stepId;
        setAttemptsStepId(stepId);
        return;
      }
      if (attemptsQuery.hasNextPage) {
        void attemptsQuery.fetchNextPage();
      } else if (attemptsQuery.isError) {
        void attemptsQuery.refetch();
      }
    },
    [attemptsQuery, attemptsStepId],
  );

  const detailPresentation: WorkflowJobDetailPresentationOptions | undefined = selectedJobDetail
    ? {steps: presentedSteps, attemptsByStepId: presentedAttemptsByStepId}
    : undefined;

  return {
    selectedDetailExecution,
    detailPresentation,
    stepsQuery,
    presentedStepById,
    attemptsStepId,
    attemptsQuery,
    requestOlderAttempts,
  };
}

function StepAttemptHistoryControl({
  step,
  stepSummary,
  attemptsStepId,
  attemptsQuery,
  onRequest,
}: {
  step: StepModel;
  stepSummary: WorkflowJobStepSummary | undefined;
  attemptsStepId: string | undefined;
  attemptsQuery: ReturnType<typeof useWorkflowStepAttemptsInfiniteQuery>;
  onRequest: (stepId: string) => void;
}) {
  const hasMoreAttempts =
    attemptsStepId === step.id
      ? attemptsQuery.hasNextPage || attemptsQuery.isError
      : Boolean(stepSummary?.attempts.nextCursor);
  if (!hasMoreAttempts) return null;

  const isLoading = attemptsStepId === step.id && attemptsQuery.isFetchingNextPage;
  const hasError = attemptsStepId === step.id && attemptsQuery.isError;
  return (
    <div className="flex justify-center border-t border-border-neutral-base py-row">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        isLoading={isLoading}
        onClick={() => onRequest(step.id)}
      >
        {hasError ? 'Retry loading older attempts' : 'Load older attempts'}
      </Button>
    </div>
  );
}

function SelectedJobStepsPagination({
  query,
}: {
  query: ReturnType<typeof useWorkflowExecutionStepsInfiniteQuery>;
}) {
  if (!query.hasNextPage && !query.isError) return null;
  return (
    <div className="flex justify-center border-t border-border-neutral-base py-row">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        isLoading={query.isFetchingNextPage}
        onClick={() => {
          if (query.hasNextPage) {
            void query.fetchNextPage();
          } else {
            void query.refetch();
          }
        }}
      >
        {query.isError ? 'Retry loading older steps' : 'Load older steps'}
      </Button>
    </div>
  );
}

function isWorkflowJobDetail(data: NonNullable<JobDetailQuery['data']>): data is WorkflowJobDetail {
  return 'selectedExecution' in data && 'workflowRunId' in data;
}

function jobDetailRunStatus(detail: WorkflowJobDetail): JobDetailData['runAttempt']['status'] {
  const status = detail.selectedExecution?.status ?? detail.job.status;
  if (status === 'skipped') return 'cancelled';
  return status;
}

function ExpandedStep({
  context,
  pageScrollRef,
  search,
  wrap,
  showLineNumbers,
  attemptId,
  refreshToken,
  onFetchingChange,
}: {
  context: StepExpandedContext;
  pageScrollRef: RefObject<HTMLDivElement | null>;
  search: string;
  wrap: boolean;
  showLineNumbers: boolean;
  attemptId: string;
  refreshToken: number;
  onFetchingChange: (attemptId: string, isFetching: boolean) => void;
}) {
  if (context.carriedOver) return <CarriedOverStepPanel />;

  return (
    <section
      role="region"
      tabIndex={0}
      aria-label={`${context.stepLabel} output, attempt ${context.attempt}`}
      className="flex min-w-0 flex-col border-t border-border-neutral-base bg-background-contrast-base outline-none focus-visible:shadow-border-interactive-with-active"
    >
      <StepAttemptLogPanel
        stepId={context.stepId}
        attempt={context.attempt}
        attemptStatus={context.attemptStatus}
        attemptStartedAt={context.attemptStartedAt}
        pageScrollRef={pageScrollRef}
        search={search}
        wrap={wrap}
        showLineNumbers={showLineNumbers}
        attemptId={attemptId}
        refreshToken={refreshToken}
        onFetchingChange={onFetchingChange}
      />
    </section>
  );
}

function JobLogPanelHeader({
  stepLabel,
  attempt,
  status,
  search,
  onSearchChange,
  onRefresh,
  refreshing,
  showLineNumbers,
  onShowLineNumbersChange,
  wrap,
  onWrapChange,
  disabled,
}: {
  stepLabel: string | undefined;
  attempt: number | undefined;
  status: string | undefined;
  search: string;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  showLineNumbers: boolean;
  onShowLineNumbersChange: (value: boolean) => void;
  wrap: boolean;
  onWrapChange: (value: boolean) => void;
  disabled: boolean;
}) {
  const statusVisual = status ? getStepStatusVisual(status) : undefined;

  return (
    <PanelHeader className="flex flex-wrap items-center gap-group">
      <div className="min-w-0 flex-1">
        <Text size="sm" bold className="truncate text-foreground-neutral-base">
          {stepLabel ?? 'Logs'}
        </Text>
        {statusVisual ? (
          <div className="flex min-w-0 items-center gap-inline text-foreground-neutral-muted">
            <Badge variant={statusVisual.badge} size="2xs" radius="rounded">
              {statusVisual.label}
            </Badge>
            {attempt ? (
              <span className="font-code text-xs leading-20 tabular-nums">attempt {attempt}</span>
            ) : null}
          </div>
        ) : (
          <Text size="xs" className="text-foreground-neutral-muted">
            Select a step to view its logs.
          </Text>
        )}
      </div>
      <PanelActions className="min-w-0 flex-wrap justify-end">
        <SearchInline
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          aria-label="Search logs"
          placeholder="Search logs"
          size="small"
          className="w-180 max-w-full"
          disabled={disabled}
        />
        <IconButton
          type="button"
          variant="transparent"
          size="sm"
          icon="refreshLine"
          aria-label="Refresh logs"
          onClick={onRefresh}
          disabled={disabled || refreshing}
          isLoading={refreshing}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              type="button"
              variant="transparent"
              size="sm"
              icon="settings3Line"
              aria-label="Log settings"
              disabled={disabled}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" size="sm">
            <DropdownMenuLabel>Log display</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={showLineNumbers}
              onCheckedChange={onShowLineNumbersChange}
            >
              Line numbers
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem checked={wrap} onCheckedChange={onWrapChange}>
              Wrap long lines
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </PanelActions>
    </PanelHeader>
  );
}

function EmptyStateForMissingExecution({job}: {job: Job}) {
  const emptyState = emptyStateForMissingExecution(job);
  return (
    <EmptyState
      icon="componentLine"
      title={emptyState.title}
      description={emptyState.description}
      variant="panel"
    />
  );
}

function JobNotFoundState({
  workspaceSlug,
  projectSlug,
  workflowRunId,
  search,
}: {
  workspaceSlug: string;
  projectSlug: string;
  workflowRunId: string;
  search: WorkflowJobSearch;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-cluster p-panel">
      <EmptyState
        icon="componentLine"
        title="Job not found"
        description="This job is not part of the selected workflow run."
      />
      <Link
        to="/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId"
        params={{workspaceSlug, projectSlug, workflowRunId}}
        search={
          workflowRunSearchParams(
            {runAttempt: search.runAttempt},
            {runAttempt: search.runAttempt},
          ) as never
        }
        className="inline-flex items-center gap-inline rounded-6 px-tight py-[6px] text-sm text-foreground-highlight-interactive outline-none focus-visible:shadow-border-interactive-with-active"
      >
        <Icon name="arrowLeftLine" size={14} aria-hidden="true" />
        Back to run summary
      </Link>
    </div>
  );
}

function NewerAttemptNotice({
  workspaceSlug,
  projectSlug,
  runId,
  jobId,
  attempt,
}: {
  workspaceSlug: string;
  projectSlug: string;
  runId: string;
  jobId: string;
  attempt: number;
}) {
  return (
    <div role="status" className="border-b border-border-neutral-base px-row py-row">
      <div className="flex items-center justify-between gap-inline">
        <Text size="xs" className="text-foreground-neutral-muted">
          A newer run attempt is available.
        </Text>
        <Link
          to="/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId/jobs/$jobId"
          params={{workspaceSlug, projectSlug, workflowRunId: runId, jobId}}
          search={workflowJobSearchParams({runAttempt: attempt}) as never}
          className="shrink-0 rounded-4 px-tight py-[4px] text-xs font-medium text-foreground-highlight-interactive outline-none focus-visible:shadow-border-interactive-with-active"
        >
          View attempt #{attempt}
        </Link>
      </div>
    </div>
  );
}

function runningStepSelection(jobExecution: JobExecution | undefined, model: StepListModel) {
  if (!jobExecution) return undefined;
  const steps = [...jobExecution.steps].sort(
    (left, right) => left.position - right.position || left.id.localeCompare(right.id),
  );
  for (let stepIndex = steps.length - 1; stepIndex >= 0; stepIndex -= 1) {
    const step = steps[stepIndex];
    if (!step) continue;
    const attempt = [...step.attempts]
      .sort((left, right) => left.attempt - right.attempt || left.id.localeCompare(right.id))
      .reverse()
      .find((candidate) => candidate.status === 'running');
    if (attempt)
      return {
        stepId: step.id,
        attemptId: attempt.id,
        stepLabel: model.entries.find((entry) => entry.id === attempt.id)?.step.label ?? 'Step',
      };
  }
  return undefined;
}

function findAttempt(jobExecution: JobExecution, attemptId: string) {
  for (const step of jobExecution.steps) {
    const attempt = step.attempts.find((candidate) => candidate.id === attemptId);
    if (attempt) return {step, attemptId: attempt.id};
  }
  return undefined;
}

function findExpandedLogSelection(
  jobExecution: JobExecution | undefined,
  attemptIds: readonly string[],
  model: StepListModel,
) {
  if (!jobExecution) return undefined;

  for (let index = attemptIds.length - 1; index >= 0; index -= 1) {
    const attemptId = attemptIds[index];
    if (!attemptId) continue;
    const match = findAttempt(jobExecution, attemptId);
    const attempt = match?.step.attempts.find((candidate) => candidate.id === attemptId);
    const entry = model.entries.find((candidate) => candidate.id === attemptId);
    if (match && attempt && entry) return {step: match.step, attempt, stepLabel: entry.step.label};
  }

  return undefined;
}

function annotationCountForStep(
  summary: RunAnnotationSummary | undefined,
  stepId: string,
  attempt: number,
): number | undefined {
  return summary?.stepCounts?.find((entry) => entry.stepId === stepId && entry.attempt === attempt)
    ?.total;
}

function resolveJobDetailState({
  job,
  search,
  landingSelectionRef,
  expandedLogAttemptIds,
  logFetchingByAttemptId,
}: {
  job: Job;
  search: WorkflowJobSearch;
  landingSelectionRef: {current: FrozenLandingSelection | undefined};
  expandedLogAttemptIds: readonly string[];
  logFetchingByAttemptId: Readonly<Record<string, boolean>>;
}) {
  const resolvedSelection = resolveWorkflowJobSelection({job, selection: search});
  const selectedJobExecution = resolvedSelection.jobExecution;
  const hasExplicitStep = Boolean(search.stepId && resolvedSelection.step);
  const stepListModel = buildStepListModel({job, jobExecution: selectedJobExecution});
  updateFrozenLandingSelection(
    landingSelectionRef,
    job,
    selectedJobExecution,
    workflowJobLandingSelection(selectedJobExecution),
  );
  const landingSelection = landingSelectionRef.current?.selection;
  const selectedAttemptId = hasExplicitStep ? resolvedSelection.selectedAttemptId : undefined;
  const runningSelection = runningStepSelection(selectedJobExecution, stepListModel);
  const selectedStepId = resolvedSelection.step?.id ?? landingSelection?.stepId;
  const selectedAttemptForNotice = hasExplicitStep
    ? resolvedSelection.selectedAttemptId
    : landingSelection?.attemptId;
  const expandedLogSelection = findExpandedLogSelection(
    selectedJobExecution,
    expandedLogAttemptIds,
    stepListModel,
  );
  const selectedLogAttempt = expandedLogSelection?.attempt;
  const selectedLogStatus = selectedLogAttempt?.status ?? expandedLogSelection?.step.status;
  const logIsFetching = Boolean(
    selectedLogAttempt && logFetchingByAttemptId[selectedLogAttempt.id],
  );
  const showRetargetNotice = shouldShowRetargetNotice(
    runningSelection,
    selectedStepId,
    selectedAttemptForNotice,
  );
  const succeededSummary = successfulJobSummary(
    job,
    selectedJobExecution,
    hasExplicitStep,
    landingSelection,
  );
  return {
    selectedJobExecution,
    landingSelection,
    selectedAttemptId,
    runningSelection,
    expandedLogSelection,
    selectedLogAttempt,
    selectedLogStatus,
    logIsFetching,
    showRetargetNotice,
    succeededSummary,
  };
}

function updateFrozenLandingSelection(
  ref: {current: FrozenLandingSelection | undefined},
  job: Job,
  execution: JobExecution | undefined,
  currentSelection: WorkflowJobLandingSelection | undefined,
): void {
  if (!execution) {
    ref.current = undefined;
    return;
  }
  const frozen = ref.current;
  if (!frozen || frozen.jobId !== job.id || frozen.jobExecutionId !== execution.id) {
    ref.current = {
      jobId: job.id,
      jobExecutionId: execution.id,
      selection: currentSelection,
      hasSelection: currentSelection !== undefined,
    };
    return;
  }
  if (!frozen.hasSelection && currentSelection) {
    ref.current = {...frozen, selection: currentSelection, hasSelection: true};
  }
}

function shouldShowRetargetNotice(
  runningSelection: ReturnType<typeof runningStepSelection>,
  selectedStepId: string | undefined,
  selectedAttemptId: string | null | undefined,
): boolean {
  if (!runningSelection) return false;
  return (
    selectedStepId !== runningSelection.stepId || selectedAttemptId !== runningSelection.attemptId
  );
}

function successfulJobSummary(
  job: Job,
  execution: JobExecution | undefined,
  hasExplicitStep: boolean,
  landingSelection: WorkflowJobLandingSelection | undefined,
): string | undefined {
  if (hasExplicitStep || landingSelection !== undefined || !execution) return undefined;
  return jobSucceededSummary(job, execution);
}

function JobDetailSkeleton() {
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-auto pb-panel">
      <div className="w-full">
        <header className="flex items-center gap-cluster border-b border-border-neutral-base px-row py-row">
          <Skeleton className="size-20 rounded-full" />
          <Skeleton className="h-20 w-160 rounded-4" />
          <Skeleton className="h-24 w-72 rounded-6" />
          <Skeleton className="h-24 w-180 rounded-4" />
        </header>
        <div className="p-panel-compact">
          {JOB_DETAIL_SKELETON_ROWS.map((row) => (
            <div
              key={row}
              className="flex min-h-44 items-center gap-inline border-b border-border-neutral-base last:border-b-0"
            >
              <Skeleton className="size-14 rounded-full" />
              <Skeleton className="h-16 w-180 rounded-4" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const JOB_DETAIL_SKELETON_ROWS = ['step-1', 'step-2', 'step-3', 'step-4', 'step-5'];

interface FrozenLandingSelection {
  jobId: string;
  jobExecutionId: string;
  selection: WorkflowJobLandingSelection | undefined;
  hasSelection: boolean;
}
