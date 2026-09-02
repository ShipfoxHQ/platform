import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {
  type WorkflowExecutionStepsResponseDto,
  workflowExecutionStepsQuerySchema,
  workflowExecutionStepsResponseSchema,
} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import type {FastifyRequest} from 'fastify';
import {z} from 'zod';
import {getWorkflowJobReadScope, listWorkflowExecutionSteps} from '#db/index.js';
import {toWorkflowExecutionStepsResponseDto} from '#presentation/dto/index.js';
import {requireAccessibleRunScope} from './require-accessible-run.js';
import {serializedResponseByteLength} from './serialized-response-byte-length.js';
import {assertValidCursor, decodeStepCursor} from './workflow-job-cursors.js';

export function listExecutionStepsRoute(projects: ProjectsModuleClient) {
  return defineRoute({
    method: 'GET',
    path: '/jobs/:jobId/executions/:executionId/steps',
    description: 'List bounded step summaries for a workflow job execution',
    schema: {
      params: z.object({
        jobId: z.string().uuid(),
        executionId: z.string().uuid(),
      }),
      querystring: workflowExecutionStepsQuerySchema,
      response: {
        200: workflowExecutionStepsResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const {jobId, executionId} = request.params;
      const {cursor, limit} = request.query;
      const startedAt = performance.now();
      const decodedCursor = decodeStepCursor(cursor);
      let databaseDurationMilliseconds = 0;
      let responseBytes = 0;
      let resultCount = 0;
      let cursorRemaining = false;
      let responseStatus = 200;
      let outcome: 'success' | 'not_found' | 'access_denied' | 'error' = 'success';

      try {
        const result = await readExecutionSteps({
          request,
          jobId,
          executionId,
          limit,
          cursor,
          decodedCursor,
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
            route: 'workflow-runs/jobs/:jobId/executions/:executionId/steps',
            status: responseStatus,
            outcome,
            jobId,
            executionId,
            limit,
            cursorPresent: cursor !== undefined,
            resultCount,
            cursorRemaining,
            responseBytes,
            databaseDurationMs: Math.round(databaseDurationMilliseconds),
            durationMs: Math.round(performance.now() - startedAt),
          },
          'Listed workflow execution steps',
        );
      }
    },
  });
}

async function readExecutionSteps({
  request,
  jobId,
  executionId,
  limit,
  cursor,
  decodedCursor,
  projects,
  onAccessDenied,
  serialize,
}: {
  request: FastifyRequest;
  jobId: string;
  executionId: string;
  limit: number;
  cursor: string | undefined;
  decodedCursor: ReturnType<typeof decodeStepCursor>;
  projects: ProjectsModuleClient;
  onAccessDenied: () => void;
  serialize: (response: WorkflowExecutionStepsResponseDto) => string | ArrayBuffer | Buffer;
}) {
  assertValidCursor(cursor, decodedCursor);

  const scope = await getWorkflowJobReadScope(jobId);
  if (!scope) {
    throw new ClientError('Job not found', 'not-found', {status: 404});
  }
  await requireAccessibleRunScope({request, id: scope.workflowRunId, projects, onAccessDenied});

  let databaseDurationMilliseconds = 0;
  const page = await listWorkflowExecutionSteps(
    {
      jobId,
      executionId,
      limit,
      cursor: decodedCursor
        ? {position: Number(decodedCursor.value), id: decodedCursor.id}
        : undefined,
      scope,
    },
    {
      onRead: (measurement) => {
        databaseDurationMilliseconds = measurement.databaseDurationMilliseconds;
      },
    },
  );
  if (!page) {
    throw new ClientError('Execution not found', 'not-found', {status: 404});
  }

  const response = toWorkflowExecutionStepsResponseDto(page);
  return {
    response,
    serializedResponse: serialize(response),
    databaseDurationMilliseconds,
    resultCount: response.items.length,
    cursorRemaining: response.next_cursor !== null,
  };
}
