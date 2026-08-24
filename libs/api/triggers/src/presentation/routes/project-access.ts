import {requireWorkspaceAccess} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {ClientError} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';

/**
 * Requires an authenticated member of the project's workspace. Mirrors the
 * definitions routes' gate: the project row is resolved through the projects
 * module client and workspace access through the request memberships.
 */
export async function requireProjectAccess(
  request: FastifyRequest,
  projectId: string,
  projects: ProjectsModuleClient,
) {
  const {project} = await projects.getProjectById({projectId});
  if (project === null) {
    throw new ClientError('Project not found', 'project-not-found', {status: 404});
  }
  requireWorkspaceAccess({request, workspaceId: project.workspaceId});
  return {project, workspaceId: project.workspaceId};
}
