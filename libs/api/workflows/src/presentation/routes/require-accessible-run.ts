import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {ClientError} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import type {WorkflowRun} from '#core/entities/workflow-run.js';
import {getWorkflowRunAccessScopeById, getWorkflowRunById} from '#db/index.js';
import {requireProjectAccess} from './project-access.js';

interface RequireAccessibleRunParams {
  request: FastifyRequest;
  id: string;
  projects: ProjectsModuleClient;
  onLookup?: ((found: boolean) => void) | undefined;
  onAccessDenied?: (() => void) | undefined;
}

export function requireAccessibleRun(params: RequireAccessibleRunParams): Promise<WorkflowRun> {
  return requireAccessibleRunWithLoader({
    ...params,
    load: () => getWorkflowRunById(params.id),
  });
}

export function requireAccessibleRunScope(params: RequireAccessibleRunParams) {
  return requireAccessibleRunWithLoader({
    ...params,
    load: () => getWorkflowRunAccessScopeById(params.id),
  });
}

async function requireAccessibleRunWithLoader<T extends {projectId: string}>(
  params: RequireAccessibleRunParams & {load: () => Promise<T | undefined>},
): Promise<T> {
  const run = await params.load();
  params.onLookup?.(run !== undefined);
  if (!run) {
    throw new ClientError('Run not found', 'not-found', {status: 404});
  }

  try {
    await requireProjectAccess(params.request, run.projectId, params.projects);
  } catch (error: unknown) {
    if (
      error instanceof ClientError &&
      (error.status === 404 || (error.status === 403 && error.code === 'forbidden'))
    ) {
      params.onAccessDenied?.();
      throw new ClientError('Run not found', 'not-found', {status: 404});
    }
    throw error;
  }

  return run;
}
