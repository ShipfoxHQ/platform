import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {
  workflowRunAttemptsQuerySchema,
  workflowRunAttemptsResponseSchema,
} from '@shipfox/api-workflows-dto';
import {
  decodeNumberIdCursor,
  encodeNumberIdCursor,
  type NumberIdCursor,
} from '@shipfox/node-drizzle';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import {z} from 'zod';
import {listRunAttempts, listRunAttemptsPage} from '#db/index.js';
import {toRunAttemptDto} from '#presentation/dto/index.js';
import {requireAccessibleRun} from './require-accessible-run.js';

export function listRunAttemptsRoute(projects: ProjectsModuleClient) {
  return defineRoute({
    method: 'GET',
    path: '/:id/attempts',
    description: 'List attempts in a workflow run lineage',
    schema: {
      params: z.object({
        id: z.string().uuid(),
      }),
      querystring: workflowRunAttemptsQuerySchema,
      response: {
        200: workflowRunAttemptsResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const {id} = request.params;
      const {cursor, limit} = request.query;
      const startedAt = performance.now();
      const decodedCursor = decodeNumberIdCursor(cursor);
      let dbDurationMilliseconds = 0;
      let responseBytes = 0;
      let resultCount = 0;
      let cursorRemaining = false;
      let responseStatus = 200;
      let outcome: 'success' | 'not_found' | 'error' = 'success';

      try {
        if (cursor !== undefined && !decodedCursor) {
          throw new ClientError('Invalid cursor', 'invalid-cursor', {status: 400});
        }

        const run = await requireAccessibleRun({request, id, projects});

        const result = await readRunAttempts({
          workflowRunId: run.id,
          projectId: run.projectId,
          limit,
          cursor: decodedCursor,
        });
        dbDurationMilliseconds = result.dbDurationMilliseconds;
        resultCount = result.resultCount;
        cursorRemaining = result.cursorRemaining;
        const serializedResponse = reply.serialize(result.response);
        responseBytes = serializedResponseByteLength(serializedResponse);
        return reply.type('application/json').send(serializedResponse);
      } catch (error) {
        responseStatus =
          error instanceof ClientError && typeof error.status === 'number' ? error.status : 500;
        outcome = responseStatus === 404 ? 'not_found' : 'error';
        throw error;
      } finally {
        logger().info(
          {
            route: 'workflow-runs/:id/attempts',
            status: responseStatus,
            outcome,
            runId: id,
            resultCount,
            limit: limit ?? null,
            cursorPresent: cursor !== undefined,
            cursorRemaining,
            responseBytes,
            databaseDurationMs: Math.round(dbDurationMilliseconds),
            durationMs: Math.round(performance.now() - startedAt),
          },
          'Listed workflow run attempts',
        );
      }
    },
  });
}

async function readRunAttempts(params: {
  workflowRunId: string;
  projectId: string;
  limit: number | undefined;
  cursor: NumberIdCursor | undefined;
}) {
  const {limit} = params;
  if (limit === undefined) {
    const dbStartedAt = performance.now();
    const attempts = await listRunAttempts({
      workflowRunId: params.workflowRunId,
      projectId: params.projectId,
    });
    return {
      response: {attempts: attempts.map(toRunAttemptDto)},
      resultCount: attempts.length,
      cursorRemaining: false,
      dbDurationMilliseconds: performance.now() - dbStartedAt,
    };
  }

  let dbDurationMilliseconds = 0;
  const page = await listRunAttemptsPage(
    {
      workflowRunId: params.workflowRunId,
      projectId: params.projectId,
      limit,
      cursor: params.cursor,
    },
    {
      onRead: (measurement) => {
        dbDurationMilliseconds = measurement.databaseDurationMilliseconds;
      },
    },
  );
  return {
    response: {
      items: page.attempts.map(toRunAttemptDto),
      next_cursor: page.nextCursor ? encodeNumberIdCursor(page.nextCursor) : null,
    },
    resultCount: page.attempts.length,
    cursorRemaining: page.nextCursor !== null,
    dbDurationMilliseconds,
  };
}

function serializedResponseByteLength(payload: string | ArrayBuffer | Buffer): number {
  return typeof payload === 'string' ? Buffer.byteLength(payload, 'utf8') : payload.byteLength;
}
