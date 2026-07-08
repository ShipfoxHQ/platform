import {ApiError} from '@shipfox/client-api';
import {QueryLoadError} from '@shipfox/client-ui';
import {RelativeTimeProvider} from '@shipfox/react-ui/relative-time';
import {toast} from '@shipfox/react-ui/toast';
import {useNavigate} from '@tanstack/react-router';
import {useEffect, useId, useRef, useState} from 'react';
import {
  type JobExecution,
  resolveJobExecution,
  type StepSourceLocation,
  type WorkflowRunRerunMode,
} from '#core/workflow-run.js';
import {
  type WorkflowRunSelectionInput,
  withoutWorkflowRunSelectionSearch,
} from '#core/workflow-run-url-state.js';
import {useRunAnnotationsQuery} from '#hooks/api/run-annotations.js';
import {
  useCancelWorkflowRunMutation,
  useRerunWorkflowRunMutation,
  useWorkflowRunAttemptQuery,
} from '#hooks/api/workflow-runs.js';
import {JobGraph} from '../job-graph/index.js';
import {WorkflowRunSummary} from '../workflow-run-summary/index.js';
import {WorkflowSourcePanel} from '../workflow-source-panel/index.js';
import {JobCard} from './job-card.js';
import {RunAnnotationsPanel} from './run-annotations-panel.js';
import {resolveWorkflowRunSelection} from './workflow-run-selection.js';
import {
  WorkflowRunNotFound,
  WorkflowRunSkeleton,
  WorkflowRunStaleError,
} from './workflow-run-states.js';

interface WorkflowSourceFocus {
  stepId: string;
  location: StepSourceLocation;
}

export interface WorkflowRunViewProps {
  workspaceId: string;
  projectId: string;
  workflowRunId?: string | undefined;
  selection?: WorkflowRunSelectionInput | undefined;
  onSelectionChange?: ((selection: WorkflowRunSelectionInput) => void) | undefined;
}

/**
 * Renders the run for `workflowRunId`, or a skeleton while `workflowRunId` is still unknown (the page is
 * resolving which run to show) or the run is loading, so the page never branches on the
 * loading state itself.
 */
export function WorkflowRunView({
  workspaceId,
  projectId,
  workflowRunId,
  selection,
  onSelectionChange,
}: WorkflowRunViewProps) {
  const runQuery = useWorkflowRunAttemptQuery({workflowRunId, runAttempt: selection?.runAttempt});
  const rerunMutation = useRerunWorkflowRunMutation(projectId);

  return (
    <RelativeTimeProvider>
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <RunViewContent
          workspaceId={workspaceId}
          projectId={projectId}
          query={runQuery}
          rerunMutation={rerunMutation}
          selection={selection}
          onSelectionChange={onSelectionChange}
        />
      </div>
    </RelativeTimeProvider>
  );
}

function RunViewContent({
  workspaceId,
  projectId,
  query,
  rerunMutation,
  selection,
  onSelectionChange,
}: {
  workspaceId: string;
  projectId: string;
  query: ReturnType<typeof useWorkflowRunAttemptQuery>;
  rerunMutation: ReturnType<typeof useRerunWorkflowRunMutation>;
  selection: WorkflowRunSelectionInput | undefined;
  onSelectionChange: ((selection: WorkflowRunSelectionInput) => void) | undefined;
}) {
  const navigate = useNavigate();
  const [selectedJobId, setSelectedJobId] = useState<string | undefined>();
  const [selectedJobExecutionId, setSelectedJobExecutionId] = useState<string | undefined>();
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  const [sourceFocus, setSourceFocus] = useState<WorkflowSourceFocus | null>(null);
  const sourcePanelId = useId();
  const sourceButtonRef = useRef<HTMLButtonElement>(null);
  // The button that last opened the panel (summary or a step detail), so Escape /
  // Close returns focus to whoever opened it.
  const lastSourceTriggerRef = useRef<HTMLButtonElement | null>(null);
  const selectionControlled = selection !== undefined;
  const sourceAvailable =
    query.data?.sourceSnapshot !== null && query.data?.sourceSnapshot !== undefined;
  const cancelMutation = useCancelWorkflowRunMutation(query.data);
  const annotationsQuery = useRunAnnotationsQuery({
    workflowRunId: query.data?.id,
    runAttempt: query.data?.runAttempt.attempt,
    runStatus: query.data?.runAttempt.status,
  });

  useEffect(() => {
    if (!sourceAvailable) {
      setSourcePanelOpen(false);
      setSourceFocus(null);
    }
  }, [sourceAvailable]);

  // If a refetch drops the focused step or its location, degrade to whole-workflow
  // focus so the panel never points at an unmounted Source button.
  useEffect(() => {
    if (!sourceFocus) return;
    const stillLocated = query.data?.jobs.some((job) =>
      job.jobExecutions.some((execution) =>
        execution.steps.some((step) => step.id === sourceFocus.stepId && step.sourceLocation),
      ),
    );
    if (!stillLocated) {
      setSourceFocus(null);
      lastSourceTriggerRef.current = sourceButtonRef.current;
    }
  }, [sourceFocus, query.data]);

  if (query.isPending) return <WorkflowRunSkeleton />;

  // Only show the full error placeholder when nothing ever loaded. A refetch that fails after
  // a prior success keeps the loaded run on screen (see below) instead of wiping the pane,
  // since active-run polling can hit a transient API error.
  if (query.isError && query.data === undefined) {
    if (query.error instanceof ApiError && query.error.status === 404) {
      return <WorkflowRunNotFound />;
    }
    return <QueryLoadError query={query} subject="workflow run" icon="pulseLine" />;
  }

  if (query.data === undefined) return <WorkflowRunSkeleton />;

  const runData = query.data;
  const annotations = annotationsQuery.data ?? [];
  const resolvedSelection = selectionControlled
    ? resolveWorkflowRunSelection({run: runData, selection})
    : undefined;
  const selectedJob = selectionControlled
    ? resolvedSelection?.job
    : (runData.jobs.find((job) => job.id === selectedJobId) ?? runData.jobs.at(0));
  const selectedJobExecution = selectionControlled
    ? resolvedSelection?.jobExecution
    : selectedJob
      ? resolveJobExecution(selectedJob, selectedJobExecutionId)
      : undefined;
  const selectedAttemptId = selectionControlled
    ? (resolvedSelection?.selectedAttemptId ?? null)
    : undefined;
  // Explicit per-step focus wins; fall back to the URL-selected step so deep links
  // still pre-highlight when the summary opens the whole-workflow source.
  const highlightedLineRange =
    sourceFocus?.location ?? resolvedSelection?.step?.sourceLocation ?? null;
  const sourceSnapshot = runData.sourceSnapshot;
  async function rerun(mode: WorkflowRunRerunMode) {
    try {
      const run = await rerunMutation.mutateAsync({workflowRunId: runData.id, mode});
      toast.success('Re-run started');
      await navigate({
        to: '/workspaces/$wid/projects/$pid/runs/$workflowRunId',
        params: {wid: workspaceId, pid: projectId, workflowRunId: run.id},
        search: ((previous: Record<string, unknown>) =>
          withoutWorkflowRunSelectionSearch(previous)) as never,
      });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not start re-run');
    }
  }

  function selectJob(jobId: string | undefined) {
    if (!selectionControlled) {
      setSelectedJobId(jobId);
      setSelectedJobExecutionId(undefined);
      return;
    }

    onSelectionChange?.(
      jobId ? {jobId, runAttempt: selection?.runAttempt} : {runAttempt: selection?.runAttempt},
    );
  }

  function selectJobExecution(jobExecutionId: string | undefined) {
    if (!selectionControlled) {
      setSelectedJobExecutionId(jobExecutionId);
      return;
    }
    if (!selectedJob) return;

    onSelectionChange?.({
      jobId: selectedJob.id,
      jobExecutionId,
      runAttempt: selection?.runAttempt,
    });
  }

  function selectAttempt(attemptId: string | undefined) {
    if (!selectionControlled || !selectedJob || !selectedJobExecution) return;

    if (!attemptId) {
      onSelectionChange?.({
        jobId: selectedJob.id,
        jobExecutionId: selectedJobExecution.id,
        runAttempt: selection?.runAttempt,
      });
      return;
    }

    const match = findAttemptSelection(selectedJobExecution, attemptId);
    if (!match) return;

    onSelectionChange?.({
      jobId: selectedJob.id,
      jobExecutionId: selectedJobExecution.id,
      stepId: match.stepId,
      stepAttemptId: match.attemptId,
      runAttempt: selection?.runAttempt,
    });
  }

  function openWholeWorkflowSource() {
    setSourceFocus(null);
    lastSourceTriggerRef.current = sourceButtonRef.current;
    setSourcePanelOpen(true);
  }

  function toggleWholeWorkflowSource() {
    if (sourcePanelOpen && sourceFocus === null) {
      closeSourcePanel();
      return;
    }
    openWholeWorkflowSource();
  }

  function openStepSource(
    stepId: string,
    location: StepSourceLocation,
    trigger: HTMLButtonElement | null,
  ) {
    setSourceFocus({stepId, location});
    lastSourceTriggerRef.current = trigger;
    setSourcePanelOpen(true);
  }

  function closeSourcePanel() {
    const trigger = lastSourceTriggerRef.current;
    const fallbackTrigger = sourceButtonRef.current;
    setSourcePanelOpen(false);
    // Defer so focus lands after the panel unmounts; clear the focus only after
    // focusing so the opener button is still expanded (force-visible) on return.
    window.setTimeout(() => {
      const focusTarget = trigger?.isConnected ? trigger : fallbackTrigger;
      focusTarget?.focus();
      setSourceFocus(null);
    }, 0);
  }

  function cancelRun() {
    cancelMutation.mutate(undefined, {
      onError: (error) => {
        toast.error(cancelErrorMessage(error));
      },
    });
  }

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col">
        <WorkflowRunSummary
          workspaceId={workspaceId}
          projectId={projectId}
          run={runData}
          sourceAvailable={sourceAvailable}
          sourceOpen={sourcePanelOpen && sourceFocus === null}
          sourcePanelId={sourcePanelId}
          sourceButtonRef={sourceButtonRef}
          onSourceToggle={toggleWholeWorkflowSource}
          cancelling={cancelMutation.isPending}
          onCancel={cancelRun}
          rerunPending={rerunMutation.isPending}
          onRerun={(mode) => void rerun(mode)}
          latestAttempt={runData.latestAttempt}
        />
        {query.isError ? <WorkflowRunStaleError query={query} /> : null}
        <div className="min-h-0 flex-1 overflow-auto bg-background-neutral-base p-16">
          <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-16">
            <RunAnnotationsPanel annotations={annotations} jobs={runData.jobs} />
            <JobGraph
              run={runData}
              selectedJobId={selectedJob?.id}
              onSelectedJobChange={selectJob}
            />
            {selectedJob ? (
              <JobCard
                workspaceId={workspaceId}
                job={selectedJob}
                selectedJobExecution={selectedJobExecution}
                selectedAttemptId={selectedJob.carriedOver ? undefined : selectedAttemptId}
                onSelectedJobExecutionChange={selectJobExecution}
                onSelectedAttemptChange={selectionControlled ? selectAttempt : undefined}
                sourcePanelId={sourcePanelId}
                sourceAvailable={sourceAvailable}
                focusedSourceStepId={sourceFocus?.stepId ?? null}
                onOpenStepSource={openStepSource}
                annotations={annotations}
              />
            ) : null}
          </div>
        </div>
      </div>
      <WorkflowSourcePanel
        id={sourcePanelId}
        source={sourceSnapshot}
        open={sourcePanelOpen && sourceAvailable}
        onClose={closeSourcePanel}
        highlightedLineRange={highlightedLineRange}
        scrollHighlightedIntoView
      />
    </>
  );
}

function cancelErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === 'run-already-finished') {
    return 'This workflow run has already finished.';
  }
  return 'Could not cancel workflow run.';
}

function findAttemptSelection(jobExecution: JobExecution, attemptId: string) {
  for (const step of jobExecution.steps) {
    const attempt = step.attempts.find((candidate) => candidate.id === attemptId);
    if (attempt) return {stepId: step.id, attemptId: attempt.id};
  }
  return undefined;
}
