import {
  annotationSummaryResponseSchema,
  readAnnotationsQuerySchema,
} from '@shipfox/annotations-dto';
import {requireUserContext} from '@shipfox/api-auth-context';
import {defineRoute} from '@shipfox/node-fastify';
import {summarizeAnnotationsForRunAttempt} from '#db/index.js';

export const readAnnotationSummaryRoute = defineRoute({
  method: 'GET',
  path: '/summary',
  description: 'Read annotation counts for a workflow run attempt.',
  schema: {
    querystring: readAnnotationsQuerySchema.omit({cursor: true, limit: true}),
    response: {
      200: annotationSummaryResponseSchema,
    },
  },
  handler: async (request) => {
    const user = requireUserContext(request);
    const {
      workflow_run_id: workflowRunId,
      attempt,
      job_execution_id: jobExecutionId,
    } = request.query;
    const workspaceIds = user.memberships
      .filter((membership) => membership.workspaceStatus === 'active')
      .map((membership) => membership.workspaceId);

    const summary = await summarizeAnnotationsForRunAttempt({
      workflowRunId,
      workflowRunAttempt: attempt,
      workspaceIds,
      jobExecutionId,
    });

    return {
      total: summary.total,
      error: summary.error,
      warning: summary.warning,
      info: summary.info,
      success: summary.success,
      step_counts: summary.stepCounts.map((step) => ({
        origin_step_id: step.originStepId,
        origin_step_attempt: step.originStepAttempt,
        total: step.total,
      })),
    };
  },
});
