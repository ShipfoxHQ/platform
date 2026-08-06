import {
  workflowRunAnnotationSummaryQueryOptions,
  workflowRunAnnotationsQueryOptions,
} from './annotations.js';

const WORKFLOW_RUN_ID = '11111111-1111-4111-8111-111111111111';

describe('annotation query polling', () => {
  it('polls enabled list and summary queries by default', () => {
    const summary = workflowRunAnnotationSummaryQueryOptions(WORKFLOW_RUN_ID, 1);
    const list = workflowRunAnnotationsQueryOptions(WORKFLOW_RUN_ID, 1);

    expect(summary.refetchInterval).toBe(5_000);
    expect(refetchIntervalForPages(list, 1)).toBe(5_000);
  });

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

  it('stops annotation list polling after the first page has been loaded', () => {
    const options = workflowRunAnnotationsQueryOptions(WORKFLOW_RUN_ID, 1);

    expect(refetchIntervalForPages(options, 2)).toBe(false);
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

function refetchIntervalForPages(
  options: ReturnType<typeof workflowRunAnnotationsQueryOptions>,
  pageCount: number,
) {
  if (typeof options.refetchInterval !== 'function') return options.refetchInterval;

  return options.refetchInterval({
    state: {data: {pages: Array.from({length: pageCount}, () => ({}))}},
  } as never);
}
