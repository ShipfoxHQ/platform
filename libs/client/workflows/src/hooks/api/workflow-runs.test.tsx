import type {StepAttemptDetailResponseDto} from '@shipfox/api-workflows-dto';
import {configureApiClient} from '@shipfox/client-api';
import {type InfiniteData, QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, cleanup, renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import type {WorkflowRunListPage} from '#core/workflow-run.js';
import {
  runAttemptsResponseDto,
  workflowJobDto,
  workflowRunAttemptDto,
  workflowRunDetailDto,
  workflowRunDto,
  workflowRunListResponseDto,
} from '#test/fixtures/workflow-run.js';
import {useStepAttemptDetailQuery} from './step-attempt-detail.js';
import {toStepAttemptDetail, toWorkflowRun, toWorkflowRunListPage} from './workflow-run-mapper.js';
import {
  fireManualWorkflow,
  useCancelWorkflowRunMutation,
  useFireManualWorkflowMutation,
  useRerunWorkflowRunMutation,
  useWorkflowRunAttemptsQuery,
  useWorkflowRunQuery,
  useWorkflowRunsInfiniteQuery,
  workflowRunsQueryKeys,
  workflowRunsRefetchInterval,
} from './workflow-runs.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const DEFINITION_ID = '55555555-5555-4555-8555-555555555555';
const RUN_ID = '66666666-6666-4666-8666-666666666666';
const ROOT_RUN_ID = '77777777-7777-4777-8777-777777777777';
const TEMP_RUN_ID_PATTERN = /^temp-/;

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

function renderWithQueryClient<T>(callback: () => T) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const wrapper = ({children}: {children: ReactNode}) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return {queryClient, ...renderHook(callback, {wrapper})};
}

describe('workflow run API hooks', () => {
  afterEach(() => {
    cleanup();
    configureApiClient({baseUrl: '', fetchImpl: undefined});
  });

  test('does not poll rapidly for an optimistic row that is not on the server yet', () => {
    const page = toWorkflowRunListPage(
      workflowRunListResponseDto({runs: [workflowRunDto({status: 'running'})]}),
    );
    const firstRun = page.runs[0];
    if (!firstRun) throw new Error('Expected a workflow run fixture');
    const temporary = {...firstRun, id: 'temp-run', isTemporary: true};
    const tempData = {
      pages: [{...page, runs: [temporary]}],
      pageParams: [undefined],
    };
    const activeData = {
      pages: [page],
      pageParams: [undefined],
    };

    expect(workflowRunsRefetchInterval(tempData)).toBe(30_000);
    expect(workflowRunsRefetchInterval(activeData)).toBe(4_000);
    expect(
      workflowRunsRefetchInterval({pages: [page, page], pageParams: [undefined, 'cursor']}),
    ).toBe(false);
  });

  test('sends the origin facet as the origin list query parameter', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(workflowRunListResponseDto()));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderWithQueryClient(() => useWorkflowRunsInfiniteQuery(PROJECT_ID, {origin: 'dev'}));

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    const request = firstRequest(fetchImpl);
    expect(request.url).toBe(
      `https://api.example.test/workflows/runs?project_id=${PROJECT_ID}&limit=50&origin=dev`,
    );

    // The origin distinguishes list cache entries, so switching facets refetches rather
    // than reusing the all-origins page.
    const allKey = workflowRunsQueryKeys.list(PROJECT_ID, {});
    const devKey = workflowRunsQueryKeys.list(PROJECT_ID, {origin: 'dev'});
    expect(devKey).not.toEqual(allKey);
  });

  test('maps list DTO pages to workflow run models before caching', async () => {
    const body = workflowRunListResponseDto({
      runs: [
        workflowRunDto({
          id: RUN_ID,
          trigger_provider: 'github',
          trigger_source: 'github_acme',
          trigger_event: 'push',
          updated_at: '2026-05-07T01:02:00.000Z',
        }),
      ],
      next_cursor: 'cursor-2',
      filtered_total_count: 8,
    });
    const fetchImpl = vi.fn(async () => jsonResponse(body));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result, queryClient} = renderWithQueryClient(() =>
      useWorkflowRunsInfiniteQuery(PROJECT_ID, {}),
    );

    await waitFor(() =>
      expect(result.current.data?.pages[0]?.runs[0]?.triggerSource).toBe('github_acme'),
    );
    expect(result.current.data?.pages[0]?.runs[0]).toMatchObject({
      id: RUN_ID,
      triggerProvider: 'github',
      triggerSource: 'github_acme',
      triggerEvent: 'push',
      triggerDisplayLabel: 'push',
      triggerLabel: 'github_acme · push',
      updatedAt: '2026-05-07T01:02:00.000Z',
      isTemporary: false,
    });
    expect(result.current.data?.pages[0]?.nextCursor).toBe('cursor-2');
    expect(result.current.data?.pages[0]?.filteredTotalCount).toBe(8);

    const cached = queryClient.getQueryData<InfiniteData<WorkflowRunListPage, string | undefined>>(
      workflowRunsQueryKeys.list(PROJECT_ID, {}),
    );
    expect(cached?.pages[0]?.runs[0]).toMatchObject({
      triggerProvider: 'github',
      triggerSource: 'github_acme',
      triggerEvent: 'push',
      updatedAt: '2026-05-07T01:02:00.000Z',
    });
    expect(cached?.pages[0]).toHaveProperty('nextCursor', 'cursor-2');
  });

  test('maps detail DTOs to nested workflow run detail models before caching', async () => {
    const body = workflowRunDetailDto({
      id: RUN_ID,
      trigger_source: 'manual',
      trigger_event: 'fire',
      jobs: [workflowJobDto({run_attempt_id: RUN_ID, name: 'build'})],
    });
    const fetchImpl = vi.fn(async () => jsonResponse(body));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result, queryClient} = renderWithQueryClient(() => useWorkflowRunQuery(RUN_ID));

    await waitFor(() => expect(result.current.data?.triggerSource).toBe('manual'));
    expect(result.current.data).toMatchObject({
      id: RUN_ID,
      triggerSource: 'manual',
      triggerEvent: 'fire',
      triggerDisplayLabel: 'fire',
      triggerLabel: 'manual · fire',
      jobs: [{name: 'build', runAttemptId: RUN_ID}],
    });

    const cached = queryClient.getQueryData(workflowRunsQueryKeys.detail(RUN_ID));
    expect(cached).toMatchObject({
      id: RUN_ID,
      triggerSource: 'manual',
      triggerEvent: 'fire',
      jobs: [{name: 'build', runAttemptId: RUN_ID}],
    });
    expect(cached).toHaveProperty('triggerSource', 'manual');
  });

  test('maps lazy step attempt details to authored and resolved troubleshooting data', () => {
    const dto: StepAttemptDetailResponseDto = {
      step_id: '88888888-8888-4888-8888-888888888888',
      attempt: 2,
      authored_config: {run: 'echo $' + '{{ inputs.message }}'},
      config: {run: 'echo hello'},
      evaluation_trace: [
        {
          expression: 'inputs.message',
          roots: ['inputs.message'],
          fill_target: 'run',
          evaluated_at: '2026-08-05T12:00:00.000Z',
          field: 'run',
          value: 'hello',
          degraded: false,
        },
      ],
    };

    expect(toStepAttemptDetail(dto)).toEqual({
      stepId: dto.step_id,
      attempt: 2,
      session: null,
      authoredConfig: dto.authored_config,
      config: dto.config,
      toolArguments: null,
      evaluationTrace: [
        {
          expression: 'inputs.message',
          roots: ['inputs.message'],
          fillTarget: 'run',
          evaluatedAt: '2026-08-05T12:00:00.000Z',
          field: 'run',
          value: 'hello',
          degraded: false,
        },
      ],
    });
  });

  test('maps resolved tool arguments from lazy attempt details', () => {
    const dto: StepAttemptDetailResponseDto = {
      step_id: '88888888-8888-4888-8888-888888888888',
      attempt: 2,
      authored_config: {
        tool: {with: {channel: String.raw`\${{ inputs.channel }}`}},
      },
      config: {
        tool: {with: {channel: '#releases', text: 'Version 2.4.0 is live.'}},
      },
      evaluation_trace: null,
    };

    expect(toStepAttemptDetail(dto).toolArguments).toEqual({
      channel: '#releases',
      text: 'Version 2.4.0 is live.',
    });
  });

  test('maps the recorded session descriptor without exposing transcript data', () => {
    const dto: StepAttemptDetailResponseDto = {
      step_id: '88888888-8888-4888-8888-888888888888',
      attempt: 3,
      authored_config: {prompt: 'Continue'},
      config: {prompt: 'Continue'},
      session: {
        id: '99999999-9999-4999-8999-999999999999',
        key: 'main',
        mode: 'resume',
        segment: 7,
      },
      evaluation_trace: null,
    };

    expect(toStepAttemptDetail(dto).session).toEqual({
      key: 'main',
      mode: 'resume',
      segment: 7,
    });
  });

  test('does not fetch step attempt details while the inspector is closed', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        step_id: '88888888-8888-4888-8888-888888888888',
        attempt: 1,
        authored_config: null,
        config: {},
        evaluation_trace: null,
      }),
    );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderWithQueryClient(() =>
      useStepAttemptDetailQuery('88888888-8888-4888-8888-888888888888', 1, {enabled: false}),
    );

    await Promise.resolve();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('rejects malformed detail responses before they reach the query cache', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({id: RUN_ID, trigger_source: 'manual'}));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result, queryClient} = renderWithQueryClient(() => useWorkflowRunQuery(RUN_ID));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({code: 'invalid-response'});
    expect(queryClient.getQueryData(workflowRunsQueryKeys.detail(RUN_ID))).toBeUndefined();
  });

  test('maps run attempts and caches them by workflow run id', async () => {
    const body = runAttemptsResponseDto({
      attempts: [
        workflowRunAttemptDto({
          id: ROOT_RUN_ID,
          attempt: 1,
          status: 'succeeded',
          created_at: '2026-05-07T01:00:00.000Z',
        }),
        workflowRunAttemptDto({
          id: RUN_ID,
          attempt: 2,
          status: 'failed',
          created_at: '2026-05-07T01:02:00.000Z',
          rerun_mode: 'all',
        }),
      ],
    });
    const fetchImpl = vi.fn(async () => jsonResponse(body));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result, queryClient} = renderWithQueryClient(() =>
      useWorkflowRunAttemptsQuery({workflowRunId: RUN_ID, enabled: true}),
    );

    await waitFor(() => expect(result.current.data?.[1]?.attempt).toBe(2));
    expect(result.current.data?.[1]).toMatchObject({
      id: RUN_ID,
      status: 'failed',
      createdAt: '2026-05-07T01:02:00.000Z',
      rerunMode: 'all',
    });
    expect(firstRequest(fetchImpl).url).toBe(
      `https://api.example.test/workflows/runs/${RUN_ID}/attempts`,
    );
    expect(queryClient.getQueryData(workflowRunsQueryKeys.attempts(RUN_ID))).toEqual(
      result.current.data,
    );
  });

  test('posts manual fire requests with and without inputs', async () => {
    const postBodies: unknown[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      postBodies.push(await (input as Request).clone().json());
      return jsonResponse({workflow_run_id: RUN_ID}, {status: 201});
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const withoutInputs = await fireManualWorkflow({definitionId: DEFINITION_ID});
    const withInputs = await fireManualWorkflow({
      definitionId: DEFINITION_ID,
      inputs: {env: 'production'},
    });

    expect(withoutInputs.workflowRunId).toBe(RUN_ID);
    expect(withInputs.workflowRunId).toBe(RUN_ID);
    expect(postBodies).toEqual([{}, {inputs: {env: 'production'}}]);
    expect(firstRequest(fetchImpl).url).toBe(
      `https://api.example.test/workflow-definitions/${DEFINITION_ID}/fire-manual`,
    );
    expect(firstRequest(fetchImpl).method).toBe('POST');
  });

  test('optimistically inserts manual runs into the same list cache prefix read by the rail', async () => {
    let resolveFire: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFire = resolve;
        }),
    );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    const {result, queryClient} = renderWithQueryClient(() => useFireManualWorkflowMutation());
    const listKey = workflowRunsQueryKeys.list(PROJECT_ID, {});
    queryClient.setQueryData<InfiniteData<WorkflowRunListPage, string | undefined>>(listKey, {
      pages: [
        toWorkflowRunListPage(workflowRunListResponseDto({runs: [], filtered_total_count: 0})),
      ],
      pageParams: [undefined],
    });

    const railListEntries = queryClient.getQueriesData({
      queryKey: workflowRunsQueryKeys.lists(PROJECT_ID),
    });
    expect(railListEntries.map(([queryKey]) => queryKey)).toContainEqual(listKey);

    act(() => {
      result.current.mutate({projectId: PROJECT_ID, definitionId: DEFINITION_ID});
    });

    await waitFor(() => {
      const cached =
        queryClient.getQueryData<InfiniteData<WorkflowRunListPage, string | undefined>>(listKey);
      expect(cached?.pages[0]?.runs[0]).toMatchObject({
        projectId: PROJECT_ID,
        definitionId: DEFINITION_ID,
        number: null,
        workflowName: 'New run',
        status: 'pending',
        triggerSource: 'manual',
        triggerProvider: null,
      });
      expect(cached?.pages[0]?.runs[0]?.id).toMatch(TEMP_RUN_ID_PATTERN);
      expect(cached?.pages[0]?.filteredTotalCount).toBe(1);
    });

    if (!resolveFire) throw new Error('Expected manual fire request');
    const completeFire = resolveFire;
    act(() => {
      completeFire(jsonResponse({workflow_run_id: RUN_ID}, {status: 201}));
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  test('keeps the optimistic manual run out of dev-only lists', async () => {
    let resolveFire: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFire = resolve;
        }),
    );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    const {result, queryClient} = renderWithQueryClient(() => useFireManualWorkflowMutation());
    const allListKey = workflowRunsQueryKeys.list(PROJECT_ID, {});
    const syncedListKey = workflowRunsQueryKeys.list(PROJECT_ID, {origin: 'synced'});
    const devListKey = workflowRunsQueryKeys.list(PROJECT_ID, {origin: 'dev'});
    queryClient.setQueryData<InfiniteData<WorkflowRunListPage, string | undefined>>(allListKey, {
      pages: [
        toWorkflowRunListPage(workflowRunListResponseDto({runs: [], filtered_total_count: 0})),
      ],
      pageParams: [undefined],
    });
    queryClient.setQueryData<InfiniteData<WorkflowRunListPage, string | undefined>>(devListKey, {
      pages: [
        toWorkflowRunListPage(workflowRunListResponseDto({runs: [], filtered_total_count: 0})),
      ],
      pageParams: [undefined],
    });
    queryClient.setQueryData<InfiniteData<WorkflowRunListPage, string | undefined>>(syncedListKey, {
      pages: [
        toWorkflowRunListPage(workflowRunListResponseDto({runs: [], filtered_total_count: 0})),
      ],
      pageParams: [undefined],
    });

    act(() => {
      result.current.mutate({projectId: PROJECT_ID, definitionId: DEFINITION_ID});
    });

    // A manual fire of a synced definition is a synced run: the dev list is untouched while
    // the all-origins list gets the pending row, and the temp row reads as synced.
    await waitFor(() => {
      const allCached =
        queryClient.getQueryData<InfiniteData<WorkflowRunListPage, string | undefined>>(allListKey);
      expect(allCached?.pages[0]?.runs[0]).toMatchObject({
        origin: 'synced',
        devSource: null,
        status: 'pending',
      });
    });
    const syncedCached =
      queryClient.getQueryData<InfiniteData<WorkflowRunListPage, string | undefined>>(
        syncedListKey,
      );
    expect(syncedCached?.pages[0]?.runs[0]).toMatchObject({
      origin: 'synced',
      status: 'pending',
    });
    const devCached =
      queryClient.getQueryData<InfiniteData<WorkflowRunListPage, string | undefined>>(devListKey);
    expect(devCached?.pages[0]?.runs).toHaveLength(0);
    expect(devCached?.pages[0]?.filteredTotalCount).toBe(0);

    if (!resolveFire) throw new Error('Expected manual fire request');
    const completeFire = resolveFire;
    act(() => {
      completeFire(jsonResponse({workflow_run_id: RUN_ID}, {status: 201}));
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  test('does not remove newer optimistic manual runs when an older manual fire fails', async () => {
    const fireRequests: Array<{resolve: (response: Response) => void}> = [];
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          fireRequests.push({resolve});
        }),
    );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    const {result, queryClient} = renderWithQueryClient(() => useFireManualWorkflowMutation());
    const listKey = workflowRunsQueryKeys.list(PROJECT_ID, {});
    queryClient.setQueryData<InfiniteData<WorkflowRunListPage, string | undefined>>(listKey, {
      pages: [
        toWorkflowRunListPage(workflowRunListResponseDto({runs: [], filtered_total_count: 0})),
      ],
      pageParams: [undefined],
    });

    act(() => {
      result.current.mutate({projectId: PROJECT_ID, definitionId: DEFINITION_ID});
    });
    await waitFor(() => expect(fireRequests).toHaveLength(1));
    const firstFire = fireRequests[0];
    if (!firstFire) throw new Error('Expected first manual fire request');

    await waitFor(() => {
      const cached =
        queryClient.getQueryData<InfiniteData<WorkflowRunListPage, string | undefined>>(listKey);
      expect(cached?.pages[0]?.runs).toHaveLength(1);
      expect(cached?.pages[0]?.filteredTotalCount).toBe(1);
    });

    act(() => {
      result.current.mutate({projectId: PROJECT_ID, definitionId: DEFINITION_ID});
    });
    await waitFor(() => expect(fireRequests).toHaveLength(2));
    const secondFire = fireRequests[1];
    if (!secondFire) throw new Error('Expected second manual fire request');

    let secondTempWorkflowRunId: string | undefined;
    await waitFor(() => {
      const cached =
        queryClient.getQueryData<InfiniteData<WorkflowRunListPage, string | undefined>>(listKey);
      expect(cached?.pages[0]?.runs).toHaveLength(2);
      expect(cached?.pages[0]?.filteredTotalCount).toBe(2);
      secondTempWorkflowRunId = cached?.pages[0]?.runs[0]?.id;
      expect(secondTempWorkflowRunId).toMatch(TEMP_RUN_ID_PATTERN);
    });

    act(() => {
      firstFire.resolve(jsonResponse({code: 'server-error'}, {status: 500}));
    });

    await waitFor(() => {
      const cached =
        queryClient.getQueryData<InfiniteData<WorkflowRunListPage, string | undefined>>(listKey);
      expect(cached?.pages[0]?.runs.map((run) => run.id)).toEqual([secondTempWorkflowRunId]);
      expect(cached?.pages[0]?.filteredTotalCount).toBe(1);
    });

    act(() => {
      secondFire.resolve(jsonResponse({workflow_run_id: RUN_ID}, {status: 201}));
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  test('does not fetch run attempts while disabled', () => {
    const fetchImpl = vi.fn(async () => jsonResponse(runAttemptsResponseDto()));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    renderWithQueryClient(() =>
      useWorkflowRunAttemptsQuery({workflowRunId: RUN_ID, enabled: false}),
    );

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('cancels a workflow run and invalidates detail and list queries', async () => {
    const body = workflowRunDto({id: RUN_ID, project_id: PROJECT_ID, status: 'cancelled'});
    const fetchImpl = vi.fn(async () => jsonResponse(body));
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    const run = workflowRunDto({id: RUN_ID, project_id: PROJECT_ID, status: 'running'});
    const {result, queryClient} = renderWithQueryClient(() =>
      useCancelWorkflowRunMutation(toWorkflowRun(run)),
    );
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    let cancelled: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      cancelled = await result.current.mutateAsync();
    });

    const calls = fetchImpl.mock.calls as unknown as Array<[Request]>;
    const request = calls[0]?.[0];
    if (!request) throw new Error('Expected cancel request');
    expect(request.url).toBe(
      'https://api.example.test/workflows/runs/66666666-6666-4666-8666-666666666666/cancel',
    );
    expect(request.method).toBe('POST');
    expect(cancelled?.status).toBe('cancelled');
    expect(invalidateSpy).toHaveBeenCalledWith({queryKey: workflowRunsQueryKeys.detail(RUN_ID)});
    expect(invalidateSpy).toHaveBeenCalledWith({queryKey: workflowRunsQueryKeys.lists(PROJECT_ID)});
  });

  test('posts rerun mode and invalidates project run lists and attempt lineage', async () => {
    const postBodies: unknown[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      postBodies.push(await request.clone().json());
      return jsonResponse(
        workflowRunDto({
          id: '77777777-7777-4777-8777-777777777777',
          current_attempt: 2,
          latest_attempt: 2,
          status: 'pending',
        }),
      );
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result, queryClient} = renderWithQueryClient(() =>
      useRerunWorkflowRunMutation(PROJECT_ID),
    );
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync({workflowRunId: RUN_ID, mode: 'failed'});
    });

    const request = firstRequest(fetchImpl);
    expect(request.url).toBe(`https://api.example.test/workflows/runs/${RUN_ID}/rerun`);
    expect(request.method).toBe('POST');
    expect(postBodies).toEqual([{mode: 'failed'}]);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: workflowRunsQueryKeys.lists(PROJECT_ID),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: workflowRunsQueryKeys.detail(RUN_ID),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: workflowRunsQueryKeys.attempts(RUN_ID),
    });
  });
});

function firstRequest(fetchImpl: ReturnType<typeof vi.fn>): Request {
  const input = (fetchImpl.mock.calls as unknown[][])[0]?.[0];
  if (!(input instanceof Request)) throw new Error('Expected fetch to receive a Request');
  return input;
}
