import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {
  type WorkflowRunOverviewJobsResponseDto,
  workflowRunOverviewJobsQuerySchema,
  workflowRunOverviewJobsResponseSchema,
} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import type {FastifyRequest} from 'fastify';
import {z} from 'zod';
import {listWorkflowRunJobsPage, type WorkflowRunJobCursor} from '#db/index.js';
import {toRunOverviewJobsPageDto} from '#presentation/dto/index.js';
import {requireAccessibleRunScope} from './require-accessible-run.js';
import {serializedResponseByteLength} from './serialized-response-byte-length.js';
import {assertValidCursor, decodeJobCursor} from './workflow-job-cursors.js';

export function listRunJobsRoute(projects: ProjectsModuleClient) {
  return defineRoute({
    method: 'GET',
    path: '/:id/jobs',
    description: 'List bounded job summaries for a pinned workflow run attempt',
    schema: {
      params: z.object({
        id: z.string().uuid(),
      }),
      querystring: workflowRunOverviewJobsQuerySchema,
      response: {
        200: workflowRunOverviewJobsResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const {id} = request.params;
      const {attempt, limit, cursor} = request.query;
      const startedAt = performance.now();
      const decodedCursor = decodeJobCursor(cursor);
      let databaseDurationMilliseconds = 0;
      let responseBytes = 0;
      let resultCount = 0;
      let cursorRemaining = false;
      let responseStatus = 200;
      let outcome: 'success' | 'not_found' | 'access_denied' | 'error' = 'success';

      try {
        assertValidCursor(cursor, decodedCursor);
        const result = await readRunJobsPage({
          request,
          id,
          attempt,
          limit,
          cursor: decodedCursor,
          projects,
          onAccessDenied: () => {
            outcome = 'access_denied';
          },
          serialize: (response) => reply.serialize(response),
        });
        databaseDurationMilliseconds = result.databaseDurationMilliseconds;
        const {response, serializedResponse} = result;
        responseBytes = serializedResponseByteLength(serializedResponse);
        resultCount = response.items.length;
        cursorRemaining = response.next_cursor !== null;
        return reply.type('application/json').send(serializedResponse);
      } catch (error) {
        responseStatus =
          error instanceof ClientError && typeof error.status === 'number' ? error.status : 500;
        if (responseStatus === 404 && outcome === 'success') outcome = 'not_found';
        else if (outcome === 'success') outcome = 'error';
        throw error;
      } finally {
        logger().info(
          {
            route: 'workflow-runs/:id/jobs',
            status: responseStatus,
            outcome,
            runId: id,
            attempt,
            limit,
            cursorPresent: cursor !== undefined,
            resultCount,
            cursorRemaining,
            responseBytes,
            databaseDurationMs: Math.round(databaseDurationMilliseconds),
            durationMs: Math.round(performance.now() - startedAt),
          },
          'Listed workflow run job summaries',
        );
      }
    },
  });
}

async function readRunJobsPage({
  request,
  id,
  attempt,
  limit,
  cursor,
  projects,
  onAccessDenied,
  serialize,
}: {
  request: FastifyRequest;
  id: string;
  attempt: number;
  limit: number;
  cursor: WorkflowRunJobCursor | undefined;
  projects: ProjectsModuleClient;
  onAccessDenied: () => void;
  serialize: (response: WorkflowRunOverviewJobsResponseDto) => string | ArrayBuffer | Buffer;
}) {
  const run = await requireAccessibleRunScope({request, id, projects, onAccessDenied});
  let databaseDurationMilliseconds = 0;
  const page = await listWorkflowRunJobsPage(
    {
      workflowRunId: run.id,
      projectId: run.projectId,
      attempt,
      limit,
      cursor,
    },
    {
      onRead: (measurement) => {
        databaseDurationMilliseconds = measurement.databaseDurationMilliseconds;
      },
    },
  );
  if (!page) {
    throw new ClientError('Run attempt not found', 'not-found', {status: 404});
  }

  const response = toRunOverviewJobsPageDto(page);
  return {
    response,
    serializedResponse: serialize(response),
    databaseDurationMilliseconds,
  };
}
