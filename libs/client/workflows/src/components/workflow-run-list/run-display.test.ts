import {workflowRunListItem} from '#test/fixtures/workflow-run.js';
import {
  runCalendarDate,
  runMatchesFilters,
  runMatchesSearch,
  runMatchesStatusFilter,
  workflowRunFacets,
} from './run-display.js';

describe('runMatchesSearch', () => {
  test('matches every run on a blank query', () => {
    expect(runMatchesSearch(workflowRunListItem(), '   ')).toBe(true);
  });

  test('matches the run name case-insensitively', () => {
    expect(runMatchesSearch(workflowRunListItem({name: 'Deploy Web'}), 'deploy')).toBe(true);
  });

  test('matches the run number, which the search box promises', () => {
    expect(runMatchesSearch(workflowRunListItem({number: 5184}), '5184')).toBe(true);
  });

  test('matches the run id, so a pasted identifier finds its row', () => {
    expect(runMatchesSearch(workflowRunListItem({id: 'ABCD1234-X'}), 'abcd1234-x')).toBe(true);
  });

  test('matches the workflow name even when the run has a different display name', () => {
    const run = workflowRunListItem({name: 'Deploy to production', workflow_name: 'CI'});

    expect(runMatchesSearch(run, 'CI')).toBe(true);
  });

  test('matches the trigger label', () => {
    const run = workflowRunListItem({trigger_source: 'github_acme', trigger_event: 'push'});

    expect(runMatchesSearch(run, 'github_acme · push')).toBe(true);
  });

  test('matches the branch, so a ref is findable without opening its filter', () => {
    const run = workflowRunListItem({
      trigger_reference: {
        repository: 'acme/api',
        ref: 'refs/heads/release/v2',
        commit: 'abcdef1234567890',
        actor: null,
      },
    });

    expect(runMatchesSearch(run, 'release/v2')).toBe(true);
  });

  test('matches the short commit, which is the form the row shows', () => {
    const run = workflowRunListItem({
      trigger_reference: {
        repository: 'acme/api',
        ref: 'refs/heads/main',
        commit: 'abcdef1234567890',
        actor: null,
      },
    });

    expect(runMatchesSearch(run, 'abcdef1')).toBe(true);
  });

  test('reports no match for an unrelated query', () => {
    expect(runMatchesSearch(workflowRunListItem(), 'no-such-run')).toBe(false);
  });
});

describe('runMatchesStatusFilter', () => {
  test('accepts every status when nothing is selected', () => {
    expect(runMatchesStatusFilter('succeeded', undefined)).toBe(true);
    expect(runMatchesStatusFilter('succeeded', [])).toBe(true);
  });

  test('accepts a run matching any one of several selected statuses', () => {
    expect(runMatchesStatusFilter('failed', ['succeeded', 'failed'])).toBe(true);
    expect(runMatchesStatusFilter('cancelled', ['succeeded', 'failed'])).toBe(false);
  });

  test('treats running as in-progress so a freshly queued run is not hidden', () => {
    expect(runMatchesStatusFilter('pending', ['running'])).toBe(true);
    expect(runMatchesStatusFilter('running', ['running'])).toBe(true);
    expect(runMatchesStatusFilter('succeeded', ['running'])).toBe(false);
  });
});

describe('runMatchesFilters', () => {
  const run = workflowRunListItem({
    name: 'deploy-web',
    status: 'failed',
    trigger_event: 'push',
    created_at: '2026-05-07T12:00:00.000Z',
    trigger_reference: {
      repository: 'acme/api',
      ref: 'refs/heads/main',
      commit: 'abcdef1234567890',
      actor: 'octocat',
    },
  });

  test('accepts a run matching every active dimension at once', () => {
    expect(
      runMatchesFilters(run, {
        search: 'deploy',
        status: ['failed'],
        branch: ['main'],
        actor: ['octocat'],
        event: ['push'],
      }),
    ).toBe(true);
  });

  test.each([
    ['status', {status: ['succeeded' as const]}],
    ['branch', {branch: ['release']}],
    ['actor', {actor: ['someone-else']}],
    ['event', {event: ['pull_request']}],
    ['search', {search: 'unrelated'}],
  ])('rejects a run failing the %s dimension alone', (_dimension, criteria) => {
    expect(runMatchesFilters(run, criteria)).toBe(false);
  });

  test('rejects a run that has no value at all for an active dimension', () => {
    const withoutReference = workflowRunListItem({trigger_reference: null});

    expect(runMatchesFilters(withoutReference, {branch: ['main']})).toBe(false);
    expect(runMatchesFilters(withoutReference, {actor: ['octocat']})).toBe(false);
  });

  test('accepts a dev run under the dev origin and rejects it under synced', () => {
    const devRun = workflowRunListItem({
      origin: 'dev',
      dev_source: {
        ref: 'fix-triage-prompt',
        commit: 'abcdef1234567890abcdef1234567890abcdef12',
        config_path: '.shipfox/workflows/triage-sentry.yml',
        initiated_by_user_id: '99999999-9999-4999-8999-999999999999',
        replay_of_event_id: null,
      },
    });

    expect(runMatchesFilters(devRun, {origin: 'dev'})).toBe(true);
    expect(runMatchesFilters(devRun, {origin: 'synced'})).toBe(false);
    expect(runMatchesFilters(run, {origin: 'synced'})).toBe(true);
    expect(runMatchesFilters(run, {origin: 'dev'})).toBe(false);
  });

  test('finds the dev branch and commit through the search box', () => {
    const devRun = workflowRunListItem({
      origin: 'dev',
      dev_source: {
        ref: 'fix-triage-prompt',
        commit: 'abcdef1234567890abcdef1234567890abcdef12',
        config_path: '.shipfox/workflows/triage-sentry.yml',
        initiated_by_user_id: '99999999-9999-4999-8999-999999999999',
        replay_of_event_id: null,
      },
    });

    expect(runMatchesSearch(devRun, 'fix-triage')).toBe(true);
    expect(runMatchesSearch(devRun, 'abcdef1')).toBe(true);
  });

  test('treats both date bounds as inclusive', () => {
    const date = runCalendarDate(run) as string;

    expect(runMatchesFilters(run, {after: date, before: date})).toBe(true);
  });

  test('excludes a run outside either bound', () => {
    const date = runCalendarDate(run) as string;

    expect(runMatchesFilters(run, {after: shiftDay(date, 1)})).toBe(false);
    expect(runMatchesFilters(run, {before: shiftDay(date, -1)})).toBe(false);
  });
});

describe('workflowRunFacets', () => {
  test('collects sorted, deduplicated options from the loaded runs', () => {
    const runs = [
      workflowRunListItem({
        id: '11111111-1111-4111-8111-000000000001',
        trigger_event: 'push',
        trigger_reference: {
          repository: 'acme/api',
          ref: 'refs/heads/main',
          commit: 'aaaaaaa',
          actor: 'octocat',
        },
      }),
      workflowRunListItem({
        id: '11111111-1111-4111-8111-000000000002',
        trigger_event: 'pull_request',
        trigger_reference: {
          repository: 'acme/api',
          ref: 'refs/heads/main',
          commit: 'bbbbbbb',
          actor: 'hubot',
        },
      }),
    ];

    expect(workflowRunFacets(runs)).toEqual({
      branch: ['main'],
      actor: ['hubot', 'octocat'],
      event: ['pull_request', 'push'],
    });
  });

  test('keeps a selected value no loaded run carries, so a shared link keeps its chip', () => {
    const facets = workflowRunFacets([workflowRunListItem({trigger_reference: null})], {
      branch: ['release/v2'],
    });

    expect(facets.branch).toEqual(['release/v2']);
  });
});

function shiftDay(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const shifted = new Date(year, month - 1, day + days);
  const shiftedMonth = String(shifted.getMonth() + 1).padStart(2, '0');
  const shiftedDay = String(shifted.getDate()).padStart(2, '0');
  return `${shifted.getFullYear()}-${shiftedMonth}-${shiftedDay}`;
}
