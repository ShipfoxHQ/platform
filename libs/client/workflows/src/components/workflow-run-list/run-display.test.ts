import {workflowRunListItem} from '#test/fixtures/workflow-run.js';
import {runMatchesSearch, runMatchesStatusFilter} from './run-display.js';

describe('runMatchesSearch', () => {
  test('matches every run on a blank query', () => {
    const matches = runMatchesSearch(workflowRunListItem(), '   ');

    expect(matches).toBe(true);
  });

  test('matches case-insensitively across id, name, status, and trigger', () => {
    const run = workflowRunListItem({
      id: 'ABCD1234-X',
      name: 'Deploy Production',
      status: 'running',
      trigger_provider: 'github',
      trigger_source: 'github_acme',
      trigger_event: 'push',
    });

    expect(runMatchesSearch(run, 'abcd1234-x')).toBe(true);
    expect(runMatchesSearch(run, 'deploy production')).toBe(true);
    expect(runMatchesSearch(run, 'RUNNING')).toBe(true);
    expect(runMatchesSearch(run, 'github_acme · push')).toBe(true);
  });

  test('returns false when nothing in the run contains the query', () => {
    const matches = runMatchesSearch(workflowRunListItem(), 'no-such-run');

    expect(matches).toBe(false);
  });
});

describe('runMatchesStatusFilter', () => {
  test('matches every status when the filter is "all"', () => {
    expect(runMatchesStatusFilter('succeeded', 'all')).toBe(true);
    expect(runMatchesStatusFilter('cancelled', 'all')).toBe(true);
  });

  test('"failed" matches only failed runs', () => {
    expect(runMatchesStatusFilter('failed', 'failed')).toBe(true);
    expect(runMatchesStatusFilter('running', 'failed')).toBe(false);
    expect(runMatchesStatusFilter('succeeded', 'failed')).toBe(false);
  });

  test('"running" reads as in-progress and also covers pending runs', () => {
    expect(runMatchesStatusFilter('running', 'running')).toBe(true);
    expect(runMatchesStatusFilter('pending', 'running')).toBe(true);
    expect(runMatchesStatusFilter('succeeded', 'running')).toBe(false);
    expect(runMatchesStatusFilter('failed', 'running')).toBe(false);
    expect(runMatchesStatusFilter('cancelled', 'running')).toBe(false);
  });
});
