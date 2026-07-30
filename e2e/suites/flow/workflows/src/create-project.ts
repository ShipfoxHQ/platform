import {slugifyName} from '@shipfox/api-common-dto';
import type {CreateProjectBodyDto, ProjectResponseDto} from '@shipfox/api-projects-dto';
import {createApiClient} from '@shipfox/e2e-core';

export interface CreateProjectParams {
  workspaceId: string;
  sessionToken: string;
  name: string;
  connectionId: string;
  externalRepositoryId: string;
  apiUrl?: string | undefined;
}

export async function createProject(params: CreateProjectParams): Promise<ProjectResponseDto> {
  const client = createApiClient({token: params.sessionToken, apiUrl: params.apiUrl});
  const body: CreateProjectBodyDto = {
    workspace_id: params.workspaceId,
    name: params.name,
    slug: slugifyName(params.name, {fallback: 'project'}),
    source: {
      connection_id: params.connectionId,
      external_repository_id: params.externalRepositoryId,
    },
  };
  return await client.requestJson<ProjectResponseDto>('post', '/projects/', {json: body});
}

// External repository ids are provider-prefixed as `<provider>:<owner>/<repo>`
// (buildProviderRepositoryId in @shipfox/api-integration-core-dto). The gitea provider
// resolves this back to owner/repo, so a suite repo in org `o` named `r` is `gitea:o/r`.
export function giteaExternalRepositoryId(org: string, repo: string): string {
  return `gitea:${org}/${repo}`;
}
