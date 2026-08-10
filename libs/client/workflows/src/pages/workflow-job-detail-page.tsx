import {useNavigate} from '@tanstack/react-router';
import {useCallback, useMemo} from 'react';
import {JobDetailView} from '#components/job-detail/job-detail-view.js';
import {WorkflowRunView} from '#components/workflow-run-view/index.js';
import {isWorkflowRunTerminal} from '#core/workflow-run.js';
import {useWorkflowRunAttemptQuery, useWorkflowRunAttemptsQuery} from '#hooks/api/workflow-runs.js';
import {type WorkflowJobSearch, workflowJobSearchParams} from '#routes/inputs.js';

export interface WorkflowJobDetailPageProps {
  projectId: string;
  workspaceSlug: string;
  projectSlug: string;
  workflowRunId: string;
  jobId: string;
  search?: WorkflowJobSearch;
}

export function WorkflowJobDetailPage({
  projectId,
  workspaceSlug,
  projectSlug,
  workflowRunId,
  jobId,
  search = {},
}: WorkflowJobDetailPageProps) {
  const navigate = useNavigate();
  const runQuery = useWorkflowRunAttemptQuery({
    workflowRunId,
    runAttempt: search.runAttempt,
  });
  const attemptsQuery = useWorkflowRunAttemptsQuery({
    workflowRunId,
    enabled: Boolean(runQuery.data && isWorkflowRunTerminal(runQuery.data.runAttempt.status)),
  });
  const newerAttempt = useMemo(() => {
    const currentAttempt = runQuery.data?.runAttempt.attempt ?? search.runAttempt ?? 1;
    return attemptsQuery.data
      ?.filter((attempt) => attempt.attempt > currentAttempt)
      .sort((left, right) => right.attempt - left.attempt)[0]?.attempt;
  }, [attemptsQuery.data, runQuery.data?.runAttempt.attempt, search.runAttempt]);
  const newerRunQuery = useWorkflowRunAttemptQuery({
    workflowRunId,
    runAttempt: newerAttempt,
    enabled: newerAttempt !== undefined,
  });

  const currentJobKey = runQuery.data?.jobs.find((job) => job.id === jobId)?.key;
  const newerJob = currentJobKey
    ? newerRunQuery.data?.jobs.find((job) => job.key === currentJobKey)
    : undefined;

  const onSelectionChange = useCallback(
    (nextSelection: WorkflowJobSearch) => {
      navigate({search: workflowJobSearchParams(nextSelection) as never});
    },
    [navigate],
  );
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <WorkflowRunView
        projectId={projectId}
        workspaceSlug={workspaceSlug}
        projectSlug={projectSlug}
        workflowRunId={workflowRunId}
        runAttempt={search.runAttempt}
        activeJobId={jobId}
        jobSearch={search}
        jobContent={
          <JobDetailView
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
            workflowRunId={workflowRunId}
            jobId={jobId}
            search={search}
            query={runQuery}
            newerAttempt={newerAttempt}
            newerJob={newerJob}
            onSelectionChange={onSelectionChange}
          />
        }
      />
    </div>
  );
}
