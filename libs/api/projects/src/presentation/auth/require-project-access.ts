import {getApiKeyContext, getUserContext} from '@shipfox/api-auth-context';
import {requireMembership} from '@shipfox/api-workspaces';
import {ClientError} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import type {ProjectWithRepository} from '#core/entities/index.js';
import {getProjectById, requireProjectForWorkspace} from '#db/index.js';

export interface RequireProjectAccessParams {
  request: FastifyRequest;
  projectId: string;
}

export interface RequireProjectAccessResult {
  project: ProjectWithRepository;
  workspaceId: string;
}

export async function requireProjectAccess(
  params: RequireProjectAccessParams,
): Promise<RequireProjectAccessResult> {
  const apiKeyContext = getApiKeyContext(params.request);
  if (apiKeyContext) {
    const project = await requireProjectForWorkspace({
      projectId: params.projectId,
      workspaceId: apiKeyContext.workspaceId,
    }).catch(() => {
      throw new ClientError('Project not found', 'project-not-found', {status: 404});
    });
    return {project, workspaceId: project.workspaceId};
  }

  const userContext = getUserContext(params.request);
  if (!userContext) {
    throw new ClientError('Authentication required', 'unauthorized', {status: 401});
  }

  const project = await getProjectById(params.projectId);
  if (!project) throw new ClientError('Project not found', 'project-not-found', {status: 404});
  await requireMembership({request: params.request, workspaceId: project.workspaceId});
  return {project, workspaceId: project.workspaceId};
}
