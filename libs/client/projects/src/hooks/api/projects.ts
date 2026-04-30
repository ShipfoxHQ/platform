import type {
  IntegrationConnectionDto,
  ListIntegrationConnectionsResponseDto,
  ListRepositoriesResponseDto,
} from '@shipfox/api-integration-core-dto';
import type {CreateDebugConnectionBodyDto} from '@shipfox/api-integration-debug-dto';
import type {
  CreateProjectBodyDto,
  ListProjectsResponseDto,
  ProjectResponseDto,
} from '@shipfox/api-projects-dto';
import {apiRequest} from '@shipfox/client-api';
import {useInfiniteQuery, useMutation, useQuery} from '@tanstack/react-query';

export const projectsQueryKeys = {
  all: ['projects'] as const,
  list: (workspaceId: string) => [...projectsQueryKeys.all, 'list', workspaceId] as const,
  detail: (projectId: string) => [...projectsQueryKeys.all, 'detail', projectId] as const,
};

export const integrationsQueryKeys = {
  all: ['integrations'] as const,
  sourceConnections: (workspaceId: string) =>
    [...integrationsQueryKeys.all, 'source-connections', workspaceId] as const,
  repositories: (connectionId: string) =>
    [...integrationsQueryKeys.all, 'repositories', connectionId] as const,
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

export async function listSourceConnections({
  workspaceId,
  signal,
}: {
  workspaceId: string;
  signal?: AbortSignal;
}) {
  const search = new URLSearchParams({
    workspace_id: workspaceId,
    capability: 'source_control',
  });
  return await apiRequest<ListIntegrationConnectionsResponseDto>(
    `/integration-connections?${search.toString()}`,
    {signal},
  );
}

export async function createDebugConnection(body: CreateDebugConnectionBodyDto) {
  return await apiRequest<IntegrationConnectionDto>('/integrations/debug/connections', {
    method: 'POST',
    body,
  });
}

export async function listRepositories({
  connectionId,
  signal,
}: {
  connectionId: string;
  signal?: AbortSignal;
}) {
  return await apiRequest<ListRepositoriesResponseDto>(
    `/integration-connections/${connectionId}/repositories`,
    {signal},
  );
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

export function useSourceConnectionsQuery(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceId
      ? integrationsQueryKeys.sourceConnections(workspaceId)
      : [...integrationsQueryKeys.all, 'source-connections'],
    enabled: Boolean(workspaceId),
    queryFn: ({signal}) => listSourceConnections({workspaceId: workspaceId ?? '', signal}),
  });
}

export function useRepositoriesQuery(connectionId: string | undefined) {
  return useQuery({
    queryKey: connectionId
      ? integrationsQueryKeys.repositories(connectionId)
      : [...integrationsQueryKeys.all, 'repositories'],
    enabled: Boolean(connectionId),
    queryFn: ({signal}) => listRepositories({connectionId: connectionId ?? '', signal}),
  });
}

export function useCreateDebugConnectionMutation() {
  return useMutation({mutationFn: createDebugConnection});
}

export function useCreateProjectMutation() {
  return useMutation({mutationFn: createProject});
}
