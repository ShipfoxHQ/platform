import {
  type JobStatusDto,
  jobStatusSchema,
  type WorkflowRunStatusDto,
  workflowRunStatusSchema,
} from '@shipfox/api-workflows-dto';
import {getWorkflowStatusVisual} from './status-visuals.js';

const EXPECTED_RUN_LABELS: Record<WorkflowRunStatusDto, string> = {
  pending: 'Pending',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const EXPECTED_JOB_LABELS: Record<JobStatusDto, string> = {
  ...EXPECTED_RUN_LABELS,
  skipped: 'Skipped',
};

describe('getWorkflowStatusVisual', () => {
  test.each(
    workflowRunStatusSchema.options,
  )('maps the run %s status to its own label', (status) => {
    expect(getWorkflowStatusVisual(status).label).toBe(EXPECTED_RUN_LABELS[status]);
  });

  test.each(jobStatusSchema.options)('maps the job %s status to its own label', (status) => {
    expect(getWorkflowStatusVisual(status).label).toBe(EXPECTED_JOB_LABELS[status]);
  });

  test('returns the shared running visual', () => {
    const visual = getWorkflowStatusVisual('running');

    expect(visual).toEqual({kind: 'running', label: 'Running', dot: 'info', badge: 'info'});
  });

  test('returns the active listener visual', () => {
    expect(getWorkflowStatusVisual('listening')).toEqual({
      kind: 'listening',
      label: 'Listening',
      dot: 'info',
      badge: 'info',
    });
  });
});
