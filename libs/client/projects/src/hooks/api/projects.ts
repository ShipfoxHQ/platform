import {
  createProjectBodySchema,
  listProjectsResponseSchema,
  projectResponseSchema,
  updateProjectBodySchema,
} from '@shipfox/api-projects-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {
  type InfiniteData,
  keepPreviousData,
  type QueryClient,
  queryOptions,
  type UseInfiniteQueryOptions,
  type UseQueryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {useCallback} from 'react';
import type {
  CreateProjectCommand,
  Project,
  ProjectList,
  UpdateProjectCommand,
} from '#core/project.js';
import {toProject, toProjectList} from './mappers.js';

const PROJECT_LIST_STALE_TIME = 30_000;

export const projectsQueryKeys = {
  all: ['projects'] as const,
  list: (workspaceId: string, search = '') =>
    [...projectsQueryKeys.all, 'list', workspaceId, search] as const,
  slug: (workspaceId: string, projectSlug: string) =>
    [...projectsQueryKeys.all, 'slug', workspaceId, projectSlug] as const,
  exists: (workspaceId: string) => [...projectsQueryKeys.all, 'exists', workspaceId] as const,
  detail: (projectId: string) => [...projectsQueryKeys.all, 'detail', projectId] as const,
};

type ProjectListQueryKey =
  | ReturnType<typeof projectsQueryKeys.list>
  | readonly ['projects', 'list'];
type ProjectExistenceQueryKey =
  | ReturnType<typeof projectsQueryKeys.exists>
  | readonly ['projects', 'exists'];
type ProjectSlugQueryKey =
  | ReturnType<typeof projectsQueryKeys.slug>
  | readonly ['projects', 'slug'];
type ProjectDetailQueryKey =
  | ReturnType<typeof projectsQueryKeys.detail>
  | readonly ['projects', 'detail'];

type ProjectListInfiniteQueryOptions = UseInfiniteQueryOptions<
  ProjectList,
  Error,
  InfiniteData<ProjectList, string | undefined>,
  ProjectListQueryKey,
  string | undefined
>;
type ProjectExistenceQueryOptions = UseQueryOptions<
  ProjectList,
  Error,
  ProjectList,
  ProjectExistenceQueryKey
>;
type ProjectSlugQueryOptions = UseQueryOptions<
  Project | null,
  Error,
  Project | null,
  ProjectSlugQueryKey
>;
type ProjectDetailQueryOptions = UseQueryOptions<Project, Error, Project, ProjectDetailQueryKey>;

export async function listProjects({
  workspaceId,
  limit = 50,
  cursor,
  search,
  signal,
}: {
  workspaceId: string;
  limit?: number;
  cursor?: string | undefined;
  search?: string | undefined;
  signal?: AbortSignal | undefined;
}): Promise<ProjectList> {
  const params = new URLSearchParams({workspace_id: workspaceId, limit: String(limit)});
  if (cursor) params.set('cursor', cursor);
  if (search) params.set('search', search);
  return toProjectList(
    await checkedApiRequest(listProjectsResponseSchema, `/projects?${params.toString()}`, {signal}),
  );
}

export async function resolveProjectSlug({
  queryClient,
  workspaceId,
  projectSlug,
}: {
  queryClient: QueryClient;
  workspaceId: string;
  projectSlug: string;
}): Promise<string | undefined> {
  const queryKey = projectsQueryKeys.list(workspaceId);
  let data = queryClient.getQueryData<InfiniteData<ProjectList, string | undefined>>(queryKey);

  if (!data) {
    await queryClient.fetchInfiniteQuery(projectsInfiniteQueryOptions(workspaceId));
    data = queryClient.getQueryData<InfiniteData<ProjectList, string | undefined>>(queryKey);
  }

  if (data) {
    const project = data.pages
      .flatMap((page) => page.projects)
      .find((candidate) => candidate.slug === projectSlug);
    const dataUpdatedAt = queryClient.getQueryState(queryKey)?.dataUpdatedAt ?? 0;
    if (project && Date.now() - dataUpdatedAt < PROJECT_LIST_STALE_TIME) {
      cacheResolvedProject(queryClient, workspaceId, projectSlug, project);
      return project.id;
    }
    const cursor = data.pages.at(-1)?.nextCursor;
    if (project || !cursor) {
      return await refetchAndResolveProjectSlug(queryClient, queryKey, workspaceId, projectSlug);
    }
    return await resolveProjectSlugBySearch(queryClient, workspaceId, projectSlug);
  }

  return undefined;
}

async function refetchAndResolveProjectSlug(
  queryClient: QueryClient,
  queryKey: ReturnType<typeof projectsQueryKeys.list>,
  workspaceId: string,
  projectSlug: string,
): Promise<string | undefined> {
  await queryClient.refetchQueries({queryKey, type: 'all'});
  const data = queryClient.getQueryData<InfiniteData<ProjectList, string | undefined>>(queryKey);

  if (!data) return undefined;
  const project = data.pages
    .flatMap((page) => page.projects)
    .find((candidate) => candidate.slug === projectSlug);
  if (project) {
    cacheResolvedProject(queryClient, workspaceId, projectSlug, project);
    return project.id;
  }

  if (!data.pages.at(-1)?.nextCursor) return undefined;
  return await resolveProjectSlugBySearch(queryClient, workspaceId, projectSlug);
}

function cacheResolvedProject(
  queryClient: QueryClient,
  workspaceId: string,
  projectSlug: string,
  project: Project,
): void {
  queryClient.setQueryData(projectsQueryKeys.slug(workspaceId, projectSlug), project);
  queryClient.setQueryData(projectsQueryKeys.detail(project.id), project);
}

async function resolveProjectSlugBySearch(
  queryClient: QueryClient,
  workspaceId: string,
  projectSlug: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  const project = await findProjectBySlug({workspaceId, projectSlug, signal});
  if (project) {
    cacheResolvedProject(queryClient, workspaceId, projectSlug, project);
    return project.id;
  }
  return undefined;
}

async function findProjectBySlug({
  workspaceId,
  projectSlug,
  signal,
}: {
  workspaceId: string;
  projectSlug: string;
  signal?: AbortSignal | undefined;
}): Promise<Project | undefined> {
  let result = await listProjects({workspaceId, search: projectSlug, limit: 100, signal});
  while (true) {
    const project = result.projects.find((candidate) => candidate.slug === projectSlug);
    if (project) return project;
    if (!result.nextCursor) return undefined;
    result = await listProjects({
      workspaceId,
      search: projectSlug,
      limit: 100,
      cursor: result.nextCursor,
      signal,
    });
  }
}

export async function getProject(projectId: string): Promise<Project> {
  return toProject(await checkedApiRequest(projectResponseSchema, `/projects/${projectId}`));
}

export async function createProject(command: CreateProjectCommand): Promise<Project> {
  const body = createProjectBodySchema.parse({
    workspace_id: command.workspaceId,
    name: command.name,
    slug: command.slug,
    source: {
      connection_id: command.source.connectionId,
      external_repository_id: command.source.externalRepositoryId,
    },
  });
  return toProject(
    await checkedApiRequest(projectResponseSchema, '/projects', {method: 'POST', body}),
  );
}

export async function updateProject(command: UpdateProjectCommand): Promise<Project> {
  const body = updateProjectBodySchema.parse({name: command.name, slug: command.slug});
  return toProject(
    await checkedApiRequest(projectResponseSchema, `/projects/${command.projectId}`, {
      method: 'PATCH',
      body,
    }),
  );
}

export function isProjectSlugAvailable({
  queryClient,
  workspaceId,
  projectSlug,
  currentProjectId,
}: {
  queryClient: QueryClient;
  workspaceId: string;
  projectSlug: string;
  currentProjectId?: string | undefined;
}): boolean {
  const cachedLists = queryClient.getQueriesData<InfiniteData<ProjectList, string | undefined>>({
    queryKey: [...projectsQueryKeys.all, 'list', workspaceId],
  });
  const conflict = cachedLists
    .flatMap(([, data]) => data?.pages.flatMap((page) => page.projects) ?? [])
    .some((project) => project.slug === projectSlug && project.id !== currentProjectId);
  return !conflict;
}

export function useProjectSlugAvailability(
  workspaceId: string | undefined,
  currentProjectId?: string,
): (projectSlug: string) => Promise<boolean> {
  const queryClient = useQueryClient();
  return useCallback(
    async (projectSlug: string) => {
      if (!workspaceId) return false;
      if (!isProjectSlugAvailable({queryClient, workspaceId, projectSlug, currentProjectId})) {
        return false;
      }
      const project = await findProjectBySlug({workspaceId, projectSlug});
      return project === undefined || project.id === currentProjectId;
    },
    [currentProjectId, queryClient, workspaceId],
  );
}

export function projectsInfiniteQueryOptions(
  workspaceId: string | undefined,
  search?: string,
  limit = 50,
): ProjectListInfiniteQueryOptions {
  const normalizedSearch = search?.trim() ?? '';
  return {
    queryKey: workspaceId
      ? projectsQueryKeys.list(workspaceId, normalizedSearch)
      : ([...projectsQueryKeys.all, 'list'] as const),
    enabled: Boolean(workspaceId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam, signal}: {pageParam: string | undefined; signal: AbortSignal}) =>
      listProjects({
        workspaceId: workspaceId ?? '',
        limit,
        cursor: pageParam,
        search: normalizedSearch || undefined,
        signal,
      }),
    getNextPageParam: (lastPage: ProjectList) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    staleTime: PROJECT_LIST_STALE_TIME,
  };
}

export function projectExistenceQueryOptions(
  workspaceId: string | undefined,
): ProjectExistenceQueryOptions {
  return queryOptions({
    queryKey: workspaceId
      ? projectsQueryKeys.exists(workspaceId)
      : ([...projectsQueryKeys.all, 'exists'] as const),
    enabled: Boolean(workspaceId),
    queryFn: ({signal}) => listProjects({workspaceId: workspaceId ?? '', limit: 1, signal}),
    staleTime: 30_000,
  });
}

export function projectQueryOptions(projectId: string | undefined): ProjectDetailQueryOptions {
  return queryOptions({
    queryKey: projectId
      ? projectsQueryKeys.detail(projectId)
      : ([...projectsQueryKeys.all, 'detail'] as const),
    enabled: Boolean(projectId),
    queryFn: () => getProject(projectId ?? ''),
  });
}

export function projectSlugQueryOptions(
  workspaceId: string | undefined,
  projectSlug: string | undefined,
): ProjectSlugQueryOptions {
  return queryOptions({
    queryKey:
      workspaceId && projectSlug
        ? projectsQueryKeys.slug(workspaceId, projectSlug)
        : ([...projectsQueryKeys.all, 'slug'] as const),
    enabled: Boolean(workspaceId && projectSlug),
    queryFn: async ({signal, client}) => {
      const resolvedWorkspaceId = workspaceId ?? '';
      const resolvedProjectSlug = projectSlug ?? '';
      const project = await findProjectBySlug({
        workspaceId: resolvedWorkspaceId,
        projectSlug: resolvedProjectSlug,
        signal,
      });
      if (project) {
        cacheResolvedProject(client, resolvedWorkspaceId, resolvedProjectSlug, project);
      }
      return project ?? null;
    },
    staleTime: 30_000,
  });
}

export function useProjectsInfiniteQuery(
  workspaceId: string | undefined,
  search?: string,
  limit = 50,
) {
  return useInfiniteQuery(projectsInfiniteQueryOptions(workspaceId, search, limit));
}
export function useProjectQuery(projectId: string | undefined) {
  return useQuery(projectQueryOptions(projectId));
}
export function useProjectSlugQuery(
  workspaceId: string | undefined,
  projectSlug: string | undefined,
) {
  return useQuery(projectSlugQueryOptions(workspaceId, projectSlug));
}
export function useCreateProjectMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createProject,
    onSuccess: async (project) => {
      queryClient.setQueryData(projectsQueryKeys.detail(project.id), project);
      queryClient.setQueryData<ProjectList>(projectsQueryKeys.exists(project.workspaceId), {
        projects: [project],
        nextCursor: null,
      });
      await queryClient.invalidateQueries({queryKey: projectsQueryKeys.list(project.workspaceId)});
    },
    onError: async (_error, command) => {
      await queryClient.invalidateQueries({
        queryKey: projectsQueryKeys.exists(command.workspaceId),
        refetchType: 'active',
      });
      await queryClient.invalidateQueries({queryKey: projectsQueryKeys.list(command.workspaceId)});
    },
  });
}

export function useUpdateProjectMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateProject,
    onSuccess: async (project) => {
      queryClient.setQueryData(projectsQueryKeys.detail(project.id), project);
      queryClient.setQueryData(projectsQueryKeys.slug(project.workspaceId, project.slug), project);
      await queryClient.invalidateQueries({
        queryKey: [...projectsQueryKeys.all, 'slug', project.workspaceId],
      });
      await queryClient.invalidateQueries({queryKey: projectsQueryKeys.list(project.workspaceId)});
    },
  });
}
