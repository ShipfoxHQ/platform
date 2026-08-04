import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {
  workflowRunListQuerySchema,
  workflowRunListResponseSchema,
} from '@shipfox/api-workflows-dto';
import {decodeTimestampIdCursor, encodeTimestampIdCursor} from '@shipfox/node-drizzle';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import {listWorkflowRunJobSummaries, listWorkflowRuns} from '#db/index.js';
import {toRunListItemDto} from '#presentation/dto/index.js';
import {requireProjectAccess} from './project-access.js';

export function listRunsRoute(projects: ProjectsModuleClient) {
  return defineRoute({
    method: 'GET',
    path: '/',
    description: 'List workflow runs for a project',
    schema: {
      querystring: workflowRunListQuerySchema,
      response: {
        200: workflowRunListResponseSchema,
      },
    },
    handler: async (request) => {
      const startedAt = performance.now();
      const {
        project_id: projectId,
        limit,
        cursor,
        status,
        definition_id: definitionId,
        trigger_source: triggerSource,
        created_from: createdFrom,
        created_to: createdTo,
      } = request.query;
      const decodedCursor = decodeTimestampIdCursor(cursor);
      if (cursor && !decodedCursor) {
        throw new ClientError('Invalid cursor', 'invalid-cursor', {status: 400});
      }

      const project = await requireProjectAccess(request, projectId, projects);

      const filters = {
        status,
        definitionId,
        triggerSource,
        createdFrom: createdFrom ? new Date(createdFrom) : undefined,
        createdTo: createdTo ? new Date(createdTo) : undefined,
      };
      const result = await listWorkflowRuns({
        projectId: project.id,
        limit,
        cursor: decodedCursor,
        filters,
        includeTotal: !decodedCursor,
      });
      // Paired with the attempt this read returned, so a re-run landing mid-request cannot
      // pair one attempt's metadata with another's jobs.
      const jobsByRun = await listWorkflowRunJobSummaries(
        result.runs.map((run) => ({id: run.id, currentAttempt: run.currentAttempt})),
      );

      logger().info(
        {
          projectId: project.id,
          filterKeys: Object.entries(filters)
            .filter(([, value]) => value !== undefined)
            .map(([key]) => key),
          limit,
          cursorPresent: Boolean(cursor),
          resultCount: result.runs.length,
          nextCursorPresent: Boolean(result.nextCursor),
          durationMs: Math.round(performance.now() - startedAt),
        },
        'Listed workflow runs',
      );

      return {
        runs: result.runs.map((run) => toRunListItemDto(run, jobsByRun.get(run.id))),
        next_cursor: result.nextCursor ? encodeTimestampIdCursor(result.nextCursor) : null,
        filtered_total_count: result.filteredTotalCount,
      };
    },
  });
}
