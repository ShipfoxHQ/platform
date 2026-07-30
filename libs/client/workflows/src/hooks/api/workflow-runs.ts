import {
  type RerunWorkflowRunBodyDto,
  type WorkflowRunRerunModeDto,
  workflowRunAttemptsResponseSchema,
  workflowRunDetailResponseSchema,
  workflowRunDtoSchema,
  workflowRunListResponseSchema,
  workflowRunResponseSchema,
} from '@shipfox/api-workflows-dto';
import {checkedApiRequest, type StandardSchema} from '@shipfox/client-api';
import {
  type InfiniteData,
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
  type UseInfiniteQueryOptions,
  type UseQueryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  isWorkflowRunTerminal,
  type ManualWorkflowLaunch,
  type WorkflowRun,
  type WorkflowRunAttempt,
  WorkflowRunAttemptSummary,
  type WorkflowRunDetail,
  type WorkflowRunListItem,
  type WorkflowRunListPage,
  type WorkflowRunStatus,
} from '#core/workflow-run.js';
import {
  toWorkflowRunAttempt,
  toWorkflowRunDetail,
  toWorkflowRunListItem,
  toWorkflowRunListPage,
} from './workflow-run-mapper.js';

export interface WorkflowRunFilters {
  status?: WorkflowRunStatus | undefined;
  definitionId?: string | undefined;
  triggerSource?: string | undefined;
  createdFrom?: string | undefined;
  createdTo?: string | undefined;
}

export const workflowRunsQueryKeys = {
  all: ['workflow-runs'] as const,
  lists: (projectId: string) => [...workflowRunsQueryKeys.all, 'list', projectId] as const,
  list: (projectId: string, filters: WorkflowRunFilters) =>
    [...workflowRunsQueryKeys.lists(projectId), normalizeFilters(filters)] as const,
  detail: (workflowRunId: string, runAttempt?: number | undefined) =>
    [...workflowRunsQueryKeys.all, 'detail', workflowRunId, runAttempt ?? null] as const,
  attempts: (workflowRunId: string) =>
    [...workflowRunsQueryKeys.all, 'attempts', workflowRunId] as const,
};

type WorkflowRunsListQueryKey =
  | ReturnType<typeof workflowRunsQueryKeys.list>
  | readonly ['workflow-runs', 'list'];
type WorkflowRunDetailQueryKey =
  | ReturnType<typeof workflowRunsQueryKeys.detail>
  | readonly ['workflow-runs', 'detail'];
type WorkflowRunAttemptsQueryKey =
  | ReturnType<typeof workflowRunsQueryKeys.attempts>
  | readonly ['workflow-runs', 'attempts'];
type WorkflowRunsInfiniteQueryOptions = UseInfiniteQueryOptions<
  WorkflowRunListPage,
  Error,
  InfiniteData<WorkflowRunListPage, string | undefined>,
  WorkflowRunsListQueryKey,
  string | undefined
>;
type WorkflowRunDetailQueryOptions = UseQueryOptions<
  WorkflowRunDetail,
  Error,
  WorkflowRunDetail,
  WorkflowRunDetailQueryKey
>;
type WorkflowRunAttemptsQueryOptions = UseQueryOptions<
  WorkflowRunAttempt[],
  Error,
  WorkflowRunAttempt[],
  WorkflowRunAttemptsQueryKey
>;

function normalizeFilters(filters: WorkflowRunFilters) {
  return {
    status: filters.status ?? null,
    definitionId: filters.definitionId ?? null,
    triggerSource: filters.triggerSource ?? null,
    createdFrom: filters.createdFrom ?? null,
    createdTo: filters.createdTo ?? null,
  };
}

function appendFilters(params: URLSearchParams, filters: WorkflowRunFilters) {
  if (filters.status) params.set('status', filters.status);
  if (filters.definitionId) params.set('definition_id', filters.definitionId);
  if (filters.triggerSource) params.set('trigger_source', filters.triggerSource);
  if (filters.createdFrom) params.set('created_from', filters.createdFrom);
  if (filters.createdTo) params.set('created_to', filters.createdTo);
}

async function listWorkflowRuns({
  projectId,
  filters,
  limit = 50,
  cursor,
  signal,
}: {
  projectId: string;
  filters: WorkflowRunFilters;
  limit?: number;
  cursor?: string | undefined;
  signal?: AbortSignal;
}): Promise<WorkflowRunListPage> {
  const params = new URLSearchParams({project_id: projectId, limit: String(limit)});
  if (cursor) params.set('cursor', cursor);
  appendFilters(params, filters);
  const response = await checkedApiRequest(
    workflowRunListResponseSchema,
    `/workflows/runs?${params.toString()}`,
    {signal},
  );
  return toWorkflowRunListPage(response);
}

/**
 * Fire the manual trigger of a workflow definition.
 *
 * The server resolves the manual subscription by definition id (workflows
 * may declare at most one manual trigger). `inputs` are forwarded to the
 * run when provided.
 */
export async function fireManualWorkflow({
  definitionId,
  inputs,
}: {
  definitionId: string;
  inputs?: Record<string, unknown>;
}): Promise<ManualWorkflowLaunch> {
  const response = await checkedApiRequest(
    manualWorkflowResponseSchema,
    `/workflow-definitions/${definitionId}/fire-manual`,
    {
      method: 'POST',
      body: inputs ? {inputs} : {},
    },
  );
  return {workflowRunId: response.workflow_run_id};
}

const ACTIVE_POLL_MS = 4_000;
const IDLE_POLL_MS = 30_000;

type RunListInfinite = InfiniteData<WorkflowRunListPage, string | undefined>;

export function useWorkflowRunsInfiniteQuery(
  projectId: string | undefined,
  filters: WorkflowRunFilters,
  limit = 50,
) {
  return useInfiniteQuery(workflowRunsInfiniteQueryOptions(projectId, filters, limit));
}

export function workflowRunsInfiniteQueryOptions(
  projectId: string | undefined,
  filters: WorkflowRunFilters,
  limit = 50,
): WorkflowRunsInfiniteQueryOptions {
  // Polling is owned by react-query, not the page. Polling fast (4s) while
  // any non-terminal run is visible covers state transitions; polling slow
  // (30s) when idle covers brand-new external runs (webhook/schedule
  // triggers) without leaving the list stale.
  //
  // We disable polling once the user has loaded more than one page. With
  // cursor pagination the cursor that bounds page 1 was computed from
  // page 0's last row; if a refetch shifts that boundary, a small range
  // of rows can drop into a between-pages gap. Users who scrolled into
  // history opted into "reading mode": pause until they refocus, filter,
  // or scroll back.
  return infiniteQueryOptions({
    queryKey: projectId
      ? workflowRunsQueryKeys.list(projectId, filters)
      : ([...workflowRunsQueryKeys.all, 'list'] as const),
    enabled: Boolean(projectId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam, signal}) =>
      listWorkflowRuns({projectId: projectId ?? '', filters, limit, cursor: pageParam, signal}),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    staleTime: 2_000,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data || data.pages.length > 1) return false;
      const hasActive = data.pages.some((page) =>
        page.runs.some((run) => !isWorkflowRunTerminal(run.status)),
      );
      return hasActive ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    },
    refetchIntervalInBackground: false,
  });
}

async function getWorkflowRun({
  workflowRunId,
  runAttempt,
  signal,
}: {
  workflowRunId: string;
  runAttempt?: number | undefined;
  signal?: AbortSignal;
}): Promise<WorkflowRunDetail> {
  const params = new URLSearchParams();
  if (runAttempt) params.set('attempt', String(runAttempt));
  const query = params.size > 0 ? `?${params.toString()}` : '';
  return toWorkflowRunDetail(
    await checkedApiRequest(
      workflowRunDetailResponseSchema,
      `/workflows/runs/${workflowRunId}${query}`,
      {
        signal,
      },
    ),
  );
}

async function getWorkflowRunAttempts({
  workflowRunId,
  signal,
}: {
  workflowRunId: string;
  signal?: AbortSignal;
}): Promise<WorkflowRunAttempt[]> {
  const response = await checkedApiRequest(
    workflowRunAttemptsResponseSchema,
    `/workflows/runs/${workflowRunId}/attempts`,
    {
      signal,
    },
  );
  return response.attempts.map(toWorkflowRunAttempt);
}

async function cancelWorkflowRun({
  workflowRunId,
}: {
  workflowRunId: string;
}): Promise<WorkflowRunListItem> {
  return toWorkflowRunListItem(
    await checkedApiRequest(workflowRunDtoSchema, `/workflows/runs/${workflowRunId}/cancel`, {
      method: 'POST',
    }),
  );
}

export async function rerunWorkflowRun({
  workflowRunId,
  mode,
}: {
  workflowRunId: string;
  mode: WorkflowRunRerunModeDto;
}): Promise<WorkflowRunListItem> {
  return toWorkflowRunListItem(
    await checkedApiRequest(workflowRunResponseSchema, `/workflows/runs/${workflowRunId}/rerun`, {
      method: 'POST',
      body: {mode} satisfies RerunWorkflowRunBodyDto,
    }),
  );
}

const manualWorkflowResponseSchema: StandardSchema<unknown, {workflow_run_id: string}> = {
  '~standard': {
    version: 1,
    vendor: 'client-workflows',
    validate: (value) => {
      if (
        typeof value === 'object' &&
        value !== null &&
        'workflow_run_id' in value &&
        typeof value.workflow_run_id === 'string'
      )
        return {value: {workflow_run_id: value.workflow_run_id}};
      return {issues: [{message: 'Expected workflow_run_id.'}]};
    },
  },
};

export function useRerunWorkflowRunMutation(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: rerunWorkflowRun,
    onSuccess: async (_run, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({queryKey: workflowRunsQueryKeys.lists(projectId)}),
        queryClient.invalidateQueries({
          queryKey: workflowRunsQueryKeys.detail(variables.workflowRunId),
        }),
        queryClient.invalidateQueries({
          queryKey: workflowRunsQueryKeys.attempts(variables.workflowRunId),
        }),
      ]);
    },
  });
}

function filtersAcceptManualPendingRun(
  filters: WorkflowRunFilters,
  definitionId: string,
  now: Date,
): boolean {
  if (filters.status && filters.status !== 'pending') return false;
  if (filters.definitionId && filters.definitionId !== definitionId) return false;
  if (filters.triggerSource && filters.triggerSource !== 'manual') return false;
  if (filters.createdFrom && Date.parse(filters.createdFrom) > now.getTime()) return false;
  if (filters.createdTo && Date.parse(filters.createdTo) < now.getTime()) return false;
  return true;
}

function buildTempRun({
  projectId,
  definitionId,
  name,
  createdAt,
}: {
  projectId: string;
  definitionId: string;
  name: string;
  createdAt: string;
}): WorkflowRunListItem {
  const id = `temp-${cryptoRandomId()}`;
  return {
    id,
    projectId,
    definitionId,
    name,
    status: 'pending',
    currentAttempt: 1,
    latestAttempt: 1,
    triggerProvider: null,
    triggerSource: 'manual',
    triggerEvent: 'fire',
    triggerPayload: {source: 'manual', event: 'fire'},
    triggerDisplayLabel: 'fire',
    triggerLabel: 'manual · fire',
    inputs: null,
    sourceSnapshot: null,
    createdAt,
    updatedAt: createdAt,
    shortId: id.slice(0, 8),
    isTemporary: true,
    runAttempt: new WorkflowRunAttemptSummary({
      workflowRunId: id,
      attempt: 1,
      status: 'pending',
      createdAt,
      startedAt: null,
      finishedAt: null,
    }),
  };
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface FireManualWorkflowVariables {
  projectId: string;
  definitionId: string;
  inputs?: Record<string, unknown>;
}

export function useFireManualWorkflowMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: FireManualWorkflowVariables) =>
      fireManualWorkflow(
        variables.inputs
          ? {definitionId: variables.definitionId, inputs: variables.inputs}
          : {definitionId: variables.definitionId},
      ),
    onMutate: (variables) => {
      const definitionName = lookupDefinitionName(
        queryClient,
        variables.projectId,
        variables.definitionId,
      );
      const createdAt = new Date().toISOString();
      const tempRun = buildTempRun({
        projectId: variables.projectId,
        definitionId: variables.definitionId,
        name: definitionName ?? 'New run',
        createdAt,
      });

      const listsKey = workflowRunsQueryKeys.lists(variables.projectId);
      const touchedQueryKeys: Array<readonly unknown[]> = [];

      const entries = queryClient.getQueriesData<RunListInfinite>({queryKey: listsKey});
      const now = new Date(createdAt);
      for (const [queryKey] of entries) {
        const filters = readFiltersFromKey(queryKey);
        if (!filters) continue;
        if (!filtersAcceptManualPendingRun(filters, variables.definitionId, now)) continue;

        touchedQueryKeys.push(queryKey);
        queryClient.setQueryData<RunListInfinite>(queryKey, (current) => {
          if (!current || current.pages.length === 0) return current;
          const firstPage = current.pages[0];
          if (!firstPage) return current;
          const nextFirstPage: WorkflowRunListPage = {
            ...firstPage,
            runs: [tempRun, ...firstPage.runs],
            filteredTotalCount:
              firstPage.filteredTotalCount != null ? firstPage.filteredTotalCount + 1 : null,
          };
          return {...current, pages: [nextFirstPage, ...current.pages.slice(1)]};
        });
      }

      return {tempWorkflowRunId: tempRun.id, touchedQueryKeys};
    },
    onError: (_error, _variables, context) => {
      if (!context) return;
      for (const queryKey of context.touchedQueryKeys) {
        queryClient.setQueryData<RunListInfinite>(queryKey, (current) => {
          if (!current) return current;
          let removedCount = 0;
          const pages = current.pages.map((page) => {
            const runs = page.runs.filter((run) => {
              if (run.id !== context.tempWorkflowRunId) return true;
              removedCount += 1;
              return false;
            });
            if (runs.length === page.runs.length) return page;
            return {
              ...page,
              runs,
              filteredTotalCount:
                page.filteredTotalCount != null
                  ? Math.max(0, page.filteredTotalCount - removedCount)
                  : null,
            };
          });
          if (removedCount === 0) return current;
          return {...current, pages};
        });
      }
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: workflowRunsQueryKeys.lists(variables.projectId),
      });
    },
  });
}

function readFiltersFromKey(queryKey: readonly unknown[]): WorkflowRunFilters | null {
  if (queryKey.length < 4) return null;
  const normalized = queryKey[3];
  if (!normalized || typeof normalized !== 'object') return null;
  const obj = normalized as Record<string, unknown>;
  return {
    status: (obj.status as WorkflowRunStatus | null) ?? undefined,
    definitionId: (obj.definitionId as string | null) ?? undefined,
    triggerSource: (obj.triggerSource as string | null) ?? undefined,
    createdFrom: (obj.createdFrom as string | null) ?? undefined,
    createdTo: (obj.createdTo as string | null) ?? undefined,
  };
}

function lookupDefinitionName(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
  definitionId: string,
): string | undefined {
  const entries = queryClient.getQueriesData<
    InfiniteData<{definitions: Array<{id: string; name: string}>}>
  >({queryKey: ['definitions', 'list', projectId]});
  for (const [, data] of entries) {
    if (!data) continue;
    for (const page of data.pages) {
      const match = page.definitions.find((d) => d.id === definitionId);
      if (match) return match.name;
    }
  }
  return undefined;
}

export function useWorkflowRunQuery(workflowRunId: string | undefined) {
  return useWorkflowRunAttemptQuery({workflowRunId, runAttempt: undefined});
}

export function useWorkflowRunAttemptQuery({
  workflowRunId,
  runAttempt,
}: {
  workflowRunId: string | undefined;
  runAttempt?: number | undefined;
}) {
  return useQuery(workflowRunQueryOptions({workflowRunId, runAttempt}));
}

export function workflowRunQueryOptions({
  workflowRunId,
  runAttempt,
}: {
  workflowRunId: string | undefined;
  runAttempt?: number | undefined;
}): WorkflowRunDetailQueryOptions {
  // Poll a non-terminal run so the open run detail stays live (same cadence as the run
  // list); stop once the run is terminal.
  return queryOptions({
    queryKey: workflowRunId
      ? workflowRunsQueryKeys.detail(workflowRunId, runAttempt)
      : ([...workflowRunsQueryKeys.all, 'detail'] as const),
    enabled: Boolean(workflowRunId),
    queryFn: ({signal}) => getWorkflowRun({workflowRunId: workflowRunId ?? '', runAttempt, signal}),
    staleTime: 2_000,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const status: WorkflowRunDetail['runAttempt']['status'] | undefined =
        query.state.data?.runAttempt.status;
      if (!status) return false;
      return isWorkflowRunTerminal(status) ? false : ACTIVE_POLL_MS;
    },
    refetchIntervalInBackground: false,
  });
}

export function useWorkflowRunAttemptsQuery({
  workflowRunId,
  enabled,
}: {
  workflowRunId: string | undefined;
  enabled: boolean;
}) {
  return useQuery(workflowRunAttemptsQueryOptions({workflowRunId, enabled}));
}

export function workflowRunAttemptsQueryOptions({
  workflowRunId,
  enabled,
}: {
  workflowRunId: string | undefined;
  enabled: boolean;
}): WorkflowRunAttemptsQueryOptions {
  return queryOptions({
    queryKey: workflowRunId
      ? workflowRunsQueryKeys.attempts(workflowRunId)
      : ([...workflowRunsQueryKeys.all, 'attempts'] as const),
    enabled: Boolean(workflowRunId) && enabled,
    queryFn: ({signal}) => getWorkflowRunAttempts({workflowRunId: workflowRunId ?? '', signal}),
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });
}

export function useCancelWorkflowRunMutation(run: WorkflowRun | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<WorkflowRunListItem> => {
      if (!run) throw new Error('Workflow run is not loaded');
      return await cancelWorkflowRun({workflowRunId: run.id});
    },
    onSuccess: async () => {
      if (!run) return;
      await Promise.all([
        queryClient.invalidateQueries({queryKey: workflowRunsQueryKeys.detail(run.id)}),
        queryClient.invalidateQueries({queryKey: workflowRunsQueryKeys.lists(run.projectId)}),
        queryClient.invalidateQueries({queryKey: workflowRunsQueryKeys.attempts(run.id)}),
      ]);
    },
  });
}
