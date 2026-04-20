export const RUNNER_JOB_COMPLETED = 'runners.job.completed' as const;

export interface RunnerJobCompletedEvent {
  jobId: string;
  runId: string;
  status: 'succeeded' | 'failed';
  output?: unknown;
}

export interface RunnersEventMap {
  [RUNNER_JOB_COMPLETED]: RunnerJobCompletedEvent;
}
