import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {
  type WorkflowJobDetailDto,
  workflowJobDetailQuerySchema,
  workflowJobDetailResponseSchema,
} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import type {FastifyRequest} from 'fastify';
import {z} from 'zod';
import {getWorkflowJobDetail, getWorkflowJobReadScope} from '#db/index.js';
import {toWorkflowJobDetailDto} from '#presentation/dto/index.js';
import {requireAccessibleRunScope} from './require-accessible-run.js';
import {serializedResponseByteLength} from './serialized-response-byte-length.js';

export function getJobDetailRoute(projects: ProjectsModuleClient) {
  return defineRoute({
    method: 'GET',
    path: '/jobs/:jobId',
    description: 'Get a bounded selected execution for a workflow run job',
    schema: {
      params: z.object({
        jobId: z.string().uuid(),
      }),
      querystring: workflowJobDetailQuerySchema,
      response: {
        200: workflowJobDetailResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const {jobId} = request.params;
      const startedAt = performance.now();
      let databaseDurationMilliseconds = 0;
      let responseBytes = 0;
      let resultCount = 0;
      let cursorRemaining = false;
      let responseStatus = 200;
      let outcome: 'success' | 'not_found' | 'access_denied' | 'error' = 'success';

      try {
        const result = await readJobDetail({
          request,
          jobId,
          executionId: request.query.execution_id,
          projects,
          onAccessDenied: () => {
            outcome = 'access_denied';
          },
          serialize: (response) => reply.serialize(response),
        });
        databaseDurationMilliseconds = result.databaseDurationMilliseconds;
        responseBytes = serializedResponseByteLength(result.serializedResponse);
        resultCount = result.resultCount;
        cursorRemaining = result.cursorRemaining;
        return reply.type('application/json').send(result.serializedResponse);
      } catch (error) {
        responseStatus =
          error instanceof ClientError && typeof error.status === 'number' ? error.status : 500;
        if (responseStatus === 404 && outcome === 'success') outcome = 'not_found';
        else if (outcome === 'success') outcome = 'error';
        throw error;
      } finally {
        logger().info(
          {
            route: 'workflow-runs/jobs/:jobId',
            status: responseStatus,
            outcome,
            jobId,
            executionId: request.query.execution_id ?? null,
            resultCount,
            cursorRemaining,
            responseBytes,
            databaseDurationMs: Math.round(databaseDurationMilliseconds),
            durationMs: Math.round(performance.now() - startedAt),
          },
          'Read selected workflow job detail',
        );
      }
    },
  });
}

async function readJobDetail({
  request,
  jobId,
  executionId,
  projects,
  onAccessDenied,
  serialize,
}: {
  request: FastifyRequest;
  jobId: string;
  executionId: string | undefined;
  projects: ProjectsModuleClient;
  onAccessDenied: () => void;
  serialize: (response: WorkflowJobDetailDto) => string | ArrayBuffer | Buffer;
}) {
  const scope = await getWorkflowJobReadScope(jobId);
  if (!scope) {
    throw new ClientError('Job not found', 'not-found', {status: 404});
  }

  await requireAccessibleRunScope({request, id: scope.workflowRunId, projects, onAccessDenied});
  let databaseDurationMilliseconds = 0;
  const detail = await getWorkflowJobDetail(
    {jobId, executionId, scope},
    {
      onRead: (measurement) => {
        databaseDurationMilliseconds = measurement.databaseDurationMilliseconds;
      },
    },
  );
  if (!detail) {
    throw new ClientError('Job not found', 'not-found', {status: 404});
  }

  const response = toWorkflowJobDetailDto(detail);
  return {
    response,
    serializedResponse: serialize(response),
    databaseDurationMilliseconds,
    resultCount: detail.selectedExecution?.steps.items.length ?? 0,
    cursorRemaining: detail.selectedExecution
      ? detail.selectedExecution.steps.nextCursor !== null
      : false,
  };
}
