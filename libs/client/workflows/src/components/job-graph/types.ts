import type {WorkflowRun, WorkflowRunDetail, WorkflowRunOverview} from '#core/workflow-run.js';

export type JobGraphRun = WorkflowRunDetail | WorkflowRunOverview;
export type JobGraphTrigger = Pick<
  WorkflowRun,
  'triggerDisplayLabel' | 'triggerLabel' | 'triggerProvider' | 'triggerSource'
>;

export type JobGraphSelectionSource = 'pointer' | 'keyboard';

export interface JobGraphProps {
  run: JobGraphRun;
  selectedJobId?: string | undefined;
  defaultSelectedJobId?: string | undefined;
  onSelectedJobChange?:
    | ((jobId: string | undefined, source?: JobGraphSelectionSource) => void)
    | undefined;
  className?: string | undefined;
}
