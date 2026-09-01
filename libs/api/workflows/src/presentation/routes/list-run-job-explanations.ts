import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {
  type WorkflowRunJobExplanationsResponseDto,
  workflowRunJobExplanationsQuerySchema,
  workflowRunJobExplanationsResponseSchema,
} from '@shipfox/api-workflows-dto';
import {encodeStringIdCursor} from '@shipfox/node-drizzle';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import type {FastifyRequest} from 'fastify';
import {z} from 'zod';
import {listWorkflowRunJobExplanationsPage} from '#db/index.js';
import {toWorkflowRunJobExplanationDto} from '#presentation/dto/index.js';
import {requireAccessibleRunScope} from './require-accessible-run.js';
import {assertValidRunJobCursor, decodeRunJobCursor} from './run-job-cursor.js';
import {serializedResponseByteLength} from './serialized-response-byte-length.js';

export function listRunJobExplanationsRoute(projects: ProjectsModuleClient) {
  return defineRoute({
    method: 'GET',
    path: '/:id/job-explanations',
    description: 'List bounded explanations for failed or skipped jobs without executions',
    schema: {
      params: z.object({
        id: z.string().uuid(),
      }),
      querystring: workflowRunJobExplanationsQuerySchema,
      response: {
        200: workflowRunJobExplanationsResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const {id} = request.params;
      const {attempt, limit, cursor} = request.query;
      const startedAt = performance.now();
      const decodedCursor = decodeRunJobCursor(cursor);
      let databaseDurationMilliseconds = 0;
      let responseBytes = 0;
      let resultCount = 0;
      let cursorRemaining = false;
      let responseStatus = 200;
      let outcome: 'success' | 'not_found' | 'access_denied' | 'error' = 'success';

      try {
        assertValidRunJobCursor(cursor, decodedCursor);
        const result = await readRunJobExplanations({
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
          onDatabaseRead: (measurement) => {
            databaseDurationMilliseconds = measurement.databaseDurationMilliseconds;
          },
        });
        responseBytes = serializedResponseByteLength(result.serializedResponse);
        resultCount = result.response.items.length;
        cursorRemaining = result.response.next_cursor !== null;
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
            route: 'workflow-runs/:id/job-explanations',
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
          'Listed workflow run job explanations',
        );
      }
    },
  });
}

async function readRunJobExplanations({
  request,
  id,
  attempt,
  limit,
  cursor,
  projects,
  onAccessDenied,
  serialize,
  onDatabaseRead,
}: {
  request: FastifyRequest;
  id: string;
  attempt: number;
  limit: number;
  cursor: {position: number; id: string} | undefined;
  projects: ProjectsModuleClient;
  onAccessDenied: () => void;
  serialize: (response: WorkflowRunJobExplanationsResponseDto) => string | ArrayBuffer | Buffer;
  onDatabaseRead: (measurement: {databaseDurationMilliseconds: number}) => void;
}) {
  const run = await requireAccessibleRunScope({request, id, projects, onAccessDenied});
  const page = await listWorkflowRunJobExplanationsPage(
    {
      workspaceId: run.workspaceId,
      projectId: run.projectId,
      workflowRunId: run.id,
      attempt,
      limit,
      cursor,
    },
    {
      onRead: (measurement) => {
        onDatabaseRead(measurement);
      },
    },
  );
  if (!page) {
    throw new ClientError('Run attempt not found', 'not-found', {status: 404});
  }

  const response: WorkflowRunJobExplanationsResponseDto = {
    items: page.items.map(toWorkflowRunJobExplanationDto),
    next_cursor: page.nextCursor
      ? encodeStringIdCursor({value: String(page.nextCursor.position), id: page.nextCursor.id})
      : null,
  };
  return {response, serializedResponse: serialize(response)};
}
