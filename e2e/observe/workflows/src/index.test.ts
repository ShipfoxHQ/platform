import type {
  JobExecutionSummaryDto,
  StepAttemptDetailResponseDto,
  StepAttemptSummaryDto,
  StepSummaryDto,
  WorkflowJobExecutionDetailDto,
  WorkflowRunAttemptDto,
  WorkflowRunJobOverviewDto,
  WorkflowRunLineageHeadResponseDto,
  WorkflowRunListItemDto,
  WorkflowRunListResponseDto,
  WorkflowRunOverviewHeaderDto,
  WorkflowRunOverviewResponseDto,
  WorkflowRunStatusDto,
} from '@shipfox/api-workflows-dto';
import {
  observeRun,
  waitForRunByCommit,
  waitForRunByDeliveryId,
  waitForRunTerminal,
} from './index.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '99999999-9999-4999-8999-999999999999';
const definitionId = '22222222-2222-4222-8222-222222222222';
const runId = '33333333-3333-4333-8333-333333333333';
const attemptId = '44444444-4444-4444-8444-444444444444';
const jobId = '55555555-5555-4555-8555-555555555555';
const executionId = '66666666-6666-4666-8666-666666666666';
const stepId = '77777777-7777-4777-8777-777777777777';
const timestamp = '2026-07-02T08:00:00.000Z';
const RUN_BY_COMMIT_TIMEOUT_RE =
  /Timed out waiting for workflow run by commit: expectedHeadCommitSha=abc123/u;
const RUN_BY_COMMIT_OBSERVED_RE = /headCommitSha=other/u;
const RUN_BY_DELIVERY_TIMEOUT_RE =
  /Timed out waiting for workflow run by delivery ID: expectedDeliveryId=delivery-1/u;
const RUN_BY_DELIVERY_OBSERVED_RE = /deliveryId=other-delivery/u;
const REPEATED_RUN_CURSOR_RE =
  /last error: Repeated workflow run list cursor while waiting: runs-page-2/u;
const RUN_TERMINAL_TIMEOUT_RE =
  /Timed out waiting for workflow run terminal status: runId=33333333/u;
const RUN_TERMINAL_OBSERVED_RE = /status=running/u;

function valueOr<T>(value: T | undefined, fallback: T): T {
  return value ?? fallback;
}

function run(params: Partial<WorkflowRunListItemDto> = {}): WorkflowRunListItemDto {
  return {
    id: valueOr(params.id, runId),
    project_id: valueOr(params.project_id, projectId),
    definition_id: valueOr(params.definition_id, definitionId),
    number: valueOr(params.number, 1),
    name: valueOr(params.name, 'Build'),
    workflow_name: valueOr(params.workflow_name, 'Build'),
    status: valueOr(params.status, 'pending'),
    origin: valueOr(params.origin, 'synced'),
    dev_source: valueOr(params.dev_source, null),
    current_attempt: valueOr(params.current_attempt, 1),
    latest_attempt: valueOr(params.latest_attempt, 1),
    trigger_provider: valueOr(params.trigger_provider, 'gitea'),
    trigger_source: valueOr(params.trigger_source, 'gitea_e2e'),
    trigger_event: valueOr(params.trigger_event, 'push'),
    trigger_reference: valueOr(params.trigger_reference, {
      repository: 'acme/api',
      ref: 'refs/heads/main',
      commit: 'abc123',
      actor: 'e2e',
    }),
    created_at: valueOr(params.created_at, timestamp),
    updated_at: valueOr(params.updated_at, timestamp),
    started_at: valueOr(params.started_at, null),
    finished_at: valueOr(params.finished_at, null),
    jobs: valueOr(params.jobs, []),
    job_status_counts: valueOr(params.job_status_counts, []),
    has_started_job_execution: valueOr(params.has_started_job_execution, false),
  };
}

function listResponse(
  params: Partial<WorkflowRunListResponseDto> = {},
): WorkflowRunListResponseDto {
  return {
    runs: params.runs ?? [],
    next_cursor: params.next_cursor ?? null,
    filtered_total_count: params.filtered_total_count ?? null,
  };
}

function response(body: unknown): Response {
  return Response.json(body);
}

function runHeader(): WorkflowRunOverviewHeaderDto {
  return {
    id: runId,
    project_id: projectId,
    definition_id: definitionId,
    number: 1,
    name: 'Build',
    workflow_name: 'Build',
    origin: 'synced',
    dev_source: null,
    trigger_provider: 'gitea',
    trigger_source: 'gitea_e2e',
    trigger_event: 'push',
    trigger_reference: null,
    created_at: timestamp,
  };
}

function attempt(status: WorkflowRunStatusDto = 'succeeded'): WorkflowRunAttemptDto {
  return {
    id: attemptId,
    workflow_run_id: runId,
    attempt: 1,
    status,
    created_at: timestamp,
    started_at: timestamp,
    finished_at: status === 'pending' || status === 'running' ? null : timestamp,
    rerun_mode: null,
  };
}

function head(status: WorkflowRunStatusDto = 'succeeded'): WorkflowRunLineageHeadResponseDto {
  return {
    current_attempt: 1,
    latest_attempt: 1,
    current_status: status,
    updated_at: timestamp,
  };
}

function jobSummary(params: Partial<WorkflowRunJobOverviewDto> = {}): WorkflowRunJobOverviewDto {
  return {
    id: jobId,
    key: 'build',
    name: 'Build',
    position: 0,
    dependencies: [],
    status: 'succeeded',
    status_reason: null,
    mode: 'one_shot',
    listener_status: 'inactive',
    carried_over: false,
    execution_count: 1,
    execution_status_counts: {
      pending: 0,
      running: 0,
      succeeded: 1,
      failed: 0,
      cancelled: 0,
    },
    default_execution: null,
    ...params,
  };
}

function overview(
  params: {
    status?: WorkflowRunStatusDto;
    jobs?: WorkflowRunJobOverviewDto[];
    largeJobs?: WorkflowRunOverviewResponseDto['jobs'];
  } = {},
): WorkflowRunOverviewResponseDto {
  const currentAttempt = attempt(params.status ?? 'succeeded');
  return {
    run: runHeader(),
    attempt: currentAttempt,
    has_started_job_execution: params.status !== 'pending',
    jobs: params.largeJobs ?? {
      kind: 'complete',
      total: params.jobs?.length ?? 1,
      items: params.jobs ?? [jobSummary()],
    },
  };
}

function executionSummary(params: Partial<JobExecutionSummaryDto> = {}): JobExecutionSummaryDto {
  return {
    id: executionId,
    sequence: 1,
    name: 'Build #1',
    status: 'succeeded',
    display_status: 'succeeded',
    status_reason: null,
    status_reason_message: null,
    queued_at: timestamp,
    started_at: timestamp,
    finished_at: timestamp,
    timed_out_at: null,
    updated_at: timestamp,
    ...params,
  };
}

function stepAttemptSummary(params: Partial<StepAttemptSummaryDto> = {}): StepAttemptSummaryDto {
  return {
    id: '88888888-8888-4888-8888-888888888888',
    attempt: 1,
    execution_order: 1,
    status: 'succeeded',
    exit_code: 0,
    started_at: timestamp,
    finished_at: timestamp,
    error: null,
    gate_result: {kind: 'none'},
    ...params,
  };
}

function stepSummary(params: Partial<StepSummaryDto> = {}): StepSummaryDto {
  return {
    id: stepId,
    key: 'build',
    name: 'Build',
    type: 'run',
    position: 0,
    status: 'succeeded',
    status_reason: null,
    source_location: null,
    current_attempt: 1,
    error: null,
    attempts: {items: [stepAttemptSummary()], next_cursor: null, total: 1},
    ...params,
  };
}

function selectedExecutionDetail(
  params: {
    sequence?: number;
    steps?: StepSummaryDto[];
    nextCursor?: string | null;
    hasContext?: boolean;
  } = {},
): WorkflowJobExecutionDetailDto {
  return {
    ...executionSummary({sequence: params.sequence ?? 1}),
    has_context: params.hasContext ?? false,
    steps: {
      items: params.steps ?? [stepSummary()],
      next_cursor: params.nextCursor ?? null,
      total: params.steps?.length ?? 1,
    },
  };
}

function stepDetail(
  params: Partial<StepAttemptDetailResponseDto> = {},
): StepAttemptDetailResponseDto {
  return {
    step_id: stepId,
    attempt: 1,
    authored_config: null,
    config: null,
    session: null,
    evaluation_trace: null,
    output: null,
    outputs: {message: 'observed'},
    response: 'done',
    error: undefined,
    gate_result: {kind: 'none'},
    ...params,
  };
}

function context() {
  return {
    workflow_run_id: runId,
    workflow_run_attempt: 1,
    job_id: jobId,
    job_execution_id: executionId,
    job_runner: ['runner'],
    execution_runner: ['runner'],
    job_outputs: {message: 'observed'},
    execution_outputs: {message: 'observed'},
    trigger_events: [],
    job_evaluation_trace: null,
    execution_evaluation_trace: null,
    condition: null,
    oversized_fields: [],
  };
}

function paginatedDeliveryFetch(
  eventId: string,
  paths: string[],
  options: {targetCursor?: string; unresolvedFirstDetail?: boolean} = {},
) {
  const targetCursor = options.targetCursor ?? 'events-page-2';
  const otherEvent = {id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', delivery_id: 'other'};
  const targetEvent = {id: eventId, delivery_id: 'delivery-1'};
  const eventPages = new Map<
    string | null,
    {event: {id: string; delivery_id: string}; nextCursor: string | null}
  >();
  eventPages.set(null, {event: otherEvent, nextCursor: 'events-page-2'});
  eventPages.set('events-page-2', {
    event: targetCursor === 'events-page-2' ? targetEvent : otherEvent,
    nextCursor: targetCursor === 'events-page-2' ? null : 'events-page-3',
  });
  if (targetCursor === 'events-page-3') {
    eventPages.set('events-page-3', {event: targetEvent, nextCursor: null});
  }
  let detailCalls = 0;

  const readTriggerEventPage = (cursor: string | null): Response => {
    const page = eventPages.get(cursor);
    if (!page) throw new Error(`Unexpected trigger event cursor: ${cursor}`);
    return response({trigger_events: [page.event], next_cursor: page.nextCursor});
  };
  const readTriggerEventDetail = (): Response => {
    detailCalls += 1;
    return response({
      decisions: [
        {project_id: workspaceId, decision: 'triggered', run_id: 'other-run'},
        {project_id: projectId, decision: 'triggered', run_id: null},
        {
          project_id: projectId,
          decision: 'triggered',
          run_id: options.unresolvedFirstDetail && detailCalls === 1 ? null : runId,
        },
      ],
    });
  };
  const readRunPage = (cursor: string | null) =>
    cursor === null
      ? listResponse({runs: [run({id: 'other-run'})], next_cursor: 'runs-page-2'})
      : listResponse({runs: [run()]});

  return (input: string | URL): Response => {
    const url = new URL(input);
    paths.push(`${url.pathname}${url.search}`);
    const cursor = url.searchParams.get('cursor');

    if (url.pathname === '/trigger-events') return readTriggerEventPage(cursor);
    if (url.pathname === `/trigger-events/${eventId}`) return readTriggerEventDetail();
    if (url.pathname === '/workflows/runs') return response(readRunPage(cursor));
    throw new Error(`Unexpected request: ${url.pathname}${url.search}`);
  };
}

function paginatedCommitFetch(
  paths: string[],
  options: {failOlderPageOnce?: boolean; restartAfterEnd?: boolean} = {},
) {
  let failedOlderPage = false;
  let frontPageCalls = 0;
  const frontPageRunId = (): string => {
    if (!options.restartAfterEnd) return 'first-page';
    if (frontPageCalls === 8) return runId;
    return `other-page-${frontPageCalls}`;
  };

  const readFrontPage = (): Response => {
    frontPageCalls += 1;
    return response(
      listResponse({
        runs: [
          run({
            id: frontPageRunId(),
            trigger_reference: {
              repository: 'acme/api',
              ref: 'refs/heads/main',
              commit: options.restartAfterEnd && frontPageCalls === 8 ? 'abc123' : 'other',
              actor: 'e2e',
            },
          }),
        ],
        next_cursor: 'runs-page-2',
      }),
    );
  };
  const readSecondPage = (): Response =>
    response(
      listResponse({
        runs: [
          run({
            id: 'second-page',
            trigger_reference: {
              repository: 'acme/api',
              ref: 'refs/heads/main',
              commit: 'other',
              actor: 'e2e',
            },
          }),
        ],
        next_cursor: 'runs-page-3',
      }),
    );
  const readThirdPage = (): Response => {
    if (options.failOlderPageOnce && !failedOlderPage) {
      failedOlderPage = true;
      throw new Error('transient older-page failure');
    }
    return response(listResponse({runs: [], next_cursor: 'runs-page-4'}));
  };
  const readFourthPage = (): Response =>
    response(listResponse({runs: options.restartAfterEnd ? [] : [run()]}));
  const pages = new Map<string | null, () => Response>([
    [null, readFrontPage],
    ['runs-page-2', readSecondPage],
    ['runs-page-3', readThirdPage],
    ['runs-page-4', readFourthPage],
  ]);
  const readCommitPage = (cursor: string | null): Response => {
    const page = pages.get(cursor);
    if (!page) throw new Error(`Unexpected workflow run cursor: ${cursor}`);
    return page();
  };

  return (input: string | URL): Response => {
    const url = new URL(input);
    paths.push(`${url.pathname}${url.search}`);
    const cursor = url.searchParams.get('cursor');

    if (url.pathname !== '/workflows/runs') {
      throw new Error(`Unexpected request: ${url.pathname}${url.search}`);
    }
    return readCommitPage(cursor);
  };
}

describe('waitForRunByCommit', () => {
  test('polls until a run with the matching head commit appears', async () => {
    let calls = 0;
    const result = await waitForRunByCommit({
      fetch: () => {
        calls += 1;
        return response(
          listResponse({
            runs: [
              run(
                calls === 1
                  ? {
                      trigger_reference: {
                        repository: 'acme/api',
                        ref: 'refs/heads/main',
                        commit: 'other',
                        actor: 'e2e',
                      },
                    }
                  : {},
              ),
            ],
          }),
        );
      },
      headCommitSha: 'abc123',
      initialDelayMs: 1,
      projectId,
      token: 'user-token',
    });
    expect(result.id).toBe(runId);
    expect(calls).toBe(2);
  });

  test('correlates on the bounded trigger reference commit', async () => {
    const result = await waitForRunByCommit({
      fetch: () =>
        response(
          listResponse({
            runs: [
              run({
                trigger_reference: {
                  repository: 'acme/api',
                  ref: 'refs/heads/main',
                  commit: 'abc123',
                  actor: 'e2e',
                },
              }),
            ],
          }),
        ),
      headCommitSha: 'abc123',
      initialDelayMs: 1,
      projectId,
      token: 'user-token',
    });
    expect(result.id).toBe(runId);
  });

  test('limits each probe to two pages, rechecks the front window, and advances older pages', async () => {
    const paths: string[] = [];
    const result = await waitForRunByCommit({
      fetch: paginatedCommitFetch(paths),
      headCommitSha: 'abc123',
      initialDelayMs: 1,
      projectId,
      token: 'user-token',
    });

    expect(result.id).toBe(runId);
    expect(paths).toEqual([
      `/workflows/runs?project_id=${projectId}&limit=100`,
      `/workflows/runs?project_id=${projectId}&limit=100&cursor=runs-page-2`,
      `/workflows/runs?project_id=${projectId}&limit=100`,
      `/workflows/runs?project_id=${projectId}&limit=100&cursor=runs-page-2`,
      `/workflows/runs?project_id=${projectId}&limit=100`,
      `/workflows/runs?project_id=${projectId}&limit=100&cursor=runs-page-3`,
      `/workflows/runs?project_id=${projectId}&limit=100`,
      `/workflows/runs?project_id=${projectId}&limit=100&cursor=runs-page-2`,
      `/workflows/runs?project_id=${projectId}&limit=100`,
      `/workflows/runs?project_id=${projectId}&limit=100&cursor=runs-page-4`,
    ]);
  });

  test('rechecks the front window while polling for a newly visible run', async () => {
    let poll = 0;
    const paths: string[] = [];
    const result = await waitForRunByCommit({
      fetch: (input) => {
        const url = new URL(input);
        paths.push(`${url.pathname}${url.search}`);
        const cursor = url.searchParams.get('cursor');
        if (url.pathname !== '/workflows/runs') {
          throw new Error(`Unexpected request: ${url.pathname}${url.search}`);
        }
        if (cursor === null) {
          poll += 1;
          return response(
            listResponse({
              runs: [
                run({
                  id: `other-page-${poll}`,
                  trigger_reference: {
                    repository: 'acme/api',
                    ref: 'refs/heads/main',
                    commit: 'other',
                    actor: 'e2e',
                  },
                }),
              ],
              next_cursor: 'runs-page-2',
            }),
          );
        }
        if (cursor === 'runs-page-2') {
          return response(
            listResponse({
              runs: [
                run(
                  poll === 2
                    ? {}
                    : {
                        id: 'second-page',
                        trigger_reference: {
                          repository: 'acme/api',
                          ref: 'refs/heads/main',
                          commit: 'other',
                          actor: 'e2e',
                        },
                      },
                ),
              ],
              next_cursor: 'runs-page-3',
            }),
          );
        }
        throw new Error(`Unexpected workflow run cursor: ${cursor}`);
      },
      headCommitSha: 'abc123',
      initialDelayMs: 1,
      projectId,
      token: 'user-token',
    });

    expect(result.id).toBe(runId);
    expect(paths).toEqual([
      `/workflows/runs?project_id=${projectId}&limit=100`,
      `/workflows/runs?project_id=${projectId}&limit=100&cursor=runs-page-2`,
      `/workflows/runs?project_id=${projectId}&limit=100`,
      `/workflows/runs?project_id=${projectId}&limit=100&cursor=runs-page-2`,
    ]);
  });

  test('reports a repeated older cursor in the timeout diagnostic', async () => {
    const result = waitForRunByCommit({
      fetch: (input) => {
        const url = new URL(input);
        if (url.pathname !== '/workflows/runs') {
          throw new Error(`Unexpected request: ${url.pathname}${url.search}`);
        }
        return response(
          listResponse({
            runs: [
              run({
                trigger_reference: {
                  repository: 'acme/api',
                  ref: 'refs/heads/main',
                  commit: 'other',
                  actor: 'e2e',
                },
              }),
            ],
            next_cursor: 'runs-page-2',
          }),
        );
      },
      backoffFactor: 1,
      headCommitSha: 'abc123',
      initialDelayMs: 1,
      maxDelayMs: 1,
      projectId,
      timeoutMs: 100,
      token: 'user-token',
    });

    await expect(result).rejects.toThrow(REPEATED_RUN_CURSOR_RE);
  });

  test('retries an older page after a transient fetch failure', async () => {
    const paths: string[] = [];
    const result = await waitForRunByCommit({
      fetch: paginatedCommitFetch(paths, {failOlderPageOnce: true}),
      backoffFactor: 1,
      headCommitSha: 'abc123',
      initialDelayMs: 1,
      maxDelayMs: 1,
      projectId,
      token: 'user-token',
    });

    expect(result.id).toBe(runId);
    expect(paths).toEqual([
      `/workflows/runs?project_id=${projectId}&limit=100`,
      `/workflows/runs?project_id=${projectId}&limit=100&cursor=runs-page-2`,
      `/workflows/runs?project_id=${projectId}&limit=100`,
      `/workflows/runs?project_id=${projectId}&limit=100&cursor=runs-page-2`,
      `/workflows/runs?project_id=${projectId}&limit=100`,
      `/workflows/runs?project_id=${projectId}&limit=100&cursor=runs-page-3`,
      `/workflows/runs?project_id=${projectId}&limit=100`,
      `/workflows/runs?project_id=${projectId}&limit=100&cursor=runs-page-3`,
      `/workflows/runs?project_id=${projectId}&limit=100`,
      `/workflows/runs?project_id=${projectId}&limit=100&cursor=runs-page-2`,
      `/workflows/runs?project_id=${projectId}&limit=100`,
      `/workflows/runs?project_id=${projectId}&limit=100&cursor=runs-page-4`,
    ]);
  });

  test('restarts the older traversal after reaching the end of the list', async () => {
    const paths: string[] = [];
    const result = await waitForRunByCommit({
      fetch: paginatedCommitFetch(paths, {restartAfterEnd: true}),
      backoffFactor: 1,
      headCommitSha: 'abc123',
      initialDelayMs: 1,
      maxDelayMs: 1,
      projectId,
      token: 'user-token',
    });

    expect(result.id).toBe(runId);
    expect(paths).toEqual([
      `/workflows/runs?project_id=${projectId}&limit=100`,
      `/workflows/runs?project_id=${projectId}&limit=100&cursor=runs-page-2`,
      `/workflows/runs?project_id=${projectId}&limit=100`,
      `/workflows/runs?project_id=${projectId}&limit=100&cursor=runs-page-2`,
      `/workflows/runs?project_id=${projectId}&limit=100`,
      `/workflows/runs?project_id=${projectId}&limit=100&cursor=runs-page-3`,
      `/workflows/runs?project_id=${projectId}&limit=100`,
      `/workflows/runs?project_id=${projectId}&limit=100&cursor=runs-page-2`,
      `/workflows/runs?project_id=${projectId}&limit=100`,
      `/workflows/runs?project_id=${projectId}&limit=100&cursor=runs-page-4`,
      `/workflows/runs?project_id=${projectId}&limit=100`,
      `/workflows/runs?project_id=${projectId}&limit=100&cursor=runs-page-2`,
      `/workflows/runs?project_id=${projectId}&limit=100`,
      `/workflows/runs?project_id=${projectId}&limit=100&cursor=runs-page-3`,
      `/workflows/runs?project_id=${projectId}&limit=100`,
    ]);
  });

  test('times out with a bounded run list summary', async () => {
    const result = waitForRunByCommit({
      fetch: () =>
        response(
          listResponse({
            runs: [
              run({
                trigger_reference: {
                  repository: 'acme/api',
                  ref: 'refs/heads/main',
                  commit: 'other',
                  actor: 'e2e',
                },
              }),
            ],
          }),
        ),
      headCommitSha: 'abc123',
      initialDelayMs: 1,
      projectId,
      timeoutMs: 1,
      token: 'user-token',
    });
    await expect(result).rejects.toThrow(RUN_BY_COMMIT_TIMEOUT_RE);
    await expect(result).rejects.toThrow(RUN_BY_COMMIT_OBSERVED_RE);
  });

  test('passes abort signals through polling', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = waitForRunByCommit({
      fetch: () => response(listResponse()),
      headCommitSha: 'abc123',
      projectId,
      signal: controller.signal,
      token: 'user-token',
    });
    await expect(result).rejects.toThrow(
      'Stopped waiting for Timed out waiting for workflow run by commit',
    );
  });
});

describe('waitForRunByDeliveryId', () => {
  test('polls until the matching trigger event resolves to a run', async () => {
    let calls = 0;
    const eventId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const result = await waitForRunByDeliveryId({
      fetch: (input) => {
        const url = new URL(input);
        if (url.pathname === '/trigger-events') {
          calls += 1;
          return response({
            trigger_events: [
              {
                id: eventId,
                delivery_id: calls === 1 ? 'other-delivery' : 'delivery-1',
              },
            ],
            next_cursor: null,
          });
        }
        if (url.pathname === `/trigger-events/${eventId}`) {
          return response({
            decisions: [
              {project_id: workspaceId, decision: 'triggered', run_id: 'other-run'},
              {project_id: projectId, decision: 'triggered', run_id: null},
              {project_id: projectId, decision: 'triggered', run_id: runId},
            ],
          });
        }
        if (url.pathname === '/workflows/runs') {
          return response(listResponse({runs: [run()]}));
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      },
      deliveryId: 'delivery-1',
      initialDelayMs: 1,
      projectId,
      workspaceId,
      token: 'user-token',
    });
    expect(result.id).toBe(runId);
    expect(calls).toBe(2);
  });

  test('follows event and run cursors while selecting the requested project decision', async () => {
    const eventId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const paths: string[] = [];
    const result = await waitForRunByDeliveryId({
      fetch: paginatedDeliveryFetch(eventId, paths),
      deliveryId: 'delivery-1',
      initialDelayMs: 1,
      projectId,
      workspaceId,
      token: 'user-token',
    });

    expect(result.id).toBe(runId);
    expect(paths).toContain(
      '/trigger-events?workspace_id=99999999-9999-4999-8999-999999999999&limit=100',
    );
    expect(paths).toContain(
      '/trigger-events?workspace_id=99999999-9999-4999-8999-999999999999&limit=100&cursor=events-page-2',
    );
    expect(paths).toContain(
      '/workflows/runs?project_id=11111111-1111-4111-8111-111111111111&limit=100',
    );
    expect(paths).toContain(
      '/workflows/runs?project_id=11111111-1111-4111-8111-111111111111&limit=100&cursor=runs-page-2',
    );
  });

  test('re-reads an older event page while its project decision is unresolved', async () => {
    const eventId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const paths: string[] = [];
    const result = await waitForRunByDeliveryId({
      fetch: paginatedDeliveryFetch(eventId, paths, {
        targetCursor: 'events-page-3',
        unresolvedFirstDetail: true,
      }),
      deliveryId: 'delivery-1',
      initialDelayMs: 1,
      projectId,
      workspaceId,
      token: 'user-token',
    });

    expect(result.id).toBe(runId);
    expect(paths.filter((path) => path === `/trigger-events/${eventId}`)).toHaveLength(2);
    expect(paths).toEqual([
      `/trigger-events?workspace_id=${workspaceId}&limit=100`,
      `/trigger-events?workspace_id=${workspaceId}&limit=100&cursor=events-page-2`,
      `/trigger-events?workspace_id=${workspaceId}&limit=100`,
      `/trigger-events?workspace_id=${workspaceId}&limit=100&cursor=events-page-2`,
      `/trigger-events?workspace_id=${workspaceId}&limit=100`,
      `/trigger-events?workspace_id=${workspaceId}&limit=100&cursor=events-page-3`,
      `/trigger-events/${eventId}`,
      `/trigger-events?workspace_id=${workspaceId}&limit=100`,
      `/trigger-events?workspace_id=${workspaceId}&limit=100&cursor=events-page-2`,
      `/trigger-events?workspace_id=${workspaceId}&limit=100`,
      `/trigger-events?workspace_id=${workspaceId}&limit=100&cursor=events-page-3`,
      `/trigger-events/${eventId}`,
      `/workflows/runs?project_id=${projectId}&limit=100`,
      `/workflows/runs?project_id=${projectId}&limit=100&cursor=runs-page-2`,
    ]);
  });

  test('times out with a bounded trigger event summary', async () => {
    const result = waitForRunByDeliveryId({
      fetch: () =>
        response({
          trigger_events: [
            {
              id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              delivery_id: 'other-delivery',
            },
          ],
          next_cursor: null,
        }),
      deliveryId: 'delivery-1',
      initialDelayMs: 1,
      projectId,
      workspaceId,
      timeoutMs: 1,
      token: 'user-token',
    });
    await expect(result).rejects.toThrow(RUN_BY_DELIVERY_TIMEOUT_RE);
    await expect(result).rejects.toThrow(RUN_BY_DELIVERY_OBSERVED_RE);
  });
});

describe('waitForRunTerminal', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test.each([
    'succeeded',
    'failed',
    'cancelled',
  ] satisfies WorkflowRunStatusDto[])('reads bounded lineage and overview resources for %s runs', async (status) => {
    const paths: string[] = [];
    const result = await waitForRunTerminal({
      fetch: (input) => {
        const url = new URL(input);
        paths.push(`${url.pathname}${url.search}`);
        if (url.pathname.endsWith('/head')) return response(head(status));
        if (url.pathname.endsWith('/overview')) return response(overview({status}));
        throw new Error(`Unexpected request: ${url.pathname}${url.search}`);
      },
      runId,
      token: 'user-token',
    });

    expect(result.status).toBe(status);
    expect(result.attempt.status).toBe(status);
    expect(paths).toEqual([
      `/workflows/runs/${runId}/head`,
      `/workflows/runs/${runId}/overview?attempt=1`,
    ]);
  });

  test('polls lineage and overview until the run reaches a terminal status', async () => {
    let poll = 0;
    const paths: string[] = [];
    const result = await waitForRunTerminal({
      fetch: (input) => {
        const url = new URL(input);
        paths.push(`${url.pathname}${url.search}`);
        if (url.pathname.endsWith('/head')) {
          poll += 1;
          return response(head(poll === 1 ? 'running' : 'succeeded'));
        }
        return response(overview({status: poll === 1 ? 'running' : 'succeeded'}));
      },
      initialDelayMs: 1,
      runId,
      token: 'user-token',
    });

    expect(result.status).toBe('succeeded');
    expect(paths).toHaveLength(4);
    expect(paths.every((path) => !path.includes(`/workflows/runs/${runId}?`))).toBe(true);
  });

  test('reports the last bounded resource on timeout', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const result = waitForRunTerminal({
      fetch: (input) => {
        const url = new URL(input);
        if (url.pathname.endsWith('/head')) return response(head('running'));
        return response(overview({status: 'running'}));
      },
      initialDelayMs: 1,
      runId,
      timeoutMs: 1,
      token: 'user-token',
    });

    const assertions = Promise.all([
      expect(result).rejects.toThrow(RUN_TERMINAL_TIMEOUT_RE),
      expect(result).rejects.toThrow(RUN_TERMINAL_OBSERVED_RE),
      expect(result).rejects.toThrow('lastBoundedResource=workflow run overview attempt 1'),
    ]);
    await vi.advanceTimersByTimeAsync(1);
    await assertions;
  });

  test('follows only the bounded pages needed for a selected execution and step', async () => {
    const paths: string[] = [];
    const otherJob = jobSummary({id: '99999999-9999-4999-8999-999999999999', key: 'other'});
    const selectedJob = jobSummary({key: 'target'});
    const otherStep = stepSummary({id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', key: 'other'});
    const selectedStep = stepSummary({key: 'target'});
    const secondExecution = executionSummary({
      id: executionId,
      sequence: 2,
      name: 'Build #2',
    });
    const responses = new Map<string, Response>([
      [`/workflows/runs/${runId}/head`, response(head('succeeded'))],
      [
        `/workflows/runs/${runId}/overview?attempt=1`,
        response(
          overview({
            largeJobs: {
              kind: 'large',
              total: 2,
              status_counts: [{status: 'succeeded', count: 2}],
              first_page: {items: [otherJob], next_cursor: 'jobs-1', total: 1},
            },
          }),
        ),
      ],
      [
        `/workflows/runs/${runId}/jobs?attempt=1&limit=100&cursor=jobs-1`,
        response({items: [selectedJob], next_cursor: null, total: 1}),
      ],
      [
        `/workflows/runs/jobs/${jobId}/executions?limit=25`,
        response({items: [executionSummary()], next_cursor: 'executions-1', total: 2}),
      ],
      [
        `/workflows/runs/jobs/${jobId}/executions?limit=25&cursor=executions-1`,
        response({items: [secondExecution], next_cursor: null, total: 2}),
      ],
      [
        `/workflows/runs/jobs/${jobId}?execution_id=${executionId}`,
        response({
          workflow_run_id: runId,
          workflow_run_attempt: 1,
          job: selectedJob,
          selected_execution: selectedExecutionDetail({
            sequence: 2,
            steps: [otherStep],
            nextCursor: 'steps-1',
            hasContext: true,
          }),
        }),
      ],
      [
        `/workflows/runs/jobs/${jobId}/executions/${executionId}/steps?limit=100&cursor=steps-1`,
        response({items: [selectedStep], next_cursor: null, total: 2}),
      ],
      [`/workflows/runs/jobs/${jobId}/executions/${executionId}/context`, response(context())],
      [`/workflows/runs/steps/${stepId}/attempts/1`, response(stepDetail())],
    ]);

    const result = await observeRun({
      fetch: (input) => {
        const url = new URL(input);
        const path = `${url.pathname}${url.search}`;
        paths.push(path);
        const next = responses.get(path);
        if (next === undefined) throw new Error(`Unexpected request: ${path}`);
        return next;
      },
      runId,
      selection: {
        jobs: [
          {
            jobKey: 'target',
            executionSequences: [2],
            includeContext: true,
            stepKeys: ['target'],
          },
        ],
      },
      token: 'user-token',
    });

    const target = result.jobs.find((job) => job.key === 'target');
    expect(target?.executions.map((execution) => execution.sequence)).toEqual([2]);
    expect(target?.executions[0]?.context?.execution_outputs).toEqual({message: 'observed'});
    expect(target?.executions[0]?.steps.map((step) => step.key)).toEqual(['target']);
    expect(target?.executions[0]?.steps[0]?.response).toBe('done');
    expect(paths).toContain(`/workflows/runs/${runId}/jobs?attempt=1&limit=100&cursor=jobs-1`);
    expect(paths).toContain(
      `/workflows/runs/jobs/${jobId}/executions?limit=25&cursor=executions-1`,
    );
    expect(paths).toContain(
      `/workflows/runs/jobs/${jobId}/executions/${executionId}/steps?limit=100&cursor=steps-1`,
    );
    expect(paths.every((path) => !path.includes(`/workflows/runs/${runId}?`))).toBe(true);
  });

  test('follows every step page when attempt details are selected without step keys', async () => {
    const paths: string[] = [];
    const otherStepId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const selectedJob = jobSummary({key: 'target'});
    const otherStep = stepSummary({id: otherStepId, key: 'other'});
    const selectedStep = stepSummary({key: 'target'});
    const responses = new Map<string, Response>([
      [`/workflows/runs/${runId}/head`, response(head('succeeded'))],
      [`/workflows/runs/${runId}/overview?attempt=1`, response(overview({jobs: [selectedJob]}))],
      [
        `/workflows/runs/jobs/${jobId}`,
        response({
          workflow_run_id: runId,
          workflow_run_attempt: 1,
          job: selectedJob,
          selected_execution: selectedExecutionDetail({
            steps: [otherStep],
            nextCursor: 'steps-1',
          }),
        }),
      ],
      [
        `/workflows/runs/jobs/${jobId}/executions/${executionId}/steps?limit=100&cursor=steps-1`,
        response({items: [selectedStep], next_cursor: null, total: 2}),
      ],
      [
        `/workflows/runs/steps/${otherStepId}/attempts/1`,
        response(stepDetail({step_id: otherStepId})),
      ],
      [`/workflows/runs/steps/${stepId}/attempts/1`, response(stepDetail())],
    ]);

    const result = await observeRun({
      fetch: (input) => {
        const url = new URL(input);
        const path = `${url.pathname}${url.search}`;
        paths.push(path);
        const next = responses.get(path);
        if (next === undefined) throw new Error(`Unexpected request: ${path}`);
        return next;
      },
      runId,
      selection: {
        jobs: [{jobKey: 'target', includeDefaultExecution: true, stepAttempts: 'all'}],
      },
      token: 'user-token',
    });

    const target = result.jobs.find((job) => job.key === 'target');
    expect(target?.executions[0]?.steps.map((step) => step.key)).toEqual(['other', 'target']);
    expect(paths).toContain(
      `/workflows/runs/jobs/${jobId}/executions/${executionId}/steps?limit=100&cursor=steps-1`,
    );
  });

  test('does not re-read the default execution when it is selected by sequence', async () => {
    const paths: string[] = [];
    const selectedJob = jobSummary({key: 'target'});
    const responses = new Map<string, Response>([
      [`/workflows/runs/${runId}/head`, response(head('succeeded'))],
      [`/workflows/runs/${runId}/overview?attempt=1`, response(overview({jobs: [selectedJob]}))],
      [
        `/workflows/runs/jobs/${jobId}`,
        response({
          workflow_run_id: runId,
          workflow_run_attempt: 1,
          job: selectedJob,
          selected_execution: selectedExecutionDetail({steps: []}),
        }),
      ],
      [
        `/workflows/runs/jobs/${jobId}/executions?limit=25`,
        response({items: [executionSummary()], next_cursor: 'executions-1', total: 26}),
      ],
    ]);

    const result = await observeRun({
      fetch: (input) => {
        const url = new URL(input);
        const path = `${url.pathname}${url.search}`;
        paths.push(path);
        const next = responses.get(path);
        if (next === undefined) throw new Error(`Unexpected request: ${path}`);
        return next;
      },
      runId,
      selection: {
        jobs: [{jobKey: 'target', includeDefaultExecution: true, executionSequences: [1]}],
      },
      token: 'user-token',
    });

    expect(result.jobs.find((job) => job.key === 'target')?.executions).toHaveLength(1);
    expect(paths.filter((path) => path === `/workflows/runs/jobs/${jobId}`)).toHaveLength(1);
    expect(paths).not.toContain(`/workflows/runs/jobs/${jobId}?execution_id=${executionId}`);
  });

  test('reports selected job keys missing from bounded overview pages', async () => {
    const result = observeRun({
      fetch: (input) => {
        const url = new URL(input);
        if (url.pathname.endsWith('/head')) return response(head('succeeded'));
        if (url.pathname.endsWith('/overview')) return response(overview({jobs: []}));
        throw new Error(`Unexpected request: ${url.pathname}${url.search}`);
      },
      runId,
      selection: {jobs: [{jobKey: 'missing'}]},
      token: 'user-token',
    });

    await expect(result).rejects.toThrow(
      'Requested workflow run job keys were not found in bounded overview pages: missing; last bounded resource=workflow run overview attempt 1',
    );
  });

  test('names the last bounded cursor resource when a page repeats', async () => {
    const result = observeRun({
      fetch: (input) => {
        const url = new URL(input);
        const path = `${url.pathname}${url.search}`;
        if (url.pathname.endsWith('/head')) return response(head('succeeded'));
        if (url.pathname.endsWith('/overview')) {
          return response(
            overview({
              largeJobs: {
                kind: 'large',
                total: 2,
                status_counts: [{status: 'succeeded', count: 2}],
                first_page: {items: [], next_cursor: 'jobs-1', total: 0},
              },
            }),
          );
        }
        if (path.endsWith('/jobs?attempt=1&limit=100&cursor=jobs-1')) {
          return response({items: [], next_cursor: 'jobs-1', total: 2});
        }
        throw new Error(`Unexpected request: ${path}`);
      },
      runId,
      selection: {jobs: [{jobKey: 'missing'}]},
      token: 'user-token',
    });

    await expect(result).rejects.toThrow(
      'Repeated workflow run job cursor while reading bounded job summaries; last bounded resource=workflow run job summaries cursor jobs-1',
    );
  });
});
