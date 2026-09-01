import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {
  WORKFLOW_RUN_OVERVIEW_LARGE_JOB_PAGE_LIMIT,
  WORKFLOW_RUN_OVERVIEW_RESPONSE_BYTE_LIMIT,
  type WorkflowRunOverviewResponseDto,
  workflowRunOverviewQuerySchema,
  workflowRunOverviewResponseSchema,
} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import type {FastifyRequest} from 'fastify';
import {z} from 'zod';
import {getWorkflowRunOverview} from '#db/index.js';
import {toRunOverviewDto} from '#presentation/dto/index.js';
import {requireAccessibleRunScope} from './require-accessible-run.js';
import {serializedResponseByteLength} from './serialized-response-byte-length.js';

export function getRunOverviewRoute(projects: ProjectsModuleClient) {
  return defineRoute({
    method: 'GET',
    path: '/:id/overview',
    description: 'Get a bounded overview for a pinned workflow run attempt',
    schema: {
      params: zParams,
      querystring: workflowRunOverviewQuerySchema,
      response: {
        200: workflowRunOverviewResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const {id} = request.params;
      const {attempt} = request.query;
      const startedAt = performance.now();
      let databaseDurationMilliseconds = 0;
      let responseBytes = 0;
      let resultCount = 0;
      let cursorRemaining = false;
      let responseStatus = 200;
      let responseKind: 'complete' | 'large' | null = null;
      let outcome: 'success' | 'not_found' | 'access_denied' | 'error' = 'success';

      try {
        const result = await readRunOverview({
          request,
          id,
          attempt,
          projects,
          onAccessDenied: () => {
            outcome = 'access_denied';
          },
          serialize: (response) => reply.serialize(response),
        });
        databaseDurationMilliseconds = result.databaseDurationMilliseconds;
        const {response, serializedResponse} = result;
        responseBytes = serializedResponseByteLength(serializedResponse);
        responseKind = response.jobs.kind;
        resultCount = overviewResultCount(response);
        cursorRemaining = overviewHasNextPage(response);
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
            route: 'workflow-runs/:id/overview',
            status: responseStatus,
            outcome,
            runId: id,
            attempt,
            resultCount,
            responseKind,
            cursorRemaining,
            responseBytes,
            databaseDurationMs: Math.round(databaseDurationMilliseconds),
            durationMs: Math.round(performance.now() - startedAt),
          },
          'Read workflow run overview',
        );
      }
    },
  });
}

const zParams = z.object({
  id: z.string().uuid(),
});

async function readRunOverview({
  request,
  id,
  attempt,
  projects,
  onAccessDenied,
  serialize,
}: {
  request: FastifyRequest;
  id: string;
  attempt: number;
  projects: ProjectsModuleClient;
  onAccessDenied: () => void;
  serialize: (response: WorkflowRunOverviewResponseDto) => string | ArrayBuffer | Buffer;
}) {
  const run = await requireAccessibleRunScope({request, id, projects, onAccessDenied});
  let databaseDurationMilliseconds = 0;
  const overview = await getWorkflowRunOverview(
    {workflowRunId: run.id, projectId: run.projectId, attempt},
    {
      onRead: (measurement) => {
        databaseDurationMilliseconds = measurement.databaseDurationMilliseconds;
      },
    },
  );
  if (!overview) {
    throw new ClientError('Run attempt not found', 'not-found', {status: 404});
  }

  const response = toRunOverviewDto(overview);
  const serializedResponse = serialize(response);
  if (
    overview.jobs.kind === 'complete' &&
    serializedResponseByteLength(serializedResponse) > WORKFLOW_RUN_OVERVIEW_RESPONSE_BYTE_LIMIT
  ) {
    return {
      ...toBoundedLargeOverviewResponse(overview, serialize),
      databaseDurationMilliseconds,
    };
  }

  return {response, serializedResponse, databaseDurationMilliseconds};
}

function toBoundedLargeOverviewResponse(
  overview: Parameters<typeof toRunOverviewDto>[0],
  serialize: (response: WorkflowRunOverviewResponseDto) => string | ArrayBuffer | Buffer,
) {
  let pageSize = WORKFLOW_RUN_OVERVIEW_LARGE_JOB_PAGE_LIMIT;
  while (true) {
    const response = toRunOverviewDto(overview, {forceLarge: true, largePageSize: pageSize});
    const serializedResponse = serialize(response);
    if (
      serializedResponseByteLength(serializedResponse) <= WORKFLOW_RUN_OVERVIEW_RESPONSE_BYTE_LIMIT
    ) {
      return {response, serializedResponse};
    }
    if (pageSize === 1) {
      throw new ClientError('Run overview is too large to serialize', 'response-too-large', {
        status: 500,
      });
    }
    pageSize = Math.max(1, Math.floor(pageSize / 2));
  }
}

function overviewResultCount(response: WorkflowRunOverviewResponseDto): number {
  return response.jobs.kind === 'complete'
    ? response.jobs.items.length
    : response.jobs.first_page.items.length;
}

function overviewHasNextPage(response: WorkflowRunOverviewResponseDto): boolean {
  return response.jobs.kind === 'large' && response.jobs.first_page.next_cursor !== null;
}
