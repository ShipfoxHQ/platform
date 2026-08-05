import {parseAppSearch, stringifyAppSearch} from '@shipfox/client-shell/runtime';
import {
  applyWorkflowRunFilterPatch,
  clearWorkflowRunFilters,
  hasWorkflowRunFilters,
  validateWorkflowJobSearch,
  validateWorkflowRunsSearch,
  type WorkflowJobSearch,
  type WorkflowRunsSearch,
  workflowJobRouteParams,
  workflowJobSearchParams,
  workflowRouteParams,
  workflowRunListSearchParams,
  workflowRunSearchParams,
  workflowRunTab,
} from './inputs.js';

/** Everything a filter change writes, then reads back, exactly as the router would. */
function roundTrip(search: WorkflowRunsSearch): WorkflowRunsSearch {
  const query = stringifyAppSearch(workflowRunSearchParams(search, {}));
  return validateWorkflowRunsSearch(parseAppSearch(query));
}

describe('validateWorkflowRunsSearch', () => {
  test('drops malformed values instead of rejecting the URL', () => {
    expect(
      validateWorkflowRunsSearch({
        search: ['unexpected'],
        status: 'unknown',
        tab: 'unknown',
        severity: 'critical',
        after: 'yesterday',
        before: '2026-13-01',
      }),
    ).toEqual({});
  });

  test('ignores parameters it does not recognize', () => {
    expect(validateWorkflowRunsSearch({search: 'deploy', page: '3', sort: 'name'})).toEqual({
      search: 'deploy',
    });
  });

  test('reads a single repeated key as a one-element list', () => {
    expect(validateWorkflowRunsSearch({status: 'failed'})).toEqual({status: ['failed']});
  });

  test('keeps only the statuses it knows out of a mixed list', () => {
    expect(validateWorkflowRunsSearch({status: ['failed', 'nonsense', 'running']})).toEqual({
      status: ['failed', 'running'],
    });
  });

  test('coerces a numeric-looking branch back to a string', () => {
    expect(validateWorkflowRunsSearch({branch: 2024})).toEqual({branch: ['2024']});
  });

  test('deduplicates a repeated value', () => {
    expect(validateWorkflowRunsSearch({branch: ['main', 'main', 'next']})).toEqual({
      branch: ['main', 'next'],
    });
  });

  test('rejects a well-shaped but impossible date', () => {
    expect(validateWorkflowRunsSearch({after: '2026-02-31'})).toEqual({});
    expect(validateWorkflowRunsSearch({after: '2026-02-28'})).toEqual({after: '2026-02-28'});
  });

  test('keeps legacy job selection on the run route', () => {
    expect(validateWorkflowRunsSearch({status: 'failed', runAttempt: '2', job: 'job-1'})).toEqual({
      status: ['failed'],
      jobId: 'job-1',
      runAttempt: 2,
    });
  });
});

describe('the job detail URL contract', () => {
  test('reads and writes job-scoped selection parameters', () => {
    const search: WorkflowJobSearch = {
      jobExecutionId: 'execution-1',
      stepId: 'step-1',
      stepAttemptId: 'attempt-2',
      runAttempt: 3,
    };
    const query = stringifyAppSearch(workflowJobSearchParams(search));

    expect(query).toBe(
      '?jobExecution=execution-1&step=step-1&stepAttempt=attempt-2&runAttempt=%223%22',
    );
    expect(validateWorkflowJobSearch(parseAppSearch(query))).toEqual(search);
  });

  test('drops malformed job selection values', () => {
    expect(
      validateWorkflowJobSearch({
        tab: 'annotations',
        jobExecution: ['unexpected'],
        step: '',
        stepAttempt: 4,
        runAttempt: '0',
      }),
    ).toEqual({});
  });

  test('requires all job route path parameters', () => {
    expect(
      workflowJobRouteParams({
        workspaceSlug: 'workspace-1',
        projectSlug: 'project-1',
        workflowRunId: 'run-1',
        jobId: 'job-1',
      }),
    ).toEqual({
      workspaceSlug: 'workspace-1',
      projectSlug: 'project-1',
      workflowRunId: 'run-1',
      jobId: 'job-1',
    });
    expect(() => workflowJobRouteParams({workspaceSlug: 'workspace-1'})).toThrow();
  });

  test('accepts known tabs and annotation severities while dropping unknown values', () => {
    expect(
      validateWorkflowRunsSearch({tab: 'annotations', annotation: 'run-1', severity: 'error'}),
    ).toEqual({tab: 'annotations', annotation: 'run-1', severity: 'error'});
    expect(validateWorkflowRunsSearch({tab: 'unknown', severity: 'critical'})).toEqual({});
    expect(workflowRunTab({})).toBe('summary');
    expect(workflowRunTab({tab: 'source'})).toBe('source');
  });

  test.each([
    ['job', {jobId: 'job-1'}],
    ['job execution', {jobExecutionId: 'execution-1'}],
    ['step', {stepId: 'step-1'}],
    ['step attempt', {stepAttemptId: 'attempt-1'}],
  ])('defaults a legacy %s selection URL to Summary', (_selection, search) => {
    expect(workflowRunTab(search)).toBe('summary');
  });

  test('keeps an explicit Summary tab ahead of legacy selection inference', () => {
    expect(workflowRunTab({tab: 'summary', jobId: 'job-1'})).toBe('summary');
  });
});

describe('the run list URL contract', () => {
  test.each([
    ['search', {search: 'deploy-web'}],
    ['status', {status: ['failed' as const, 'running' as const]}],
    ['branch', {branch: ['main', 'release/v2']}],
    ['actor', {actor: ['octocat', 'hubot']}],
    ['event', {event: ['push', 'pull_request']}],
    ['after and before', {after: '2026-05-01', before: '2026-05-31'}],
  ])('round-trips %s through the URL', (_param, search) => {
    expect(roundTrip(search)).toEqual(search);
  });

  test('round-trips every parameter at once', () => {
    const search: WorkflowRunsSearch = {
      search: 'deploy',
      status: ['failed', 'cancelled'],
      branch: ['main'],
      actor: ['octocat'],
      event: ['push'],
      after: '2026-05-01',
      before: '2026-05-31',
      tab: 'annotations',
      annotation: 'annotation-1',
      severity: 'warning',
    };

    expect(roundTrip(search)).toEqual(search);
  });

  test('repeats the key rather than comma-joining a multi-select', () => {
    const query = stringifyAppSearch(workflowRunSearchParams({status: ['failed', 'running']}, {}));

    expect(query).toBe('?status=failed&status=running');
  });

  test('survives a branch name containing a comma', () => {
    expect(roundTrip({branch: ['release,v2', 'main']})).toEqual({branch: ['release,v2', 'main']});
  });

  // A branch named for a year, a release train called `false`: names that happen to be valid
  // JSON have to come back as themselves, or the filter matches nothing and the shared link
  // is broken for good.
  test.each([
    ['a numeric branch beside a plain one', {branch: ['2024', 'main']}],
    ['two numeric branches', {branch: ['2024', '2025']}],
    ['a boolean-looking branch', {branch: ['false', 'main']}],
    ['numeric actors', {actor: ['123', '456']}],
  ])('survives %s', (_case, search) => {
    expect(roundTrip(search)).toEqual(search);
  });

  test('writes nothing for an unfiltered list', () => {
    expect(stringifyAppSearch(workflowRunSearchParams({}, {}))).toBe('');
  });

  test('omits the default Summary tab from the URL', () => {
    expect(stringifyAppSearch(workflowRunSearchParams({tab: 'summary'}, {}))).toBe('');
    expect(stringifyAppSearch(workflowRunSearchParams({tab: 'jobs'}, {}))).toBe('?tab=jobs');
  });

  test('serializes only list filters for the detail back link', () => {
    expect(
      workflowRunListSearchParams({
        search: 'deploy',
        status: ['running'],
        tab: 'jobs',
        annotation: 'annotation-1',
        severity: 'error',
        jobId: 'job-1',
      }),
    ).toEqual({search: 'deploy', status: ['running']});
  });

  test('has no page or cursor parameter to carry', () => {
    const query = stringifyAppSearch(workflowRunSearchParams({search: 'deploy'}, {}));

    expect(query).not.toContain('page');
    expect(query).not.toContain('cursor');
  });
});

describe('applyWorkflowRunFilterPatch', () => {
  test('replaces only the dimensions the patch names', () => {
    const next = applyWorkflowRunFilterPatch(
      {search: 'deploy', status: ['failed']},
      {
        branch: ['main'],
      },
    );

    expect(next).toEqual({search: 'deploy', status: ['failed'], branch: ['main']});
  });

  test('deletes a dimension set to undefined, an empty string, or an empty list', () => {
    const search: WorkflowRunsSearch = {search: 'deploy', status: ['failed'], after: '2026-05-01'};

    expect(applyWorkflowRunFilterPatch(search, {search: '', status: [], after: undefined})).toEqual(
      {},
    );
  });

  test('leaves the run selection parameters alone', () => {
    const next = applyWorkflowRunFilterPatch({runAttempt: 2}, {search: 'deploy'});

    expect(next).toEqual({runAttempt: 2, search: 'deploy'});
  });
});

describe('clearWorkflowRunFilters', () => {
  test('drops every filter and keeps the selection parameters', () => {
    const cleared = clearWorkflowRunFilters({
      search: 'deploy',
      status: ['failed'],
      branch: ['main'],
      actor: ['octocat'],
      event: ['push'],
      after: '2026-05-01',
      before: '2026-05-31',
      runAttempt: 2,
    });

    expect(cleared).toEqual({runAttempt: 2});
  });
});

describe('hasWorkflowRunFilters', () => {
  test.each([
    ['search', {search: 'deploy'}],
    ['status', {status: ['failed' as const]}],
    ['branch', {branch: ['main']}],
    ['actor', {actor: ['octocat']}],
    ['event', {event: ['push']}],
    ['after', {after: '2026-05-01'}],
    ['before', {before: '2026-05-31'}],
  ])('reports %s as an active filter', (_dimension, search) => {
    expect(hasWorkflowRunFilters(search)).toBe(true);
  });

  test('does not count a run selection parameter as a filter', () => {
    expect(hasWorkflowRunFilters({runAttempt: 2})).toBe(false);
  });
});

describe('workflowRouteParams', () => {
  test('requires workspace and project path parameters', () => {
    expect(workflowRouteParams({workspaceSlug: 'workspace-1', projectSlug: 'project-1'})).toEqual({
      workspaceSlug: 'workspace-1',
      projectSlug: 'project-1',
    });
    expect(() => workflowRouteParams({workspaceSlug: 'workspace-1'})).toThrow(
      'Workflow route is missing required path parameters.',
    );
    expect(() => workflowRouteParams({workspaceSlug: 'workspace-1', projectSlug: null})).toThrow();
  });
});
