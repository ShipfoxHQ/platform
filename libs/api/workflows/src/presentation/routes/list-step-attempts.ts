import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {
  type WorkflowStepAttemptSummariesResponseDto,
  workflowStepAttemptSummariesQuerySchema,
  workflowStepAttemptSummariesResponseSchema,
} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import type {FastifyRequest} from 'fastify';
import {z} from 'zod';
import {getWorkflowStepReadScope, listWorkflowStepAttemptSummaries} from '#db/index.js';
import {toWorkflowStepAttemptSummariesResponseDto} from '#presentation/dto/index.js';
import {requireAccessibleRunScope} from './require-accessible-run.js';
import {serializedResponseByteLength} from './serialized-response-byte-length.js';
import {assertValidCursor, decodeAttemptCursor} from './workflow-job-cursors.js';

export function listStepAttemptsRoute(projects: ProjectsModuleClient) {
  return defineRoute({
    method: 'GET',
    path: '/steps/:stepId/attempts',
    description: 'List bounded attempt summaries for a workflow step',
    schema: {
      params: z.object({
        stepId: z.string().uuid(),
      }),
      querystring: workflowStepAttemptSummariesQuerySchema,
      response: {
        200: workflowStepAttemptSummariesResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const {stepId} = request.params;
      const {cursor, limit} = request.query;
      const startedAt = performance.now();
      const decodedCursor = decodeAttemptCursor(cursor);
      let databaseDurationMilliseconds = 0;
      let responseBytes = 0;
      let resultCount = 0;
      let cursorRemaining = false;
      let responseStatus = 200;
      let stepType: string | null = null;
      let outcome: 'success' | 'not_found' | 'access_denied' | 'error' = 'success';

      try {
        const result = await readStepAttempts({
          request,
          stepId,
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
        stepType = result.stepType;
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
            route: 'workflow-runs/steps/:stepId/attempts',
            status: responseStatus,
            outcome,
            stepId,
            stepType,
            limit,
            cursorPresent: cursor !== undefined,
            resultCount,
            cursorRemaining,
            responseBytes,
            databaseDurationMs: Math.round(databaseDurationMilliseconds),
            durationMs: Math.round(performance.now() - startedAt),
          },
          'Listed workflow step attempts',
        );
      }
    },
  });
}

async function readStepAttempts({
  request,
  stepId,
  limit,
  cursor,
  decodedCursor,
  projects,
  onAccessDenied,
  serialize,
}: {
  request: FastifyRequest;
  stepId: string;
  limit: number;
  cursor: string | undefined;
  decodedCursor: ReturnType<typeof decodeAttemptCursor>;
  projects: ProjectsModuleClient;
  onAccessDenied: () => void;
  serialize: (response: WorkflowStepAttemptSummariesResponseDto) => string | ArrayBuffer | Buffer;
}) {
  assertValidCursor(cursor, decodedCursor);

  const scope = await getWorkflowStepReadScope(stepId);
  if (!scope) {
    throw new ClientError('Step not found', 'not-found', {status: 404});
  }
  await requireAccessibleRunScope({request, id: scope.workflowRunId, projects, onAccessDenied});

  let databaseDurationMilliseconds = 0;
  const page = await listWorkflowStepAttemptSummaries(
    {
      stepId,
      limit,
      cursor: decodedCursor ? {attempt: decodedCursor.value, id: decodedCursor.id} : undefined,
      scope,
    },
    {
      onRead: (measurement) => {
        databaseDurationMilliseconds = measurement.databaseDurationMilliseconds;
      },
    },
  );
  if (!page) {
    throw new ClientError('Step not found', 'not-found', {status: 404});
  }

  const response = toWorkflowStepAttemptSummariesResponseDto(page);
  return {
    response,
    serializedResponse: serialize(response),
    databaseDurationMilliseconds,
    resultCount: response.items.length,
    cursorRemaining: response.next_cursor !== null,
    stepType: page.stepType,
  };
}
