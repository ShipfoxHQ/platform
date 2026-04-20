import type {
  CreateProjectBodyDto,
  CreateVcsConnectionBodyDto,
  ListProjectsResponseDto,
  ProjectResponseDto,
  VcsConnectionDto,
} from '@shipfox/api-projects-dto';
import {apiRequest} from '@shipfox/client-api';
import {useInfiniteQuery, useMutation, useQuery} from '@tanstack/react-query';

export const projectsQueryKeys = {
  all: ['projects'] as const,
  list: (workspaceId: string) => [...projectsQueryKeys.all, 'list', workspaceId] as const,
  detail: (projectId: string) => [...projectsQueryKeys.all, 'detail', projectId] as const,
};

export async function listProjects({
  workspaceId,
  limit = 50,
  cursor,
  signal,
}: {
  workspaceId: string;
  limit?: number;
  cursor?: string | undefined;
  signal?: AbortSignal;
}) {
  const search = new URLSearchParams({workspace_id: workspaceId, limit: String(limit)});
  if (cursor) search.set('cursor', cursor);

  return await apiRequest<ListProjectsResponseDto>(`/projects?${search.toString()}`, {signal});
}

export async function getProject(projectId: string) {
  return await apiRequest<ProjectResponseDto>(`/projects/${projectId}`);
}

export async function createVcsConnection(body: CreateVcsConnectionBodyDto) {
  return await apiRequest<VcsConnectionDto>('/vcs-connections', {method: 'POST', body});
}

export async function createProject(body: CreateProjectBodyDto) {
  return await apiRequest<ProjectResponseDto>('/projects', {method: 'POST', body});
}

export function useProjectsInfiniteQuery(workspaceId: string | undefined, limit = 50) {
  return useInfiniteQuery({
    queryKey: workspaceId
      ? projectsQueryKeys.list(workspaceId)
      : [...projectsQueryKeys.all, 'list'],
    enabled: Boolean(workspaceId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({pageParam, signal}) =>
      listProjects({workspaceId: workspaceId ?? '', limit, cursor: pageParam, signal}),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
  });
}

export function useProjectQuery(projectId: string | undefined) {
  return useQuery({
    queryKey: projectId
      ? projectsQueryKeys.detail(projectId)
      : [...projectsQueryKeys.all, 'detail'],
    enabled: Boolean(projectId),
    queryFn: () => getProject(projectId ?? ''),
  });
}

export function useCreateVcsConnectionMutation() {
  return useMutation({mutationFn: createVcsConnection});
}

export function useCreateProjectMutation() {
  return useMutation({mutationFn: createProject});
}
