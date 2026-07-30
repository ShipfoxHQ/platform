import {slugifyName, withSlugSuffix} from '@shipfox/api-common-dto';
import type {E2eCreateProjectBodyDto, E2eCreateProjectResponseDto} from '@shipfox/api-projects-dto';
import {requestJson} from '@shipfox/e2e-core';

export type {E2eCreateProjectBodyDto, E2eCreateProjectResponseDto} from '@shipfox/api-projects-dto';

export interface CreateProjectParams {
  workspaceId: string;
  name?: string;
  slug?: string | undefined;
  sourceConnectionId?: string | undefined;
  sourceExternalRepositoryId?: string | undefined;
}

const DEFAULT_PROJECT_NAME = 'E2E Project';
let projectSequence = 1;

export async function createProject(
  params: CreateProjectParams,
): Promise<E2eCreateProjectResponseDto> {
  const name = params.name ?? DEFAULT_PROJECT_NAME;
  const body: E2eCreateProjectBodyDto = {
    workspace_id: params.workspaceId,
    name,
    slug:
      params.slug ?? withSlugSuffix(slugifyName(name, {fallback: 'project'}), ++projectSequence),
    source_connection_id: params.sourceConnectionId,
    source_external_repository_id: params.sourceExternalRepositoryId,
  };
  return await requestJson<E2eCreateProjectResponseDto>('post', '/__e2e/projects', {
    json: body,
  });
}

export function createProjectsHelper() {
  return {
    createProject,
  };
}

export type ProjectsHelper = ReturnType<typeof createProjectsHelper>;

export interface ProjectsFixtures {
  projects: ProjectsHelper;
}

export const projectsHelper = {
  projects: async (
    {request: _request}: {request: unknown},
    use: (helper: ProjectsHelper) => Promise<void>,
  ) => {
    await use(createProjectsHelper());
  },
};
