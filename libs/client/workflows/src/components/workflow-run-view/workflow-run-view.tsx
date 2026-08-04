import {ApiError} from '@shipfox/client-api';
import {QueryLoadError} from '@shipfox/client-ui';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {RelativeTimeProvider} from '@shipfox/react-ui/relative-time';
import {Tabs, TabsContent, TabsContents} from '@shipfox/react-ui/tabs';
import {toast} from '@shipfox/react-ui/toast';
import {useNavigate} from '@tanstack/react-router';
import {useEffect, useId, useRef, useState} from 'react';
import {
  type JobExecution,
  resolveJobExecution,
  type StepSourceLocation,
  type WorkflowRunRerunMode,
} from '#core/workflow-run.js';
import type {RunAnnotationSummary} from '#core/workflow-run-tabs.js';
import {
  type WorkflowRunSelectionInput,
  withoutWorkflowRunSelectionSearch,
} from '#core/workflow-run-url-state.js';
import {
  useCancelWorkflowRunMutation,
  useRerunWorkflowRunMutation,
  useWorkflowRunAttemptQuery,
} from '#hooks/api/workflow-runs.js';
import {WORKFLOW_RUN_TABS, type WorkflowRunTab} from '#routes/inputs.js';
import {JobGraph} from '../job-graph/index.js';
import type {JobGraphSelectionSource} from '../job-graph/types.js';
import {WorkflowRunSummary} from '../workflow-run-summary/index.js';
import {RunAnnotationsEmpty, RunJobsList, RunTabStrip} from '../workflow-run-tabs/index.js';
import {WorkflowSourceContent, WorkflowSourcePanel} from '../workflow-source-panel/index.js';
import {resolveWorkflowRunSelection} from './workflow-run-selection.js';
import {
  WorkflowRunContentSkeleton,
  WorkflowRunNotFound,
  WorkflowRunSkeleton,
  WorkflowRunStaleError,
} from './workflow-run-states.js';

interface WorkflowSourceFocus {
  stepId: string;
  location: StepSourceLocation;
}

export interface WorkflowRunViewProps {
  projectId: string;
  workspaceSlug?: string | undefined;
  projectSlug?: string | undefined;
  workflowRunId?: string | undefined;
  selection?: WorkflowRunSelectionInput | undefined;
  onSelectionChange?: ((selection: WorkflowRunSelectionInput) => void) | undefined;
  tab?: WorkflowRunTab | undefined;
  onTabChange?: ((tab: WorkflowRunTab) => void) | undefined;
  annotationSummary?: RunAnnotationSummary | undefined;
}

/**
 * Renders the run for `workflowRunId`, keeping the local tab strip mounted while the run
 * request is pending so polling never inserts navigation under the user's cursor.
 */
export function WorkflowRunView({
  projectId,
  workspaceSlug,
  projectSlug,
  workflowRunId,
  selection,
  onSelectionChange,
  tab,
  onTabChange,
  annotationSummary,
}: WorkflowRunViewProps) {
  const runQuery = useWorkflowRunAttemptQuery({workflowRunId, runAttempt: selection?.runAttempt});
  const rerunMutation = useRerunWorkflowRunMutation(projectId);

  return (
    <RelativeTimeProvider>
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <RunViewContent
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          query={runQuery}
          rerunMutation={rerunMutation}
          selection={selection}
          onSelectionChange={onSelectionChange}
          tab={tab}
          onTabChange={onTabChange}
          annotationSummary={annotationSummary}
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
  selection,
  onSelectionChange,
  tab,
  onTabChange,
  annotationSummary,
}: {
  workspaceSlug: string | undefined;
  projectSlug: string | undefined;
  query: ReturnType<typeof useWorkflowRunAttemptQuery>;
  rerunMutation: ReturnType<typeof useRerunWorkflowRunMutation>;
  selection: WorkflowRunSelectionInput | undefined;
  onSelectionChange: ((selection: WorkflowRunSelectionInput) => void) | undefined;
  tab: WorkflowRunTab | undefined;
  onTabChange: ((tab: WorkflowRunTab) => void) | undefined;
  annotationSummary: RunAnnotationSummary | undefined;
}) {
  const navigate = useNavigate();
  const [selectedJobId, setSelectedJobId] = useState<string | undefined>();
  const [selectedJobExecutionId, setSelectedJobExecutionId] = useState<string | undefined>();
  const [localTab, setLocalTab] = useState<WorkflowRunTab>(tab ?? 'summary');
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  const [sourceFocus, setSourceFocus] = useState<WorkflowSourceFocus | null>(null);
  const sourcePanelId = useId();
  // The step Source button that last opened the panel, so Escape / Close returns focus to it.
  const lastSourceTriggerRef = useRef<HTMLButtonElement | null>(null);
  const selectionControlled = selection !== undefined;
  const tabControlled = onTabChange !== undefined;
  const activeTab = tabControlled ? (tab ?? 'summary') : localTab;
  const sourceAvailable =
    query.data?.sourceSnapshot !== null && query.data?.sourceSnapshot !== undefined;
  const cancelMutation = useCancelWorkflowRunMutation(query.data);

  useEffect(() => {
    if (!sourceAvailable) {
      setSourcePanelOpen(false);
      setSourceFocus(null);
    }
  }, [sourceAvailable]);

  // If a refetch drops the focused step or its location, close the panel so it never points at
  // an unmounted Source button.
  useEffect(() => {
    if (!sourceFocus) return;
    const stillLocated = query.data?.jobs.some((job) =>
      job.jobExecutions.some((execution) =>
        execution.steps.some((step) => step.id === sourceFocus.stepId && step.sourceLocation),
      ),
    );
    if (!stillLocated) {
      setSourceFocus(null);
      setSourcePanelOpen(false);
    }
  }, [sourceFocus, query.data]);

  const runData = query.data;
  const resolvedSelection =
    selectionControlled && runData
      ? resolveWorkflowRunSelection({
          run: runData,
          selection: selection as WorkflowRunSelectionInput,
        })
      : undefined;
  const hasExplicitJobSelection = Boolean(selection?.jobId || selection?.stepId);
  const selectedJob = selectionControlled
    ? hasExplicitJobSelection
      ? resolvedSelection?.job
      : undefined
    : (runData?.jobs.find((job) => job.id === selectedJobId) ?? runData?.jobs.at(0));
  const selectedJobExecution = selectionControlled
    ? resolvedSelection?.jobExecution
    : selectedJob
      ? resolveJobExecution(selectedJob, selectedJobExecutionId)
      : undefined;
  const selectedAttemptId = selectionControlled
    ? (resolvedSelection?.selectedAttemptId ?? null)
    : undefined;
  // Explicit per-step focus wins; fall back to the URL-selected step so deep links still
  // pre-highlight source in the Source tab.
  const highlightedLineRange =
    sourceFocus?.location ?? resolvedSelection?.step?.sourceLocation ?? null;
  const sourceSnapshot = runData?.sourceSnapshot ?? null;

  function changeTab(nextTab: WorkflowRunTab) {
    if (!tabControlled) {
      setLocalTab(nextTab);
    } else if (activeTab !== nextTab) {
      onTabChange?.(nextTab);
    }

    if (nextTab !== 'jobs') {
      setSourcePanelOpen(false);
      setSourceFocus(null);
    }
  }

  function handleTabChange(nextTab: string) {
    if (!WORKFLOW_RUN_TABS.some((value) => value === nextTab)) return;
    changeTab(nextTab as WorkflowRunTab);
  }

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
        params: {
          workspaceSlug,
          projectSlug,
          workflowRunId: run.id,
        },
        search: ((previous: Record<string, unknown>) =>
          withoutWorkflowRunSelectionSearch(previous)) as never,
      });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Could not start re-run');
    }
  }

  function selectJob(jobId: string | undefined, source: JobGraphSelectionSource = 'pointer') {
    if (source === 'pointer') changeTab('jobs');
    if (!selectionControlled) {
      setSelectedJobId(jobId);
      setSelectedJobExecutionId(undefined);
      return;
    }
    // Keyboard roving focus is an interaction within the Summary graph. Keep that panel mounted
    // and let JobGraphView own the visual selection so focus is not moved to a different tab.
    if (source === 'keyboard') return;

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
    setSourcePanelOpen(false);
    // Defer so focus lands after the panel unmounts; clear the focus only after focusing so the
    // opener button is still expanded (force-visible) on return.
    window.setTimeout(() => {
      if (trigger?.isConnected) trigger.focus();
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

  const fatalError = query.isError && runData === undefined;
  const tabState = fatalError ? (
    query.error instanceof ApiError && query.error.status === 404 ? (
      <WorkflowRunNotFound />
    ) : (
      <QueryLoadError query={query} subject="workflow run" icon="pulseLine" />
    )
  ) : query.isPending || runData === undefined ? (
    <WorkflowRunContentSkeleton />
  ) : null;

  return (
    <>
      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="flex min-w-0 flex-1 flex-col gap-0"
      >
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
        <RunTabStrip
          jobCount={runData?.jobs.length}
          jobsFailed={runData?.jobs.filter((job) => job.status === 'failed').length}
          annotationSummary={annotationSummary}
          workspaceSlug={workspaceSlug}
          projectSlug={projectSlug}
          workflowRunId={runData?.id}
          search={selection}
        />
        <TabsContents className="min-h-0 flex-1 overflow-auto bg-background-neutral-base p-16">
          <TabsContent
            value="summary"
            tabIndex={-1}
            className="mx-auto flex w-full max-w-[1120px] flex-col gap-16 outline-none"
          >
            {runData ? (
              <JobGraph
                run={runData}
                selectedJobId={selectedJob?.id}
                onSelectedJobChange={selectJob}
              />
            ) : (
              tabState
            )}
          </TabsContent>
          <TabsContent
            value="jobs"
            tabIndex={-1}
            className="mx-auto w-full max-w-[1120px] outline-none"
          >
            {runData ? (
              <RunJobsList
                jobs={runData.jobs}
                selectedJobId={selectedJob?.id}
                onSelectedJobChange={selectJob}
                workspaceSlug={workspaceSlug}
                selectedJobExecution={selectedJobExecution}
                selectedAttemptId={selectedAttemptId}
                onSelectedJobExecutionChange={selectJobExecution}
                onSelectedAttemptChange={selectionControlled ? selectAttempt : undefined}
                sourcePanelId={sourcePanelId}
                sourceAvailable={sourceAvailable}
                focusedSourceStepId={sourceFocus?.stepId ?? null}
                onOpenStepSource={openStepSource}
              />
            ) : (
              tabState
            )}
          </TabsContent>
          <TabsContent
            value="annotations"
            tabIndex={-1}
            className="mx-auto w-full max-w-[1120px] outline-none"
          >
            {runData ? <RunAnnotationsEmpty /> : tabState}
          </TabsContent>
          <TabsContent
            value="source"
            keepMounted={sourceSnapshot !== null}
            tabIndex={-1}
            className="mx-auto flex min-h-full w-full max-w-[1120px] outline-none"
          >
            {runData ? (
              sourceSnapshot ? (
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
                    runData.isTemporary
                      ? 'Temporary runs do not capture workflow source.'
                      : 'This run was created before workflow source snapshots were captured.'
                  }
                />
              )
            ) : (
              tabState
            )}
          </TabsContent>
        </TabsContents>
      </Tabs>
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
