import {executeChild, proxyActivities} from '@temporalio/workflow';

import type {CompletionStatus} from '#core/dag.js';
import {findBlockedNodes, findReadyNodes} from '#core/dag.js';

import type {createOrchestrationActivities} from '../activities/index.js';
import type {DagJob} from '../activities/orchestration-activities.js';
import {jobOrchestration} from './job-orchestration.js';

const {loadRunDag, setRunStatus, setJobStatus} = proxyActivities<
  ReturnType<typeof createOrchestrationActivities>
>({
  startToCloseTimeout: '30s',
});

export interface RunOrchestrationInput {
  runId: string;
  workspaceId: string;
}

export async function runOrchestration(input: RunOrchestrationInput): Promise<void> {
  const dag = await loadRunDag(input.runId);

  let runVersion = dag.runVersion;
  const {newVersion} = await setRunStatus({
    runId: input.runId,
    status: 'running',
    version: runVersion,
  });
  runVersion = newVersion;

  const completed = new Map<string, CompletionStatus>();
  const jobVersions = new Map<string, number>();
  for (const job of dag.jobs) {
    jobVersions.set(job.id, job.version);
  }

  let runFailed = false;

  while (completed.size < dag.jobs.length) {
    runFailed = (await cancelBlockedJobs(dag.jobs, completed, jobVersions)) || runFailed;

    const ready = findReadyNodes(dag.jobs, completed);

    if (ready.length === 0) {
      await cancelRemainingJobs(dag.jobs, completed, jobVersions);
      runFailed = true;
      break;
    }

    const results = await launchJobs(ready, input, jobVersions);

    for (const [job, result] of ready.map((j, i) => [j, results[i]] as const)) {
      if (!result) continue;
      completed.set(job.name, result.status);
      jobVersions.set(job.id, result.jobVersion);
      if (result.status === 'failed') runFailed = true;
    }
  }

  await setRunStatus({
    runId: input.runId,
    status: runFailed ? 'failed' : 'succeeded',
    version: runVersion,
  });
}

async function cancelBlockedJobs(
  jobs: DagJob[],
  completed: Map<string, CompletionStatus>,
  jobVersions: Map<string, number>,
): Promise<boolean> {
  const blocked = findBlockedNodes(jobs, completed);
  for (const job of blocked) {
    const version = jobVersions.get(job.id) ?? job.version;
    const {newVersion: v} = await setJobStatus({jobId: job.id, status: 'cancelled', version});
    jobVersions.set(job.id, v);
    completed.set(job.name, 'failed');
  }
  return blocked.length > 0;
}

async function cancelRemainingJobs(
  jobs: DagJob[],
  completed: Map<string, CompletionStatus>,
  jobVersions: Map<string, number>,
): Promise<void> {
  for (const job of jobs) {
    if (!completed.has(job.name)) {
      const version = jobVersions.get(job.id) ?? job.version;
      await setJobStatus({jobId: job.id, status: 'cancelled', version});
      completed.set(job.name, 'failed');
    }
  }
}

interface LaunchResult {
  status: CompletionStatus;
  jobVersion: number;
}

function launchJobs(
  jobs: DagJob[],
  input: RunOrchestrationInput,
  jobVersions: Map<string, number>,
): Promise<LaunchResult[]> {
  return Promise.all(
    jobs.map(async (job) => {
      const result = await executeChild(jobOrchestration, {
        workflowId: `job:${job.id}`,
        args: [
          {
            workspaceId: input.workspaceId,
            jobId: job.id,
            runId: input.runId,
            jobName: job.name,
            jobVersion: jobVersions.get(job.id) ?? job.version,
            steps: job.steps,
          },
        ],
      });
      return {status: result.status, jobVersion: result.jobVersion};
    }),
  );
}
