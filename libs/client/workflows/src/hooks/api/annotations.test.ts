import {
  workflowRunAnnotationSummaryQueryOptions,
  workflowRunAnnotationsQueryOptions,
} from './annotations.js';

const WORKFLOW_RUN_ID = '11111111-1111-4111-8111-111111111111';

describe('annotation query polling', () => {
  it('stops summary polling when the owning run is terminal', () => {
    const options = workflowRunAnnotationSummaryQueryOptions(WORKFLOW_RUN_ID, 1, undefined, {
      polling: false,
    });

    expect(options.refetchInterval).toBe(false);
  });

  it('stops annotation list polling when the owning run is terminal', () => {
    const options = workflowRunAnnotationsQueryOptions(WORKFLOW_RUN_ID, 1, undefined, {
      polling: false,
    });

    expect(options.refetchInterval).toBe(false);
  });

  it('keeps execution-scoped summaries on a distinct reusable query key', () => {
    const runSummary = workflowRunAnnotationSummaryQueryOptions(WORKFLOW_RUN_ID, 1);
    const executionSummary = workflowRunAnnotationSummaryQueryOptions(
      WORKFLOW_RUN_ID,
      1,
      '22222222-2222-4222-8222-222222222222',
    );

    expect(runSummary.queryKey).not.toEqual(executionSummary.queryKey);
  });
});
