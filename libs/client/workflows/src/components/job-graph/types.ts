import type {WorkflowRunDetail} from '#core/workflow-run.js';

export type JobGraphSelectionSource = 'pointer' | 'keyboard';

export interface JobGraphProps {
  run: WorkflowRunDetail;
  selectedJobId?: string | undefined;
  defaultSelectedJobId?: string | undefined;
  onSelectedJobChange?:
    | ((jobId: string | undefined, source?: JobGraphSelectionSource) => void)
    | undefined;
  className?: string | undefined;
}
