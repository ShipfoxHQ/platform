import {
  toWorkflowRun,
  toWorkflowRunAttempt,
  toWorkflowRunListItem,
  toWorkflowRunListPage,
} from '#hooks/api/workflow-run-mapper.js';
import {
  workflowJob,
  workflowJobExecutionDto,
  workflowRunAttemptDto,
  workflowRunDto,
  workflowRunJobSummaryDto,
  workflowRunListItem,
  workflowRunListResponseDto,
} from '#test/fixtures/workflow-run.js';
import {
  isWorkflowRunTerminal,
  isWorkflowStatus,
  workflowRunBranchLabel,
  workflowRunCommitLabel,
  workflowRunDevSourceLabel,
  workflowRunInitiatorLabel,
  workflowRunTriggerDisplayLabel,
  workflowRunTriggerLabel,
} from './workflow-run.js';

describe('workflow run model mapping', () => {
  test('maps a run DTO into the central camelCase model without detail fields', () => {
    const dto = workflowRunDto({
      id: '66666666-6666-4666-8666-666666666666',
      project_id: '44444444-4444-4444-8444-444444444444',
      definition_id: '55555555-5555-4555-8555-555555555555',
      name: 'deploy-web',
      status: 'running',
      current_attempt: 3,
      latest_attempt: 4,
      trigger_provider: 'github',
      trigger_source: 'github_acme',
      trigger_event: 'push',
      created_at: '2026-05-07T01:01:00.000Z',
      updated_at: '2026-05-07T01:02:00.000Z',
    });

    const run = toWorkflowRun(dto);

    expect(run).toMatchObject({
      id: '66666666-6666-4666-8666-666666666666',
      projectId: '44444444-4444-4444-8444-444444444444',
      definitionId: '55555555-5555-4555-8555-555555555555',
      number: 1,
      name: 'deploy-web',
      workflowName: 'deploy-web',
      currentAttempt: 3,
      triggerProvider: 'github',
      triggerSource: 'github_acme',
      triggerEvent: 'push',
      triggerDisplayLabel: 'push',
      triggerLabel: 'github_acme · push',
      createdAt: '2026-05-07T01:01:00.000Z',
      updatedAt: '2026-05-07T01:02:00.000Z',
      isTemporary: false,
    });
    expect(run).not.toHaveProperty('status');
    expect(run).not.toHaveProperty('startedAt');
    expect(run).not.toHaveProperty('finishedAt');
    expect(run).not.toHaveProperty('triggerPayload');
    expect(run).not.toHaveProperty('inputs');
    expect(run).not.toHaveProperty('sourceSnapshot');
  });

  test('normalizes missing nullable fields and marks temporary optimistic runs', () => {
    const dto = workflowRunDto({
      id: 'temp-1234',
      trigger_source: '',
      trigger_event: '',
    });

    const run = toWorkflowRun(dto);

    expect(run).toMatchObject({
      triggerDisplayLabel: '',
      triggerLabel: '',
      isTemporary: true,
    });
  });

  test('maps a dev run DTO into origin and dev source provenance', () => {
    const dto = workflowRunDto({
      origin: 'dev',
      dev_source: {
        ref: 'fix-triage-prompt',
        commit: 'abcdef1234567890abcdef1234567890abcdef12',
        config_path: '.shipfox/workflows/triage-sentry.yml',
        initiated_by_user_id: '99999999-9999-4999-8999-999999999999',
        replay_of_event_id: null,
      },
    });

    const run = toWorkflowRun(dto);

    expect(run.origin).toBe('dev');
    expect(run.devSource).toEqual({
      ref: 'fix-triage-prompt',
      commit: 'abcdef1234567890abcdef1234567890abcdef12',
      configPath: '.shipfox/workflows/triage-sentry.yml',
      initiatedByUserId: '99999999-9999-4999-8999-999999999999',
      replayOfEventId: null,
    });
  });

  test('defaults origin and dev source on pre-rollout API responses', () => {
    const {origin: _origin, dev_source: _devSource, ...compatibilityDto} = workflowRunDto();

    const run = toWorkflowRun(compatibilityDto as unknown as Parameters<typeof toWorkflowRun>[0]);

    expect(run.origin).toBe('synced');
    expect(run.devSource).toBeNull();
  });

  test('maps run list projection fields from the current attempt mirror', () => {
    const dto = workflowRunDto({
      status: 'running',
      latest_attempt: 4,
      started_at: '2026-05-07T01:01:10.000Z',
      finished_at: null,
      has_started_job_execution: true,
    });

    const run = toWorkflowRunListItem(dto);

    expect(run).toMatchObject({
      status: 'running',
      latestAttempt: 4,
      runAttempt: {
        workflowRunId: dto.id,
        attempt: 1,
        status: 'running',
        createdAt: dto.created_at,
        startedAt: '2026-05-07T01:01:10.000Z',
        finishedAt: null,
      },
    });
    expect(run).not.toHaveProperty('startedAt');
    expect(run).not.toHaveProperty('finishedAt');
    expect(run).not.toHaveProperty('displayDuration');
    expect(run.jobs.hasStartedJobExecution).toBe(true);
    expect(run.runAttempt.displayDuration).toEqual({
      state: 'live',
      fromIso: '2026-05-07T01:01:10.000Z',
    });
  });

  test('keeps raw-status counts aligned with preview glyphs', () => {
    const {job_display_status_counts: _displayCounts, ...compatibilityDto} = workflowRunDto({
      jobs: [workflowRunJobSummaryDto({status: 'running', execution_status: null})],
      job_status_counts: [{status: 'running', count: 1}],
    });

    const run = toWorkflowRunListItem(compatibilityDto);

    expect(run.jobs.preview[0]?.executionStatus).toBe('running');
    expect(run.jobs.statusCounts).toEqual([{status: 'running', count: 1}]);
  });

  test('maps run list pagination fields', () => {
    const dto = workflowRunListResponseDto({
      runs: [
        workflowRunDto({id: '66666666-6666-4666-8666-000000000001'}),
        workflowRunDto({id: '66666666-6666-4666-8666-000000000002'}),
      ],
      next_cursor: 'cursor-2',
      filtered_total_count: 12,
    });

    const page = toWorkflowRunListPage(dto);

    expect(page.runs.map((run) => run.id)).toEqual([
      '66666666-6666-4666-8666-000000000001',
      '66666666-6666-4666-8666-000000000002',
    ]);
    expect(page.nextCursor).toBe('cursor-2');
    expect(page.filteredTotalCount).toBe(12);
  });

  test('exposes display names and execution durations for bounded job models', () => {
    const job = workflowJob({
      name: null,
      key: 'deploy-prod',
      job_executions: [
        workflowJobExecutionDto({
          queued_at: '2026-05-07T01:00:00.000Z',
          started_at: '2026-05-07T01:00:05.000Z',
          finished_at: '2026-05-07T01:02:00.000Z',
        }),
      ],
    });

    expect(job.displayName).toBe('deploy-prod');
    expect(job.jobExecutions[0]?.displayName).toBe('build');
    expect(job.jobExecutions[0]?.queueTime).toMatchObject({
      state: 'fixed',
      elapsed: {seconds: 5},
    });
    expect(job.jobExecutions[0]?.runTime).toMatchObject({
      state: 'fixed',
      elapsed: {minutes: 1, seconds: 55},
    });
    expect(job.displayDuration).toMatchObject({
      kind: 'run',
      state: 'fixed',
      elapsed: {minutes: 1, seconds: 55},
    });
  });

  test('returns no job display duration when a job has multiple executions', () => {
    const job = workflowJob({
      job_executions: [
        workflowJobExecutionDto({
          sequence: 1,
          queued_at: '2026-05-07T01:00:00.000Z',
          started_at: '2026-05-07T01:00:05.000Z',
          finished_at: '2026-05-07T01:02:00.000Z',
        }),
        workflowJobExecutionDto({
          sequence: 2,
          queued_at: '2026-05-07T02:00:00.000Z',
          started_at: '2026-05-07T02:00:05.000Z',
          finished_at: '2026-05-07T02:02:00.000Z',
        }),
      ],
    });

    expect(job.displayDuration).toBeNull();
  });

  test('maps run attempt summaries', () => {
    const dto = workflowRunAttemptDto({
      id: '77777777-7777-4777-8777-777777777777',
      workflow_run_id: '11111111-1111-4111-8111-111111111111',
      attempt: 2,
      status: 'failed',
      created_at: '2026-05-07T01:02:00.000Z',
      started_at: '2026-05-07T01:02:10.000Z',
      finished_at: '2026-05-07T01:03:00.000Z',
      rerun_mode: 'all',
    });

    const attempt = toWorkflowRunAttempt(dto);

    expect(attempt).toMatchObject({
      id: '77777777-7777-4777-8777-777777777777',
      workflowRunId: '11111111-1111-4111-8111-111111111111',
      attempt: 2,
      status: 'failed',
      createdAt: '2026-05-07T01:02:00.000Z',
      startedAt: '2026-05-07T01:02:10.000Z',
      finishedAt: '2026-05-07T01:03:00.000Z',
      rerunMode: 'all',
    });
    expect(attempt.displayDuration).toMatchObject({state: 'fixed', elapsed: {seconds: 50}});
  });
});

describe('workflow run helpers', () => {
  test('formats trigger labels without dangling separators', () => {
    const withBoth = workflowRunTriggerLabel({triggerSource: 'github', triggerEvent: 'push'});
    const sourceOnly = workflowRunTriggerLabel({triggerSource: 'manual', triggerEvent: ''});
    const neither = workflowRunTriggerLabel({triggerSource: '', triggerEvent: ''});

    expect(withBoth).toBe('github · push');
    expect(sourceOnly).toBe('manual');
    expect(neither).toBe('');
  });

  test('formats visible trigger labels as the event name', () => {
    const withBoth = workflowRunTriggerDisplayLabel({
      triggerSource: 'github',
      triggerEvent: 'push',
    });
    const sourceOnly = workflowRunTriggerDisplayLabel({triggerSource: 'manual', triggerEvent: ''});
    const neither = workflowRunTriggerDisplayLabel({triggerSource: '', triggerEvent: ''});

    expect(withBoth).toBe('push');
    expect(sourceOnly).toBe('manual');
    expect(neither).toBe('');
  });

  test('classifies workflow statuses', () => {
    expect(isWorkflowRunTerminal('succeeded')).toBe(true);
    expect(isWorkflowRunTerminal('running')).toBe(false);
    expect(isWorkflowStatus('pending')).toBe(true);
    expect(isWorkflowStatus('timed_out')).toBe(false);
  });

  test('branch and commit labels fall back to the dev source without a trigger reference', () => {
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

    expect(workflowRunBranchLabel(devRun)).toBe('fix-triage-prompt');
    expect(workflowRunCommitLabel(devRun)).toBe('abcdef1');
  });

  test('branch and commit labels prefer the trigger reference on a dev replay run', () => {
    const replayedDevRun = workflowRunListItem({
      origin: 'dev',
      trigger_reference: {
        repository: 'acme/api',
        ref: 'refs/heads/main',
        commit: '0123456789abcdef0123456789abcdef01234567',
        actor: 'octocat',
      },
      dev_source: {
        ref: 'fix-triage-prompt',
        commit: 'abcdef1234567890abcdef1234567890abcdef12',
        config_path: '.shipfox/workflows/triage-sentry.yml',
        initiated_by_user_id: '99999999-9999-4999-8999-999999999999',
        replay_of_event_id: '88888888-8888-4888-8888-888888888888',
      },
    });

    expect(workflowRunBranchLabel(replayedDevRun)).toBe('main');
    expect(workflowRunCommitLabel(replayedDevRun)).toBe('0123456');
  });

  test('falls back to dev provenance when the trigger reference is partial', () => {
    const devRun = workflowRunListItem({
      origin: 'dev',
      trigger_reference: {
        repository: 'acme/api',
        ref: 'refs/heads/incomplete',
        commit: null,
        actor: 'octocat',
      },
      dev_source: {
        ref: 'fix-triage-prompt',
        commit: 'abcdef1234567890abcdef1234567890abcdef12',
        config_path: '.shipfox/workflows/triage-sentry.yml',
        initiated_by_user_id: '99999999-9999-4999-8999-999999999999',
        replay_of_event_id: null,
      },
    });

    expect(workflowRunBranchLabel(devRun)).toBe('fix-triage-prompt');
    expect(workflowRunCommitLabel(devRun)).toBe('abcdef1');
    expect(workflowRunDevSourceLabel(devRun)).toBe('fix-triage-prompt @ abcdef1');
  });

  test('keeps a partial trigger ref for synced runs without a dev source', () => {
    const syncedRun = workflowRunListItem({
      origin: 'synced',
      trigger_reference: {
        repository: 'acme/api',
        ref: 'refs/heads/main',
        commit: null,
        actor: 'octocat',
      },
    });

    expect(workflowRunBranchLabel(syncedRun)).toBe('main');
    expect(workflowRunCommitLabel(syncedRun)).toBeNull();
  });

  test('formats the dev source as the same resolved ref @ commit shown in the list', () => {
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

    expect(workflowRunDevSourceLabel(devRun)).toBe('fix-triage-prompt @ abcdef1');

    const replayedDevRun = workflowRunListItem({
      origin: 'dev',
      trigger_reference: {
        repository: 'acme/api',
        ref: 'refs/tags/v2.14.0',
        commit: '0123456789abcdef0123456789abcdef01234567',
        actor: 'octocat',
      },
      dev_source: {
        ref: 'fix-triage-prompt',
        commit: 'abcdef1234567890abcdef1234567890abcdef12',
        config_path: '.shipfox/workflows/triage-sentry.yml',
        initiated_by_user_id: '99999999-9999-4999-8999-999999999999',
        replay_of_event_id: '88888888-8888-4888-8888-888888888888',
      },
    });

    expect(workflowRunDevSourceLabel(replayedDevRun)).toBe('v2.14.0 @ 0123456');
    expect(workflowRunDevSourceLabel(workflowRunListItem())).toBeNull();
  });

  test('names the initiating member, shortening the id of anyone else', () => {
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
    const currentUserId = '99999999-9999-4999-8999-999999999999';

    expect(workflowRunInitiatorLabel(devRun, currentUserId)).toBe('You');
    expect(workflowRunInitiatorLabel(devRun, undefined)).toBe('99999999');
    expect(workflowRunInitiatorLabel(workflowRunListItem(), currentUserId)).toBeNull();
  });
});
