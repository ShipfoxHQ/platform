export type JobStatus =
  | 'pending'
  | 'waiting_for_dependencies'
  | 'ready'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'awaiting_manual';

export interface Job {
  id: string;
  runId: string;
  name: string;
  status: JobStatus;
  dependencies: string[];
  runner: string[] | null;
  position: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
