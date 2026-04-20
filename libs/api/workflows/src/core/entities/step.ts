export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface Step {
  id: string;
  jobId: string;
  name: string | null;
  status: StepStatus;
  type: string;
  config: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  position: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
