import {
  type AnnotationsInterModuleClient,
  annotationCursorSchema,
} from '@shipfox/annotations-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {
  type WorkflowRunAnnotationsResponseDto,
  workflowRunAnnotationsQuerySchema,
  workflowRunAnnotationsResponseSchema,
} from '@shipfox/api-workflows-dto';
import {decodeNumberIdCursor, encodeNumberIdCursor} from '@shipfox/node-drizzle';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import type {FastifyRequest} from 'fastify';
import {z} from 'zod';
import {
  getWorkflowRunAnnotationOrigins,
  getWorkflowRunAttemptIdForScope,
  workflowRunAnnotationOriginKey,
} from '#db/index.js';
import {toWorkflowRunAnnotationItemDto} from '#presentation/dto/index.js';
import {requireAccessibleRunScope} from './require-accessible-run.js';
import {serializedResponseByteLength} from './serialized-response-byte-length.js';

export function listRunAnnotationsRoute(
  annotations: AnnotationsInterModuleClient,
  projects: ProjectsModuleClient,
) {
  return defineRoute({
    method: 'GET',
    path: '/:id/annotations',
    description: 'List enriched annotations for a pinned workflow run attempt',
    schema: {
      params: z.object({
        id: z.string().uuid(),
      }),
      querystring: workflowRunAnnotationsQuerySchema,
      response: {
        200: workflowRunAnnotationsResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const {id} = request.params;
      const {attempt, limit, cursor} = request.query;
      const startedAt = performance.now();
      const decodedCursor = decodeNumberIdCursor(cursor);
      let databaseDurationMilliseconds = 0;
      let responseBytes = 0;
      let resultCount = 0;
      let cursorRemaining = false;
      let responseStatus = 200;
      let outcome: 'success' | 'degraded' | 'not_found' | 'access_denied' | 'error' = 'success';

      try {
        assertValidAnnotationCursor(cursor, decodedCursor);

        const result = await readRunAnnotations({
          request,
          id,
          attempt,
          limit,
          cursor: decodedCursor,
          annotations,
          projects,
          onAccessDenied: () => {
            outcome = 'access_denied';
          },
          onEnrichmentDegraded: () => {
            outcome = 'degraded';
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
        else if (responseStatus >= 500 || outcome === 'success') outcome = 'error';
        throw error;
      } finally {
        logger().info(
          {
            route: 'workflow-runs/:id/annotations',
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
          'Listed enriched workflow run annotations',
        );
      }
    },
  });
}

async function readRunAnnotations({
  request,
  id,
  attempt,
  limit,
  cursor,
  annotations,
  projects,
  onAccessDenied,
  onEnrichmentDegraded,
  serialize,
  onDatabaseRead,
}: {
  request: FastifyRequest;
  id: string;
  attempt: number;
  limit: number;
  cursor: {value: number; id: string} | undefined;
  annotations: AnnotationsInterModuleClient;
  projects: ProjectsModuleClient;
  onAccessDenied: () => void;
  onEnrichmentDegraded: () => void;
  serialize: (response: WorkflowRunAnnotationsResponseDto) => string | ArrayBuffer | Buffer;
  onDatabaseRead: (measurement: {databaseDurationMilliseconds: number}) => void;
}) {
  const run = await requireAccessibleRunScope({request, id, projects, onAccessDenied});
  let databaseDurationMilliseconds = 0;
  const attemptId = await getWorkflowRunAttemptIdForScope(
    {
      workspaceId: run.workspaceId,
      projectId: run.projectId,
      workflowRunId: run.id,
      attempt,
    },
    {
      onRead: (measurement) => {
        databaseDurationMilliseconds += measurement.databaseDurationMilliseconds;
      },
    },
  );
  if (!attemptId) {
    onDatabaseRead({databaseDurationMilliseconds});
    throw new ClientError('Run attempt not found', 'not-found', {status: 404});
  }

  const page = await annotations.listAnnotationsForRunAttempt({
    workspaceId: run.workspaceId,
    workflowRunId: run.id,
    workflowRunAttempt: attempt,
    cursor,
    limit,
  });

  let origins: Awaited<ReturnType<typeof getWorkflowRunAnnotationOrigins>> = [];
  try {
    origins = await getWorkflowRunAnnotationOrigins(
      {
        workspaceId: run.workspaceId,
        projectId: run.projectId,
        workflowRunId: run.id,
        attempt,
        origins: page.annotations.map((annotation) => ({
          jobId: annotation.job_id,
          jobExecutionId: annotation.job_execution_id,
          stepId: annotation.origin_step_id,
          stepAttempt: annotation.origin_step_attempt,
        })),
      },
      {
        onRead: (measurement) => {
          databaseDurationMilliseconds += measurement.databaseDurationMilliseconds;
        },
      },
    );
  } catch (error) {
    onEnrichmentDegraded();
    logger().warn(
      {
        error,
        runId: run.id,
        attempt,
        annotationIds: page.annotations.map((annotation) => annotation.id),
      },
      'Failed to enrich workflow run annotations',
    );
  }
  onDatabaseRead({databaseDurationMilliseconds});

  const originByKey = new Map(
    origins.map((origin) => [workflowRunAnnotationOriginKey(origin), origin]),
  );
  const items = page.annotations.flatMap((annotation) => {
    const origin = originByKey.get(
      workflowRunAnnotationOriginKey({
        jobId: annotation.job_id,
        jobExecutionId: annotation.job_execution_id,
        stepId: annotation.origin_step_id,
        stepAttempt: annotation.origin_step_attempt,
      }),
    );
    if (!origin) {
      onEnrichmentDegraded();
      logger().warn(
        {
          annotationId: annotation.id,
          runId: run.id,
          attempt,
          jobId: annotation.job_id,
          jobExecutionId: annotation.job_execution_id,
          stepId: annotation.origin_step_id,
          stepAttempt: annotation.origin_step_attempt,
        },
        'Skipped workflow run annotation with unavailable origin',
      );
      return [];
    }
    return [toWorkflowRunAnnotationItemDto(annotation, origin)];
  });

  const response: WorkflowRunAnnotationsResponseDto = {
    items,
    next_cursor: page.nextCursor ? encodeNumberIdCursor(page.nextCursor) : null,
  };
  return {response, serializedResponse: serialize(response)};
}

function assertValidAnnotationCursor(
  cursor: string | undefined,
  decodedCursor: {value: number; id: string} | undefined,
): void {
  if (cursor !== undefined && !annotationCursorSchema.safeParse(decodedCursor).success) {
    throw new ClientError('Invalid cursor', 'invalid-cursor', {status: 400});
  }
}
