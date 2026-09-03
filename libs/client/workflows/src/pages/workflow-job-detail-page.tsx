import {useNavigate} from '@tanstack/react-router';
import {useCallback, useMemo} from 'react';
import {JobDetailView} from '#components/job-detail/job-detail-view.js';
import {WorkflowRunView} from '#components/workflow-run-view/index.js';
import type {Job} from '#core/workflow-run.js';
import {
  useWorkflowJobDetailQuery,
  useWorkflowJobResourceInvalidation,
} from '#hooks/api/workflow-job-detail.js';
import {
  useWorkflowRunLineageHeadQuery,
  useWorkflowRunOverviewQuery,
} from '#hooks/api/workflow-run-overview.js';
import {useWorkflowRunListItem} from '#hooks/api/workflow-runs.js';
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
  const jobQuery = useWorkflowJobDetailQuery({
    jobId,
    executionId: search.jobExecutionId,
  });
  useWorkflowJobResourceInvalidation({
    detail: jobQuery.data,
    pinnedExecutionId: search.jobExecutionId,
  });
  const listRun = useWorkflowRunListItem(workflowRunId);
  const headQuery = useWorkflowRunLineageHeadQuery({workflowRunId});
  const currentAttempt = search.runAttempt ?? jobQuery.data?.workflowRunAttempt;
  const newerAttempt = useMemo(() => {
    if (currentAttempt === undefined) return undefined;
    const latestAttempt = headQuery.data?.latestAttempt ?? listRun?.latestAttempt;
    return latestAttempt !== undefined && latestAttempt > currentAttempt
      ? latestAttempt
      : undefined;
  }, [currentAttempt, headQuery.data?.latestAttempt, listRun?.latestAttempt]);
  const newerOverviewQuery = useWorkflowRunOverviewQuery({
    workflowRunId,
    runAttempt: newerAttempt,
    enabled: newerAttempt !== undefined,
  });
  const currentJobKey = jobQuery.data?.job.key;
  const newerJob = useMemo<Pick<Job, 'id'> | undefined>(() => {
    if (!currentJobKey || newerAttempt === undefined) return undefined;
    const overviewJobs = newerOverviewQuery.data?.jobs;
    if (overviewJobs) {
      const jobs =
        overviewJobs.kind === 'complete' ? overviewJobs.items : overviewJobs.firstPage.items;
      const job = jobs.find((candidate) => candidate.key === currentJobKey);
      if (job) return {id: job.id};
    }

    // A cached run-list row is only a safe fallback when it belongs to the attempt we are
    // retargeting. Older list rows can otherwise point at the same logical job in this attempt.
    if (listRun?.latestAttempt !== newerAttempt) return undefined;
    const cachedJob = listRun.jobs.preview.find((candidate) => candidate.key === currentJobKey);
    return cachedJob ? {id: cachedJob.id} : undefined;
  }, [currentJobKey, listRun, newerAttempt, newerOverviewQuery.data]);

  const onSelectionChange = useCallback(
    (nextSelection: WorkflowJobSearch) => {
      navigate({search: workflowJobSearchParams(nextSelection) as never});
    },
    [navigate],
  );
  return (
    <div
      data-workflow-page-root="job-detail"
      className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
    >
      <WorkflowRunView
        projectId={projectId}
        workspaceSlug={workspaceSlug}
        projectSlug={projectSlug}
        workflowRunId={workflowRunId}
        runAttempt={search.runAttempt}
        activeJobId={jobId}
        activeJob={jobQuery.data?.job}
        jobSearch={search}
        jobContent={
          <JobDetailView
            key={jobId}
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
            workflowRunId={workflowRunId}
            jobId={jobId}
            search={search}
            query={jobQuery}
            selectedJobQuery
            newerAttempt={newerAttempt}
            newerJob={newerJob}
            onSelectionChange={onSelectionChange}
          />
        }
      />
    </div>
  );
}
