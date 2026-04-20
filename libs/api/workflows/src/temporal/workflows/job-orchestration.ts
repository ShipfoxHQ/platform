import {condition, defineSignal, proxyActivities, setHandler} from '@temporalio/workflow';

import type {CompletionStatus} from '#core/dag.js';

import type {createOrchestrationActivities} from '../activities/index.js';

const {setJobStatus, enqueueJobForRunner, bulkSetStepStatuses} = proxyActivities<
  ReturnType<typeof createOrchestrationActivities>
>({
  startToCloseTimeout: '30s',
});

export const jobCompletedSignal =
  defineSignal<[{status: CompletionStatus; output?: unknown}]>('job-completed');

export interface JobOrchestrationInput {
  workspaceId: string;
  jobId: string;
  runId: string;
  jobName: string;
  jobVersion: number;
  steps: Array<{
    id: string;
    name: string | null;
    type: string;
    config: Record<string, unknown>;
    position: number;
  }>;
}

export interface JobOrchestrationResult {
  status: CompletionStatus;
  jobVersion: number;
  output?: unknown;
}

export async function jobOrchestration(
  input: JobOrchestrationInput,
): Promise<JobOrchestrationResult> {
  const {newVersion: runningVersion} = await setJobStatus({
    jobId: input.jobId,
    status: 'running',
    version: input.jobVersion,
  });

  await enqueueJobForRunner({
    workspaceId: input.workspaceId,
    jobId: input.jobId,
    runId: input.runId,
    jobName: input.jobName,
    steps: input.steps,
  });

  let signalPayload: {status: CompletionStatus; output?: unknown} | undefined;

  setHandler(jobCompletedSignal, (r) => {
    if (!signalPayload) {
      signalPayload = r;
    }
  });

  await condition(() => signalPayload !== undefined);

  if (!signalPayload) throw new Error('Unreachable: condition() guarantees signalPayload is set');
  const {status, output} = signalPayload;

  const {newVersion: finalVersion} = await setJobStatus({
    jobId: input.jobId,
    status,
    version: runningVersion,
  });

  await bulkSetStepStatuses({
    jobId: input.jobId,
    status,
  });

  return {status, jobVersion: finalVersion, output};
}
