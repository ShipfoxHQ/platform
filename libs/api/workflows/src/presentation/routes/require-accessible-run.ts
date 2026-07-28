import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {ClientError} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import type {WorkflowRun} from '#core/entities/workflow-run.js';
import {getWorkflowRunById} from '#db/index.js';
import {requireProjectAccess} from './project-access.js';

export async function requireAccessibleRun({
  request,
  id,
  projects,
}: {
  request: FastifyRequest;
  id: string;
  projects: ProjectsModuleClient;
}): Promise<WorkflowRun> {
  const run = await getWorkflowRunById(id);
  if (!run) {
    throw new ClientError('Run not found', 'not-found', {status: 404});
  }

  await requireProjectAccess(request, run.projectId, projects).catch((err: unknown) => {
    if (
      err instanceof ClientError &&
      (err.status === 404 || (err.status === 403 && err.code === 'forbidden'))
    ) {
      throw new ClientError('Run not found', 'not-found', {status: 404});
    }
    throw err;
  });

  return run;
}
