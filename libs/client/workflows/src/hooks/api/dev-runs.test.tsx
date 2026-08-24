import {configureApiClient} from '@shipfox/client-api';
import {type InfiniteData, QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {act, cleanup, renderHook, waitFor} from '@testing-library/react';
import type {ReactNode} from 'react';
import type {DefinitionAtRefListing} from '#core/definitions-at-ref.js';
import type {WorkflowRunListPage} from '#core/workflow-run.js';
import {workflowRunListResponseDto} from '#test/fixtures/workflow-run.js';
import {definitionsAtRefQueryKeys} from './definitions-at-ref.js';
import {useCreateDevRunMutation} from './dev-runs.js';
import {toWorkflowRunListPage} from './workflow-run-mapper.js';
import {workflowRunsQueryKeys} from './workflow-runs.js';

const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const RUN_ID = '66666666-6666-4666-8666-666666666666';
const REF = 'fix-triage-prompt';
const CONFIG_PATH = '.shipfox/workflows/triage-sentry.yml';
const COMMIT = 'abc123def456abc123def456abc123def456abc123';
const FRESH_COMMIT = 'def456abc123def456abc123def456abc123def456';
const REPLAY_EVENT_ID = '22222222-2222-4222-8222-222222222222';
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

function atRefListing(
  overrides: {
    name?: string | null;
    triggers?: DefinitionAtRefListing['files'][number]['triggers'];
  } = {},
): DefinitionAtRefListing {
  return {
    ref: REF,
    commit: COMMIT,
    files: [
      {
        configPath: CONFIG_PATH,
        name: 'triage-sentry',
        valid: true,
        errors: [],
        warnings: [],
        triggers: {on_issue: {source: 'cron', event: 'tick'}},
        ...overrides,
      },
    ],
  };
}

function atRefResponseIfRequested(
  input: RequestInfo | URL,
  {
    commit = COMMIT,
    triggers = {on_issue: {source: 'cron', event: 'tick'}},
  }: {
    commit?: string;
    triggers?: DefinitionAtRefListing['files'][number]['triggers'];
  } = {},
): Response | undefined {
  const url = input instanceof Request ? input.url : String(input);
  if (new URL(url).pathname !== '/definitions/at-ref') return undefined;

  return jsonResponse({
    ref: REF,
    commit,
    files: [
      {
        config_path: CONFIG_PATH,
        name: 'triage-sentry',
        valid: true,
        errors: [],
        warnings: [],
        triggers,
      },
    ],
  });
}

function seedRunList(queryClient: QueryClient, key: readonly unknown[], filteredTotalCount = 0) {
  queryClient.setQueryData<InfiniteData<WorkflowRunListPage, string | undefined>>(key, {
    pages: [
      toWorkflowRunListPage(
        workflowRunListResponseDto({runs: [], filtered_total_count: filteredTotalCount}),
      ),
    ],
    pageParams: [undefined],
  });
}

describe('dev run API hooks', () => {
  afterEach(() => {
    cleanup();
    configureApiClient({baseUrl: '', fetchImpl: undefined});
  });

  test('posts dev run requests with the pinned commit, inputs, and a replay event', async () => {
    const postBodies: unknown[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      postBodies.push(await (input as Request).clone().json());
      return jsonResponse({workflow_run_id: RUN_ID, commit: COMMIT}, {status: 201});
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result} = renderWithQueryClient(() => useCreateDevRunMutation());

    let launch: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      launch = await result.current.mutateAsync({
        projectId: PROJECT_ID,
        ref: REF,
        commit: COMMIT,
        configPath: CONFIG_PATH,
        trigger: 'on_issue',
        inputs: {env: 'production'},
        replayEventId: REPLAY_EVENT_ID,
      });
    });

    expect(launch).toEqual({workflowRunId: RUN_ID, commit: COMMIT});
    expect(postBodies).toEqual([
      {
        project_id: PROJECT_ID,
        ref: REF,
        commit: COMMIT,
        config_path: CONFIG_PATH,
        trigger: 'on_issue',
        inputs: {env: 'production'},
        replay_event_id: '22222222-2222-4222-8222-222222222222',
      },
    ]);
    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe('https://api.example.test/dev-runs');
    expect(request.method).toBe('POST');
  });

  test('omits optional inputs and replay event when absent', async () => {
    const postBodies: unknown[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      postBodies.push(await (input as Request).clone().json());
      return jsonResponse({workflow_run_id: RUN_ID, commit: COMMIT}, {status: 201});
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {result} = renderWithQueryClient(() => useCreateDevRunMutation());

    await act(async () => {
      await result.current.mutateAsync({
        projectId: PROJECT_ID,
        ref: REF,
        commit: COMMIT,
        configPath: CONFIG_PATH,
        trigger: 'on_issue',
      });
    });

    expect(postBodies).toEqual([
      {
        project_id: PROJECT_ID,
        ref: REF,
        commit: COMMIT,
        config_path: CONFIG_PATH,
        trigger: 'on_issue',
      },
    ]);
  });

  test('optimistically inserts dev runs into all-origins and dev lists from the at-ref cache', async () => {
    let resolveRun: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const atRefResponse = atRefResponseIfRequested(input);
      if (atRefResponse) return Promise.resolve(atRefResponse);
      return new Promise<Response>((resolve) => {
        resolveRun = resolve;
      });
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    const {result, queryClient} = renderWithQueryClient(() => useCreateDevRunMutation());
    queryClient.setQueryData(definitionsAtRefQueryKeys.atRef(PROJECT_ID, REF), atRefListing());
    const allListKey = workflowRunsQueryKeys.list(PROJECT_ID, {});
    const devListKey = workflowRunsQueryKeys.list(PROJECT_ID, {origin: 'dev'});
    seedRunList(queryClient, allListKey);
    seedRunList(queryClient, devListKey);

    act(() => {
      result.current.mutate({
        projectId: PROJECT_ID,
        ref: REF,
        commit: COMMIT,
        configPath: CONFIG_PATH,
        trigger: 'on_issue',
      });
    });

    await waitFor(() => {
      const cached =
        queryClient.getQueryData<InfiniteData<WorkflowRunListPage, string | undefined>>(allListKey);
      expect(cached?.pages[0]?.runs[0]).toMatchObject({
        projectId: PROJECT_ID,
        definitionId: '',
        number: null,
        workflowName: 'triage-sentry',
        origin: 'dev',
        devSource: {ref: REF, commit: COMMIT, configPath: CONFIG_PATH, replayOfEventId: null},
        status: 'pending',
        triggerSource: 'cron',
        triggerEvent: 'tick',
        triggerLabel: 'cron · tick',
        triggerReference: null,
      });
      expect(cached?.pages[0]?.runs[0]?.id).toMatch(TEMP_RUN_ID_PATTERN);
      expect(cached?.pages[0]?.filteredTotalCount).toBe(1);
    });

    const devCached =
      queryClient.getQueryData<InfiniteData<WorkflowRunListPage, string | undefined>>(devListKey);
    expect(devCached?.pages[0]?.runs[0]).toMatchObject({
      origin: 'dev',
      workflowName: 'triage-sentry',
      status: 'pending',
    });
    expect(devCached?.pages[0]?.filteredTotalCount).toBe(1);

    if (!resolveRun) throw new Error('Expected dev run request');
    const completeRun = resolveRun;
    act(() => {
      completeRun(jsonResponse({workflow_run_id: RUN_ID, commit: COMMIT}, {status: 201}));
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  test('keeps the optimistic dev run out of synced-only and definition-scoped lists', async () => {
    let resolveRun: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const atRefResponse = atRefResponseIfRequested(input);
      if (atRefResponse) return Promise.resolve(atRefResponse);
      return new Promise<Response>((resolve) => {
        resolveRun = resolve;
      });
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    const {result, queryClient} = renderWithQueryClient(() => useCreateDevRunMutation());
    queryClient.setQueryData(definitionsAtRefQueryKeys.atRef(PROJECT_ID, REF), atRefListing());
    const allListKey = workflowRunsQueryKeys.list(PROJECT_ID, {});
    const syncedListKey = workflowRunsQueryKeys.list(PROJECT_ID, {origin: 'synced'});
    const definitionListKey = workflowRunsQueryKeys.list(PROJECT_ID, {
      definitionId: '55555555-5555-4555-8555-555555555555',
    });
    seedRunList(queryClient, allListKey);
    seedRunList(queryClient, syncedListKey);
    seedRunList(queryClient, definitionListKey);

    act(() => {
      result.current.mutate({
        projectId: PROJECT_ID,
        ref: REF,
        commit: COMMIT,
        configPath: CONFIG_PATH,
        trigger: 'on_issue',
      });
    });

    await waitFor(() => {
      const allCached =
        queryClient.getQueryData<InfiniteData<WorkflowRunListPage, string | undefined>>(allListKey);
      expect(allCached?.pages[0]?.runs[0]).toMatchObject({origin: 'dev', status: 'pending'});
    });
    const syncedCached =
      queryClient.getQueryData<InfiniteData<WorkflowRunListPage, string | undefined>>(
        syncedListKey,
      );
    expect(syncedCached?.pages[0]?.runs).toHaveLength(0);
    expect(syncedCached?.pages[0]?.filteredTotalCount).toBe(0);
    const definitionCached =
      queryClient.getQueryData<InfiniteData<WorkflowRunListPage, string | undefined>>(
        definitionListKey,
      );
    expect(definitionCached?.pages[0]?.runs).toHaveLength(0);
    expect(definitionCached?.pages[0]?.filteredTotalCount).toBe(0);

    if (!resolveRun) throw new Error('Expected dev run request');
    const completeRun = resolveRun;
    act(() => {
      completeRun(jsonResponse({workflow_run_id: RUN_ID, commit: COMMIT}, {status: 201}));
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  test('only inserts pending dev runs into compatible list filters', async () => {
    let resolveRun: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const atRefResponse = atRefResponseIfRequested(input);
      if (atRefResponse) return Promise.resolve(atRefResponse);
      return new Promise<Response>((resolve) => {
        resolveRun = resolve;
      });
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    const {result, queryClient} = renderWithQueryClient(() => useCreateDevRunMutation());
    queryClient.setQueryData(definitionsAtRefQueryKeys.atRef(PROJECT_ID, REF), atRefListing());

    const acceptedKey = workflowRunsQueryKeys.list(PROJECT_ID, {triggerSource: 'cron'});
    const statusKey = workflowRunsQueryKeys.list(PROJECT_ID, {status: 'running'});
    const sourceKey = workflowRunsQueryKeys.list(PROJECT_ID, {triggerSource: 'manual'});
    const futureKey = workflowRunsQueryKeys.list(PROJECT_ID, {
      createdFrom: '2999-01-01T00:00:00.000Z',
    });
    const pastKey = workflowRunsQueryKeys.list(PROJECT_ID, {
      createdTo: '2000-01-01T00:00:00.000Z',
    });
    for (const key of [acceptedKey, statusKey, sourceKey, futureKey, pastKey]) {
      seedRunList(queryClient, key);
    }

    act(() => {
      result.current.mutate({
        projectId: PROJECT_ID,
        ref: REF,
        commit: COMMIT,
        configPath: CONFIG_PATH,
        trigger: 'on_issue',
      });
    });

    await waitFor(() => {
      const accepted = queryClient.getQueryData<InfiniteData<WorkflowRunListPage>>(acceptedKey);
      expect(accepted?.pages[0]?.runs).toHaveLength(1);
    });
    for (const key of [statusKey, sourceKey, futureKey, pastKey]) {
      const cached = queryClient.getQueryData<InfiniteData<WorkflowRunListPage>>(key);
      expect(cached?.pages[0]?.runs).toHaveLength(0);
      expect(cached?.pages[0]?.filteredTotalCount).toBe(0);
    }

    if (!resolveRun) throw new Error('Expected dev run request');
    act(() => {
      resolveRun?.(jsonResponse({workflow_run_id: RUN_ID, commit: COMMIT}, {status: 201}));
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  test('keeps replay provenance for an integration trigger without a declared event', async () => {
    let resolveRun: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const atRefResponse = atRefResponseIfRequested(input, {
        triggers: {on_issue: {source: 'integration'}},
      });
      if (atRefResponse) return Promise.resolve(atRefResponse);
      return new Promise<Response>((resolve) => {
        resolveRun = resolve;
      });
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    const {result, queryClient} = renderWithQueryClient(() => useCreateDevRunMutation());
    queryClient.setQueryData(
      definitionsAtRefQueryKeys.atRef(PROJECT_ID, REF),
      atRefListing({triggers: {on_issue: {source: 'integration'}}}),
    );
    const allListKey = workflowRunsQueryKeys.list(PROJECT_ID, {});
    seedRunList(queryClient, allListKey);

    act(() => {
      result.current.mutate({
        projectId: PROJECT_ID,
        ref: REF,
        commit: COMMIT,
        configPath: CONFIG_PATH,
        trigger: 'on_issue',
        replayEventId: REPLAY_EVENT_ID,
        replayEvent: {event: 'issue.created'},
      });
    });

    await waitFor(() => {
      const cached = queryClient.getQueryData<InfiniteData<WorkflowRunListPage>>(allListKey);
      expect(cached?.pages[0]?.runs[0]).toMatchObject({
        triggerSource: 'integration',
        triggerEvent: 'issue.created',
        triggerDisplayLabel: 'issue.created',
        triggerLabel: 'integration · issue.created',
        devSource: {replayOfEventId: REPLAY_EVENT_ID},
      });
    });

    if (!resolveRun) throw new Error('Expected dev run request');
    act(() => {
      resolveRun?.(jsonResponse({workflow_run_id: RUN_ID, commit: COMMIT}, {status: 201}));
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  test('does not create a guessed optimistic row when the at-ref cache is cold', async () => {
    let resolveRun: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveRun = resolve;
        }),
    );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    const {result, queryClient} = renderWithQueryClient(() => useCreateDevRunMutation());
    const allListKey = workflowRunsQueryKeys.list(PROJECT_ID, {});
    seedRunList(queryClient, allListKey);

    act(() => {
      result.current.mutate({
        projectId: PROJECT_ID,
        ref: REF,
        commit: COMMIT,
        configPath: CONFIG_PATH,
        trigger: 'on_issue',
      });
    });

    await waitFor(() => {
      const cached =
        queryClient.getQueryData<InfiniteData<WorkflowRunListPage, string | undefined>>(allListKey);
      expect(cached?.pages[0]?.runs).toHaveLength(0);
    });

    if (!resolveRun) throw new Error('Expected dev run request');
    const completeRun = resolveRun;
    act(() => {
      completeRun(jsonResponse({workflow_run_id: RUN_ID, commit: COMMIT}, {status: 201}));
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  test('refreshes a cached at-ref listing before creating a run', async () => {
    const requestPaths: string[] = [];
    const postBodies: unknown[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      requestPaths.push(new URL(request.url).pathname);
      const atRefResponse = atRefResponseIfRequested(input, {commit: FRESH_COMMIT});
      if (atRefResponse) return atRefResponse;
      postBodies.push(await request.clone().json());
      return jsonResponse({workflow_run_id: RUN_ID, commit: COMMIT}, {status: 201});
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    const {result, queryClient} = renderWithQueryClient(() => useCreateDevRunMutation());
    queryClient.setQueryData(definitionsAtRefQueryKeys.atRef(PROJECT_ID, REF), atRefListing());

    const allListKey = workflowRunsQueryKeys.list(PROJECT_ID, {});
    seedRunList(queryClient, allListKey);

    await act(async () => {
      await result.current.mutateAsync({
        projectId: PROJECT_ID,
        ref: REF,
        commit: COMMIT,
        configPath: CONFIG_PATH,
        trigger: 'on_issue',
      });
    });

    expect(requestPaths).toEqual(['/definitions/at-ref', '/dev-runs']);
    expect(postBodies).toEqual([
      {
        project_id: PROJECT_ID,
        ref: REF,
        commit: COMMIT,
        config_path: CONFIG_PATH,
        trigger: 'on_issue',
      },
    ]);
    const cached = queryClient.getQueryData<InfiniteData<WorkflowRunListPage>>(allListKey);
    expect(cached?.pages[0]?.runs).toHaveLength(0);
  });

  test('continues without an optimistic row when the at-ref refresh fails', async () => {
    const requestPaths: string[] = [];
    const postBodies: unknown[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      const path = new URL(request.url).pathname;
      requestPaths.push(path);
      if (path === '/definitions/at-ref') {
        return jsonResponse(
          {code: 'source-unavailable', message: 'Temporary source-control failure'},
          {status: 502},
        );
      }

      postBodies.push(await request.clone().json());
      return jsonResponse({workflow_run_id: RUN_ID, commit: COMMIT}, {status: 201});
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    const {result, queryClient} = renderWithQueryClient(() => useCreateDevRunMutation());
    queryClient.setQueryData(definitionsAtRefQueryKeys.atRef(PROJECT_ID, REF), atRefListing());

    const allListKey = workflowRunsQueryKeys.list(PROJECT_ID, {});
    seedRunList(queryClient, allListKey);

    await act(async () => {
      await result.current.mutateAsync({
        projectId: PROJECT_ID,
        ref: REF,
        commit: COMMIT,
        configPath: CONFIG_PATH,
        trigger: 'on_issue',
      });
    });

    expect(requestPaths).toEqual(['/definitions/at-ref', '/dev-runs']);
    expect(postBodies).toEqual([
      {
        project_id: PROJECT_ID,
        ref: REF,
        commit: COMMIT,
        config_path: CONFIG_PATH,
        trigger: 'on_issue',
      },
    ]);
    const cached = queryClient.getQueryData<InfiniteData<WorkflowRunListPage>>(allListKey);
    expect(cached?.pages[0]?.runs).toHaveLength(0);
  });

  test('invalidates the project run lists on success', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({workflow_run_id: RUN_ID, commit: COMMIT}, {status: 201}),
    );
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    const {result, queryClient} = renderWithQueryClient(() => useCreateDevRunMutation());
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync({
        projectId: PROJECT_ID,
        ref: REF,
        commit: COMMIT,
        configPath: CONFIG_PATH,
        trigger: 'on_issue',
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: workflowRunsQueryKeys.lists(PROJECT_ID),
    });
  });

  test('removes the optimistic dev run on failure and keeps newer rows', async () => {
    const runRequests: Array<{resolve: (response: Response) => void}> = [];
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const atRefResponse = atRefResponseIfRequested(input);
      if (atRefResponse) return Promise.resolve(atRefResponse);
      return new Promise<Response>((resolve) => {
        runRequests.push({resolve});
      });
    });
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    const {result, queryClient} = renderWithQueryClient(() => useCreateDevRunMutation());
    queryClient.setQueryData(definitionsAtRefQueryKeys.atRef(PROJECT_ID, REF), atRefListing());
    const allListKey = workflowRunsQueryKeys.list(PROJECT_ID, {});
    seedRunList(queryClient, allListKey);

    act(() => {
      result.current.mutate({
        projectId: PROJECT_ID,
        ref: REF,
        commit: COMMIT,
        configPath: CONFIG_PATH,
        trigger: 'on_issue',
      });
    });
    await waitFor(() => expect(runRequests).toHaveLength(1));
    const firstRun = runRequests[0];
    if (!firstRun) throw new Error('Expected first dev run request');

    act(() => {
      result.current.mutate({
        projectId: PROJECT_ID,
        ref: REF,
        commit: COMMIT,
        configPath: CONFIG_PATH,
        trigger: 'on_issue',
      });
    });
    await waitFor(() => expect(runRequests).toHaveLength(2));
    const secondRun = runRequests[1];
    if (!secondRun) throw new Error('Expected second dev run request');

    let secondTempWorkflowRunId: string | undefined;
    await waitFor(() => {
      const cached =
        queryClient.getQueryData<InfiniteData<WorkflowRunListPage, string | undefined>>(allListKey);
      expect(cached?.pages[0]?.runs).toHaveLength(2);
      expect(cached?.pages[0]?.filteredTotalCount).toBe(2);
      secondTempWorkflowRunId = cached?.pages[0]?.runs[0]?.id;
      expect(secondTempWorkflowRunId).toMatch(TEMP_RUN_ID_PATTERN);
    });

    act(() => {
      firstRun.resolve(jsonResponse({code: 'server-error'}, {status: 500}));
    });

    await waitFor(() => {
      const cached =
        queryClient.getQueryData<InfiniteData<WorkflowRunListPage, string | undefined>>(allListKey);
      expect(cached?.pages[0]?.runs.map((run) => run.id)).toEqual([secondTempWorkflowRunId]);
      expect(cached?.pages[0]?.filteredTotalCount).toBe(1);
    });

    act(() => {
      secondRun.resolve(jsonResponse({workflow_run_id: RUN_ID, commit: COMMIT}, {status: 201}));
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
