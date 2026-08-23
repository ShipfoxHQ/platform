import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {
  workflowRunAggregatesQuerySchema,
  workflowRunAggregatesResponseSchema,
} from '@shipfox/api-workflows-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import {getWorkflowRunAggregates} from '#db/index.js';
import {requireProjectAccess} from './project-access.js';

export function getRunAggregatesRoute(projects: ProjectsModuleClient) {
  return defineRoute({
    method: 'GET',
    path: '/aggregates',
    description: 'Get faceted workflow run counts for a project',
    schema: {
      querystring: workflowRunAggregatesQuerySchema,
      response: {
        200: workflowRunAggregatesResponseSchema,
      },
    },
    handler: async (request) => {
      const startedAt = performance.now();
      const {
        project_id: projectId,
        status,
        definition_id: definitionId,
        trigger_source: triggerSource,
        origin,
        created_from: createdFrom,
        created_to: createdTo,
      } = request.query;

      const project = await requireProjectAccess(request, projectId, projects);
      const filters = {
        status,
        definitionId,
        triggerSource,
        origin,
        createdFrom: createdFrom ? new Date(createdFrom) : undefined,
        createdTo: createdTo ? new Date(createdTo) : undefined,
      };
      const aggregates = await getWorkflowRunAggregates({projectId: project.id, filters});

      logger().info(
        {
          projectId: project.id,
          filterKeys: Object.entries(filters)
            .filter(([, value]) => value !== undefined)
            .map(([key]) => key),
          aggregateBucketSizes: {
            status: aggregates.status.length,
            triggerSource: aggregates.triggerSource.length,
            workflow: aggregates.workflow.length,
          },
          durationMs: Math.round(performance.now() - startedAt),
        },
        'Aggregated workflow runs',
      );

      return {
        status: aggregates.status,
        trigger_source: aggregates.triggerSource,
        workflow: aggregates.workflow,
      };
    },
  });
}
