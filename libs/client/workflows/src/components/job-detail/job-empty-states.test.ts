import {
  workflowJob,
  workflowJobExecutionDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {jobSucceededSummary, skippedJobDescription} from './job-empty-states.js';

describe('jobSucceededSummary', () => {
  test('counts only succeeded steps when skipped steps are present', () => {
    const job = workflowJob({
      status: 'succeeded',
      job_executions: [
        workflowJobExecutionDto({
          status: 'succeeded',
          steps: [
            workflowStepDto({status: 'succeeded'}),
            workflowStepDto({status: 'skipped', position: 1}),
          ],
        }),
      ],
    });
    const execution = job.jobExecutions[0];
    if (!execution) throw new Error('Expected a job execution');

    expect(jobSucceededSummary(job, execution)).toBe('1 step succeeded');
  });
});

describe('skippedJobDescription', () => {
  test('explains when materialized output exceeds the configured size limit', () => {
    expect(skippedJobDescription('output_too_large')).toBe(
      'The materialized job output exceeded its configured size limit.',
    );
  });
});
