// biome-ignore-all lint/a11y/noRedundantRoles: the job log region keeps an explicit role for the public accessibility contract.
// biome-ignore-all lint/a11y/noNoninteractiveTabindex: the job log region is intentionally keyboard focusable.

import {ApiError} from '@shipfox/client-api';
import {QueryLoadError} from '@shipfox/client-ui';
import {Badge} from '@shipfox/react-ui/badge';
import {IconButton} from '@shipfox/react-ui/button';
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
import {type RefObject, useEffect, useRef, useState} from 'react';
import type {RunAnnotationSummary} from '#core/run-annotation.js';
import {summarizeJobAnnotations} from '#core/run-annotation.js';
import {isWorkflowRunTerminal, type Job, type JobExecution, type Step} from '#core/workflow-run.js';
import {useWorkflowRunAnnotationSummaryQuery} from '#hooks/api/annotations.js';
import {useRunAnnotationsQuery} from '#hooks/api/run-annotations.js';
import type {useWorkflowRunAttemptQuery} from '#hooks/api/workflow-runs.js';
import {
  type WorkflowJobSearch,
  workflowJobSearchParams,
  workflowRunSearchParams,
} from '#routes/inputs.js';
import {type StepExpandedContext, StepList} from '../step-list/index.js';
import {getStepStatusVisual} from '../step-list/step-list-model.js';
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

export interface JobDetailViewProps {
  workspaceSlug: string;
  projectSlug: string;
  workflowRunId: string;
  jobId: string;
  search: WorkflowJobSearch;
  query: ReturnType<typeof useWorkflowRunAttemptQuery>;
  newerAttempt?: number | undefined;
  newerJob?: Job | undefined;
  onSelectionChange: (selection: WorkflowJobSearch) => void;
}

export function JobDetailView({
  workspaceSlug,
  projectSlug,
  workflowRunId,
  jobId,
  search,
  query,
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
  const [logRefreshToken, setLogRefreshToken] = useState(0);
  const hasLoadedData = query.data !== undefined;
  // Reuse the run workspace's bounded annotation read for the job header chip. The separate
  // summary query below stays counts-only and is scoped to the inspector's selected execution.
  const annotations = useRunAnnotationsQuery({
    workflowRunId,
    runAttempt: query.data?.runAttempt.attempt,
  });
  const jobAnnotationSummary = annotations.annotations
    ? summarizeJobAnnotations(annotations.annotations, jobId, {
        truncated: annotations.summary?.truncated ?? false,
      })
    : undefined;
  const inspectorResetKey = `${jobId}:${search.jobExecutionId ?? ''}`;
  const [inspectorState, setInspectorState] = useState<InspectorState>(() => ({
    key: inspectorResetKey,
    attemptId: null,
  }));
  const inspectorOpenAttemptId =
    inspectorState.key === inspectorResetKey ? inspectorState.attemptId : null;
  const annotationJob = query.data?.jobs.find((candidate) => candidate.id === jobId);
  const annotationExecutionId = annotationJob
    ? resolveWorkflowJobSelection({job: annotationJob, selection: search}).jobExecution?.id
    : search.jobExecutionId;
  const annotationPolling = query.data
    ? !isWorkflowRunTerminal(query.data.runAttempt.status)
    : true;
  const annotationSummaryQuery = useWorkflowRunAnnotationSummaryQuery(
    query.data?.id,
    query.data?.runAttempt.attempt,
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

  if (query.isPending) return <JobDetailSkeleton />;

  if (query.isError && query.data === undefined) {
    if (query.error instanceof ApiError && query.error.status === 404) {
      return <WorkflowRunNotFound />;
    }
    return <QueryLoadError query={query} subject="workflow run" icon="pulseLine" />;
  }

  if (query.data === undefined) return <JobDetailSkeleton />;

  const run = query.data;
  const job = run.jobs.find((candidate) => candidate.id === jobId);
  if (!job) {
    return (
      <JobNotFoundState
        workspaceSlug={workspaceSlug}
        projectSlug={projectSlug}
        workflowRunId={workflowRunId}
        search={search}
      />
    );
  }

  const resolvedSelection = resolveWorkflowJobSelection({job, selection: search});
  const selectedJobExecution = resolvedSelection.jobExecution;
  const hasExplicitStep = Boolean(search.stepId && resolvedSelection.step);
  const currentLandingSelection = workflowJobLandingSelection(selectedJobExecution);
  if (selectedJobExecution) {
    const frozenLanding = landingSelectionRef.current;
    if (
      !frozenLanding ||
      frozenLanding.jobId !== job.id ||
      frozenLanding.jobExecutionId !== selectedJobExecution.id
    ) {
      landingSelectionRef.current = {
        jobId: job.id,
        jobExecutionId: selectedJobExecution.id,
        selection: currentLandingSelection,
        hasSelection: currentLandingSelection !== undefined,
      };
    } else if (!frozenLanding.hasSelection && currentLandingSelection) {
      landingSelectionRef.current = {
        ...frozenLanding,
        selection: currentLandingSelection,
        hasSelection: true,
      };
    }
  } else {
    landingSelectionRef.current = undefined;
  }
  const landingSelection = landingSelectionRef.current?.selection;
  const selectedAttemptId = hasExplicitStep ? resolvedSelection.selectedAttemptId : undefined;
  const runningSelection = runningStepSelection(selectedJobExecution);
  const selectedStepId = resolvedSelection.step?.id ?? landingSelection?.stepId;
  const selectedAttemptForNotice = hasExplicitStep
    ? resolvedSelection.selectedAttemptId
    : landingSelection?.attemptId;
  const selectedLogStep = selectedJobExecution?.steps.find((step) => step.id === selectedStepId);
  const selectedLogAttempt = selectedLogStep?.attempts.find(
    (attempt) => attempt.id === (selectedAttemptForNotice ?? undefined),
  );
  const selectedLogStatus = selectedLogAttempt?.status ?? selectedLogStep?.status;
  const showRetargetNotice =
    runningSelection !== undefined &&
    (selectedStepId !== runningSelection.stepId ||
      selectedAttemptForNotice !== runningSelection.attemptId);
  const succeededSummary =
    !hasExplicitStep && landingSelection === undefined && selectedJobExecution
      ? jobSucceededSummary(job, selectedJobExecution)
      : undefined;

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
    if (selectedLogStep && selectedLogAttempt) {
      setLogRefreshToken((token) => token + 1);
      return;
    }
    void query.refetch();
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
                jobContext={
                  selectedJobExecution ? (
                    <JobContextPanel job={job} execution={selectedJobExecution} />
                  ) : undefined
                }
              />
              <Panel data-job-log-panel className="min-w-0">
                <JobLogPanelHeader
                  step={selectedLogStep}
                  attempt={selectedLogAttempt?.attempt}
                  status={selectedLogStatus}
                  search={logSearch}
                  onSearchChange={setLogSearch}
                  onRefresh={refreshLogs}
                  showLineNumbers={showLineNumbers}
                  onShowLineNumbersChange={setShowLineNumbers}
                  wrap={wrapLogs}
                  onWrapChange={setWrapLogs}
                  disabled={!selectedLogStep}
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
                        inspectorOpenAttemptId={inspectorOpenAttemptId}
                        onInspectorOpenChange={onInspectorOpenChange}
                        autoSelectActiveAttempt
                        emptyState={emptyStateForJob(job, selectedJobExecution)}
                        showHeader={false}
                        className="rounded-none border-0 bg-transparent shadow-none"
                        renderExpandedStep={(context) => (
                          <ExpandedStep
                            context={context}
                            pageScrollRef={pageScrollRef}
                            search={logSearch}
                            wrap={wrapLogs}
                            showLineNumbers={showLineNumbers}
                            refreshToken={logRefreshToken}
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
                          />
                        )}
                      />
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

function ExpandedStep({
  context,
  pageScrollRef,
  search,
  wrap,
  showLineNumbers,
  refreshToken,
}: {
  context: StepExpandedContext;
  pageScrollRef: RefObject<HTMLDivElement | null>;
  search: string;
  wrap: boolean;
  showLineNumbers: boolean;
  refreshToken: number;
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
        refreshToken={refreshToken}
      />
    </section>
  );
}

function JobLogPanelHeader({
  step,
  attempt,
  status,
  search,
  onSearchChange,
  onRefresh,
  showLineNumbers,
  onShowLineNumbersChange,
  wrap,
  onWrapChange,
  disabled,
}: {
  step: Step | undefined;
  attempt: number | undefined;
  status: string | undefined;
  search: string;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
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
          {step ? stepLabel(step) : 'Logs'}
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
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              type="button"
              variant="transparent"
              size="sm"
              icon="settings3Line"
              aria-label="Log settings"
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

function stepLabel(step: Pick<Step, 'name' | 'key'>): string {
  const name = step.name.trim();
  if (name) return name;

  const key = step.key?.trim();
  return key || 'Step';
}

function EmptyStateForMissingExecution({job}: {job: Job}) {
  const emptyState = emptyStateForMissingExecution(job);
  return (
    <EmptyState
      className="min-h-120 p-panel"
      icon="componentLine"
      title={emptyState.title}
      description={emptyState.description}
      variant="compact"
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

function runningStepSelection(jobExecution: JobExecution | undefined) {
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
      return {stepId: step.id, attemptId: attempt.id, stepLabel: step.name || step.key || step.id};
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

function annotationCountForStep(
  summary: RunAnnotationSummary | undefined,
  stepId: string,
  attempt: number,
): number | undefined {
  return summary?.stepCounts?.find((entry) => entry.stepId === stepId && entry.attempt === attempt)
    ?.total;
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
