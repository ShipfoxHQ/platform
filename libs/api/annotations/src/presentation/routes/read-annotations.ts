import {readAnnotationsQuerySchema, readAnnotationsResponseSchema} from '@shipfox/annotations-dto';
import {requireUserContext} from '@shipfox/api-auth-context';
import {decodeNumberIdCursor, encodeNumberIdCursor} from '@shipfox/node-drizzle';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {listAnnotationsForRunAttempt} from '#db/index.js';
import {toAnnotationDto} from '#presentation/dto/index.js';

export const readAnnotationsRoute = defineRoute({
  method: 'GET',
  path: '/',
  description: 'Read annotations for a workflow run attempt.',
  schema: {
    querystring: readAnnotationsQuerySchema,
    response: {
      200: readAnnotationsResponseSchema,
    },
  },
  handler: async (request) => {
    const user = requireUserContext(request);
    const {
      workflow_run_id: workflowRunId,
      attempt,
      job_execution_id: jobExecutionId,
      cursor,
      limit,
    } = request.query;
    const decodedCursor = decodeNumberIdCursor(cursor);
    if (cursor !== undefined && !decodedCursor) {
      throw new ClientError('Invalid cursor', 'invalid-cursor', {status: 400});
    }

    const workspaceIds = user.memberships
      .filter((membership) => membership.workspaceStatus === 'active')
      .map((membership) => membership.workspaceId);
    const result = await listAnnotationsForRunAttempt({
      workflowRunId,
      workflowRunAttempt: attempt,
      workspaceIds,
      jobExecutionId,
      after: decodedCursor ? {sequence: decodedCursor.value, id: decodedCursor.id} : undefined,
      limit,
    });

    return {
      annotations: result.annotations.map(toAnnotationDto),
      has_more: result.hasMore,
      next_cursor: result.nextCursor
        ? encodeNumberIdCursor({value: result.nextCursor.sequence, id: result.nextCursor.id})
        : null,
    };
  },
});
