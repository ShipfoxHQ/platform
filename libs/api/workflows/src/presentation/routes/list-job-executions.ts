import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {
  type WorkflowJobExecutionSummariesResponseDto,
  workflowJobExecutionSummariesQuerySchema,
  workflowJobExecutionSummariesResponseSchema,
} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import type {FastifyRequest} from 'fastify';
import {z} from 'zod';
import {
  getWorkflowJobReadScope,
  listWorkflowJobExecutionSummaries,
  type WorkflowJobReadMeasurement,
} from '#db/index.js';
import {toWorkflowJobExecutionSummariesResponseDto} from '#presentation/dto/index.js';
import {requireAccessibleRunScope} from './require-accessible-run.js';
import {serializedResponseByteLength} from './serialized-response-byte-length.js';
import {assertValidCursor, decodeExecutionCursor} from './workflow-job-cursors.js';

export function listJobExecutionsRoute(projects: ProjectsModuleClient) {
  return defineRoute({
    method: 'GET',
    path: '/jobs/:jobId/executions',
    description: 'List bounded execution summaries for a workflow run job',
    schema: {
      params: z.object({
        jobId: z.string().uuid(),
      }),
      querystring: workflowJobExecutionSummariesQuerySchema,
      response: {
        200: workflowJobExecutionSummariesResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const {jobId} = request.params;
      const {cursor, limit} = request.query;
      const startedAt = performance.now();
      const decodedCursor = decodeExecutionCursor(cursor);
      let databaseDurationMilliseconds = 0;
      let responseBytes = 0;
      let resultCount = 0;
      let cursorRemaining = false;
      let responseStatus = 200;
      let outcome: 'success' | 'not_found' | 'access_denied' | 'error' = 'success';

      try {
        const result = await readJobExecutions({
          request,
          jobId,
          limit,
          cursor,
          decodedCursor,
          projects,
          onAccessDenied: () => {
            outcome = 'access_denied';
          },
          onRead: ({databaseDurationMilliseconds: duration}) => {
            databaseDurationMilliseconds = duration;
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
            route: 'workflow-runs/jobs/:jobId/executions',
            status: responseStatus,
            outcome,
            jobId,
            limit,
            cursorPresent: cursor !== undefined,
            resultCount,
            cursorRemaining,
            responseBytes,
            databaseDurationMs: Math.round(databaseDurationMilliseconds),
            durationMs: Math.round(performance.now() - startedAt),
          },
          'Listed workflow job executions',
        );
      }
    },
  });
}

async function readJobExecutions({
  request,
  jobId,
  limit,
  cursor,
  decodedCursor,
  projects,
  onAccessDenied,
  onRead,
  serialize,
}: {
  request: FastifyRequest;
  jobId: string;
  limit: number;
  cursor: string | undefined;
  decodedCursor: ReturnType<typeof decodeExecutionCursor>;
  projects: ProjectsModuleClient;
  onAccessDenied: () => void;
  onRead: (measurement: WorkflowJobReadMeasurement) => void;
  serialize: (response: WorkflowJobExecutionSummariesResponseDto) => string | ArrayBuffer | Buffer;
}) {
  assertValidCursor(cursor, decodedCursor);

  const scope = await getWorkflowJobReadScope(jobId);
  if (!scope) {
    throw new ClientError('Job not found', 'not-found', {status: 404});
  }
  await requireAccessibleRunScope({request, id: scope.workflowRunId, projects, onAccessDenied});

  let databaseDurationMilliseconds = 0;
  const page = await listWorkflowJobExecutionSummaries(
    {
      jobId,
      limit,
      cursor: decodedCursor ? {sequence: decodedCursor.value, id: decodedCursor.id} : undefined,
      scope,
    },
    {
      onRead: (measurement) => {
        databaseDurationMilliseconds = measurement.databaseDurationMilliseconds;
        onRead(measurement);
      },
    },
  );
  if (!page) {
    throw new ClientError('Job not found', 'not-found', {status: 404});
  }

  const response = toWorkflowJobExecutionSummariesResponseDto(page);
  return {
    response,
    serializedResponse: serialize(response),
    databaseDurationMilliseconds,
    resultCount: response.items.length,
    cursorRemaining: response.next_cursor !== null,
  };
}
